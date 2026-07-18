// The offline logical-economy world (task 077): the headless analogue of City.handleTick's tick assembly.
// Where live play backs jobs/schools/objects/homes with the map (Field/Workplace/House/Person), this owns them
// as plain deterministic state so the offline history generator (game/HistoryAsset.ts) can run the WHOLE
// progression loop off-map — logical schools (children earn calendar-exact school proficiency), logical jobs
// (adults get hired, progress rank skills, get promoted → real career event histories), and object generation
// (people accumulate Possessions). The results (SkillBook + carried Inventory) travel into the asset; the
// live JobMarket re-hires drawn people into REAL map jobs matching their asset-earned skills (task 077 §2 —
// logical employers are map-less, so employment itself is not carried, only skills/careers-as-history).
//
// It is a WorldAdapter (homes give per-home object pools + co-location) and a producer of the TickRunner facts
// (jobOf/schoolOf/employerKeyOf/jobAssignmentOf + markets{jobMarket,skills} + inventory + skillProgression).
// No engine/TickRunner change is needed — those seams already exist (task 040/046/047/058/063/065). Scene-free,
// deterministic (seeded from the world seed; its RNG is forked so it never perturbs the event/action streams).

import { fakerPT_BR } from '@faker-js/faker';
import { generateBusiness } from 'game/economy/BusinessGen';
import Agenda from 'game/actions/Agenda';
import CityIncidents from 'game/economy/CityIncidents';
import DetentionRegistry from 'game/economy/DetentionRegistry';
import Economy, { DEFAULT_ECONOMY_PARAMS } from 'game/economy/Economy';
import Habits from 'game/population/Habits';
import KnownFacts from 'game/population/KnownFacts';
import Mood from 'game/population/Mood';
import Needs from 'game/population/Needs';
import PetRegistry, { PETS_CONFIG } from 'game/population/PetRegistry';
import Traits from 'game/population/Traits';
import SocialGraph from 'game/population/SocialGraph';
import EventEngine from 'game/events/EventEngine';
import { maybeConceive } from 'game/population/Conception';
import Inventory from 'game/objects/Inventory';
import { generateBuildingObjects } from 'game/objects/ObjectGeneration';
import SchoolRegistry, { SchoolSeat, SchoolCandidate } from 'game/skills/SchoolRegistry';
import SkillBook from 'game/skills/SkillBook';
import { WORK_DAILY_GAIN, PROMOTION_EVENT } from 'game/skills/SkillProgression';
import SkillRegistry from 'game/skills/SkillRegistry';
import businessesConfig from 'json/businesses.json';
import jobsConfig from 'json/jobs.json';
import schoolsConfig from 'json/schools.json';
import { JobTable, JobDefinition, JobRank, BusinessBlueprintTable } from 'types/Business';
import { LogicalLocation, TransitionHandle, WorldAdapter, SimulationMode } from 'types/Execution';
import { PersonId, PopulationState } from 'types/Genealogy';
import { locationKey, InventoryState, ObjectInstance, ObjectContainerRef } from 'types/Objects';
import { SchoolConfig } from 'types/School';
import { SERVICES_CONFIG } from 'game/economy/CityServices';
import { TickResult } from 'types/LifeEvent';
import { evaluateCurve } from 'util/curve';
import { SeededRandom, hashStringToSeed } from 'util/random';
import { ageAt, isAliveAt, spouseAt, parentsOf, childrenOf } from 'util/kinship';
import { schoolDailyGain, countSchoolDays, SCHOOL_BASIC_CAP } from 'util/school';
import { dayOfTick, dayOfWeekOfDay, WEEKDAY_NAMES } from 'util/time';
import { JobPosition } from 'types/Work';
import { SkillTimeline, SkillSnapshot, PersonSkills } from 'types/Skill';
import residencesConfig from 'json/residences.json';

const JOBS = jobsConfig as unknown as JobTable;
const BLUEPRINTS = businessesConfig as unknown as BusinessBlueprintTable;
const SCHOOL_CONFIG = schoolsConfig as unknown as SchoolConfig;
// The house's placement tags drive home object generation (mirrors City's HOUSE_PLACEMENT_TAGS).
const HOUSE_PLACEMENT_TAGS: readonly string[] = (residencesConfig as { house: { tags: string[] } }).house.tags;
// Job-core skills bias the adult skill assortment toward employable abilities (SkillBook.initialize contract).
export const JOB_CORE_SKILLS: ReadonlySet<string> = new Set(Object.values(JOBS).flatMap(job => job.requiredSkills ?? []));
// Job definition keyed by title, built once (task 078): accrueWorkDays looked this up with an O(jobs)
// Object.entries(JOBS).find per employed person per step; a precomputed map makes it O(1).
const JOB_DEF_BY_TITLE = new Map<string, { key: string; def: JobDefinition }>(
    Object.entries(JOBS).map(([key, def]) => [def.title, { key, def }]));

const LOGICAL_SALT = 0x077;
// The abstract detention facility (task 121): off-map the town "has" a station (the hasVenue posture), so
// sentences are servable; the detained hook holds people at this logical key.
const DETENTION_FACILITY_KEY = 'facility:police_station';
// A prior got_caught within this window makes the next conviction a repeat offense (mirrors City's window).
const CRIMINAL_RECORD_WINDOW_TICKS = 2 * 8640;

export interface LogicalWorldConfig {
    homes: boolean;
    schools: boolean;
    jobs: boolean;
    objects: boolean;
}

export const DEFAULT_LOGICAL_WORLD_CONFIG: LogicalWorldConfig = { homes: true, schools: true, jobs: true, objects: true };

interface LogicalBusiness {
    key: string;
    blueprintKey: string;
    positions: JobPosition[];
    filled: boolean[]; // parallel to positions
    position: { row: number; col: number } | null; // off-map: null (distance scored at max, JobMarket convention)
}

// The facts bundle the generator hands to runTick. The offline model drives skill progression by DIRECT
// per-step accrual (runDaily), not the intra-day shift obligation (which coarse stepping can't hit), so the
// TickRunner only needs the world + markets (jobMarket for get_job/layoff, skills for education) + inventory —
// no jobOf/schoolOf/skillProgression facts.
export interface LogicalTickFacts {
    ctx: { mode: SimulationMode; world: WorldAdapter; markets: { jobMarket: LogicalJobMarket | null; housing: HousingMarketLike; skills: SkillRegistry | null; social: SocialGraph; needs: Needs; agenda: Agenda; traits: Traits | null; habits: Habits; mood: Mood; ledger: Economy; incidents: CityIncidents; pets: PetRegistry; knownFacts: KnownFacts } };
    inventory: Inventory;
}

// The logical housing market (LP-6 / task 122): moved_out_of_parents now gates on canMoveOut, which reads
// the housing market and defaults to FALSE when absent. The off-map world's housing is elastic (121:
// cohabitation/move-out are logical relocations without vacancy constraints), so the logical answer is a
// standing yes — the deliberate resolution of the coupling the 122 ticket flagged.
interface HousingMarketLike { canMoveOut(personId: PersonId): boolean }
const LOGICAL_HOUSING: HousingMarketLike = { canMoveOut: () => true };

export default class LogicalWorld implements WorldAdapter {
    readonly mode: SimulationMode = 'bootstrap';

    private config: LogicalWorldConfig;
    private worldSeed: number;
    private rng: SeededRandom;

    // Homes + current location (WorldAdapter state).
    private homeKeyOf = new Map<PersonId, string>();
    // Reverse index home key → members (dead retained like homeKeyOf; occupant queries filter by isAliveAt).
    private byHomeKey = new Map<string, Set<PersonId>>();
    private locationNow = new Map<PersonId, LogicalLocation>();
    private nextHandleId = 0;
    // Reverse index location-key → present people, so peopleAt is O(occupants) instead of O(all agents). The
    // social hook queries it once per idle person per tick, so the naive scan was O(agents²)/step — the daily
    // 1000-agent bottleneck. `locKeyOf` caches each person's current effective-location key for O(1) moves.
    private byLocationKey = new Map<string, Set<PersonId>>();
    private locKeyOf = new Map<PersonId, string>();

    // Subsystems (reused, scene-free).
    readonly inventory: Inventory;
    // The elective social graph (task 083): off-map interactions grow the same edges live play does.
    readonly socialGraph = new SocialGraph();
    readonly needs = new Needs();
    readonly mood = new Mood();
    readonly habits = new Habits();
    readonly agenda = new Agenda();
    // The city-system stores live play wires through City (task 121): the same scene-free classes, owned
    // here so the deep sim runs the SAME loops — justice, pets, gossip, money — instead of dropping their
    // signals on the floor (the headless-gap sweep: crimes were never filed, adoptions never registered,
    // sick-visit counterparts never landed, and money read 0 for everyone).
    readonly incidents = new CityIncidents();
    readonly detention = new DetentionRegistry();
    readonly pets = new PetRegistry();
    readonly knownFacts = new KnownFacts();
    readonly economy = new Economy();
    // Injected by the generator (task 087) — traits derive from the pool the generator owns.
    traits: Traits | null = null;
    readonly schoolRegistry: SchoolRegistry;
    private schoolSeats: SchoolSeat[] = [];
    private jobMarket: LogicalJobMarket | null = null;

    // Per-window skill snapshotting (task 077 fix): a per-person timeline of skill states, so selection can
    // install each drawn person's skills AS OF the chosen window instead of an end-of-generation snapshot.
    private skillTimeline = new Map<PersonId, SkillSnapshot[]>();
    private lastSkillSig = new Map<PersonId, string>();

    constructor(worldSeed: number, config: LogicalWorldConfig = DEFAULT_LOGICAL_WORLD_CONFIG) {
        this.worldSeed = worldSeed;
        this.config = config;
        this.rng = new SeededRandom(worldSeed).fork(LOGICAL_SALT);
        this.inventory = new Inventory();
        this.schoolRegistry = new SchoolRegistry();
    }

    // --- WorldAdapter ---------------------------------------------------------------------------------------

    private homeLocation(personId: PersonId): LogicalLocation {
        const key = this.homeKeyOf.get(personId);
        return key ? { kind: 'building', key } : { kind: 'home' };
    }

    locationOf(personId: PersonId): LogicalLocation {
        return this.locationNow.get(personId) ?? this.homeLocation(personId);
    }

    objectLocationOf(personId: PersonId): LogicalLocation {
        const now = this.locationNow.get(personId);
        return now && now.kind === 'building' ? now : this.homeLocation(personId);
    }

    peopleAt(location: LogicalLocation): PersonId[] {
        return [...(this.byLocationKey.get(locationKey(location)) ?? [])].sort();
    }

    // Moves a person to `locKey` in the reverse index (O(1)); a no-op when unchanged.
    private setLocationIndex(personId: PersonId, locKey: string): void {
        const previous = this.locKeyOf.get(personId);
        if (previous === locKey) {
            return;
        }
        if (previous !== undefined) {
            this.byLocationKey.get(previous)?.delete(personId);
        }
        let set = this.byLocationKey.get(locKey);
        if (!set) {
            set = new Set();
            this.byLocationKey.set(locKey, set);
        }
        set.add(personId);
        this.locKeyOf.set(personId, locKey);
    }

    hasVenue(): boolean {
        return true; // abstract venues always exist off-map (task 107)
    }

    objectsAt(location: LogicalLocation): string[] {
        return this.inventory.instancesAtLocation(locationKey(location)).map(instance => instance.id);
    }

    register(personId: PersonId): void {
        this.assignHome(personId, null);
    }

    requestTransition(personId: PersonId, target: LogicalLocation, tick: number, causationId: number | null): TransitionHandle {
        this.locationNow.set(personId, target);
        this.setLocationIndex(personId, locationKey(target));
        return {
            id: this.nextHandleId++,
            personId,
            target,
            status: 'arrived', // no visual layer to wait for
            requestedAtTick: tick,
            resolvedAtTick: tick,
            causationId,
        };
    }

    // --- Homes ----------------------------------------------------------------------------------------------

    // Assigns a stable home: a newborn joins its mother's home; a partner joins their (already-homed) partner;
    // a founder gets a fresh home. Static (no move-out churn this iteration — task 077 §9 open decision), which
    // is enough for per-home object pools + co-location. `pool` lets births resolve the mother; null for a bare
    // register (founders / co-location roster).
    assignHome(personId: PersonId, pool: PopulationState['people'] | null): void {
        if (this.homeKeyOf.has(personId)) {
            return; // already homed (idempotent); the person is already in the location index
        }
        let homeKey = this.config.homes ? `home:${personId}` : 'home';
        const person = this.config.homes ? pool?.[personId] : undefined;
        if (person) {
            // A partner joins their (already-homed) partner; else a child joins a homed parent.
            const partnerHome = person.partnerships.map(p => this.homeKeyOf.get(p.partnerId)).find(h => h !== undefined);
            const parentHome = [person.motherId, person.fatherId].map(id => (id ? this.homeKeyOf.get(id) : undefined)).find(h => h !== undefined);
            homeKey = partnerHome ?? parentHome ?? homeKey;
        }
        this.homeKeyOf.set(personId, homeKey);
        this.indexHomeMember(personId, homeKey);
        // Effective location starts at home (no transition yet) — index it so co-location sees them immediately.
        this.setLocationIndex(personId, locationKey(this.homeLocation(personId)));
    }

    private indexHomeMember(personId: PersonId, homeKey: string): void {
        let members = this.byHomeKey.get(homeKey);
        if (!members) {
            members = new Set();
            this.byHomeKey.set(homeKey, members);
        }
        members.add(personId);
    }

    // The LIVING members of a home, sorted (deterministic sweeps iterate this).
    private livingMembersOf(homeKey: string, pool: PopulationState['people'], tick: number): PersonId[] {
        const members: PersonId[] = [];
        for (const personId of this.byHomeKey.get(homeKey) ?? []) {
            const person = pool[personId];
            if (person && isAliveAt(person, tick)) {
                members.push(personId);
            }
        }
        return members.sort();
    }

    // Household churn (task 121): re-homes a person — the primitive under cohabitation and move-out. If they
    // are physically AT the old home, they move with it (the location index follows); a fresh home key gets
    // its one-time object fill so the new household has a real house around it.
    relocateHome(personId: PersonId, newKey: string, tick: number): void {
        const oldKey = this.homeKeyOf.get(personId);
        if (oldKey === newKey) {
            return;
        }
        if (oldKey !== undefined) {
            this.byHomeKey.get(oldKey)?.delete(personId);
        }
        this.homeKeyOf.set(personId, newKey);
        this.indexHomeMember(personId, newKey);
        const atKey = this.locKeyOf.get(personId);
        if (oldKey !== undefined && atKey === locationKey({ kind: 'building', key: oldKey })) {
            this.locationNow.delete(personId); // physically at the old home — they move with the household
            this.setLocationIndex(personId, locationKey(this.homeLocation(personId)));
        }
        if (this.config.objects) {
            this.ensureHomeObjects(personId, tick);
        }
    }

    // Newlywed cohabitation (task 121, mirroring City.resolveCohabitation): the LARGER household stays put,
    // the smaller side moves in — ties keep the SUBJECT's home — and the mover's dependent minor children
    // living with them come along. Logical homes are elastic, so the live capacity check has no analogue.
    cohabit(state: PopulationState, subjectId: PersonId, tick: number, ticksPerYear: number): void {
        if (!this.config.homes) {
            return;
        }
        const pool = state.people;
        const spouseId = spouseAt(pool, subjectId, tick);
        if (!spouseId) {
            return;
        }
        const subjectHome = this.homeKeyOf.get(subjectId);
        const spouseHome = this.homeKeyOf.get(spouseId);
        if (!subjectHome || !spouseHome || subjectHome === spouseHome) {
            return;
        }
        const subjectSize = this.livingMembersOf(subjectHome, pool, tick).length;
        const spouseSize = this.livingMembersOf(spouseHome, pool, tick).length;
        const moverId = spouseSize > subjectSize ? subjectId : spouseId;
        const targetKey = spouseSize > subjectSize ? spouseHome : subjectHome;
        const sourceKey = spouseSize > subjectSize ? subjectHome : spouseHome;
        // The mover's dependent minors: their own children, minors, living in the mover's home.
        const movers = [moverId];
        for (const childId of this.livingMembersOf(sourceKey, pool, tick)) {
            const child = pool[childId]!;
            if ((child.motherId === moverId || child.fatherId === moverId) && ageAt(child, tick, ticksPerYear) < 18) {
                movers.push(childId);
            }
        }
        for (const id of movers) {
            this.relocateHome(id, targetKey, tick);
        }
    }

    // Adult move-out (task 121, closing the 077 §9 open decision): reacts to a committed
    // `moved_out_of_parents` event — relocation only applies when the subject actually still lives with a
    // living parent (the texture event fires for any adult); their own minor children come along.
    moveOutOfParents(state: PopulationState, personId: PersonId, tick: number, ticksPerYear: number): void {
        if (!this.config.homes) {
            return;
        }
        const pool = state.people;
        const person = pool[personId];
        const homeKey = this.homeKeyOf.get(personId);
        if (!person || !homeKey) {
            return;
        }
        const livesWithParent = [person.motherId, person.fatherId].some(parentId =>
            parentId !== null && this.homeKeyOf.get(parentId) === homeKey
            && pool[parentId] !== undefined && isAliveAt(pool[parentId]!, tick));
        if (!livesWithParent) {
            return;
        }
        const movers = [personId];
        for (const childId of this.livingMembersOf(homeKey, pool, tick)) {
            const child = pool[childId]!;
            if ((child.motherId === personId || child.fatherId === personId) && ageAt(child, tick, ticksPerYear) < 18) {
                movers.push(childId);
            }
        }
        const newKey = `home:${personId}`;
        for (const id of movers) {
            this.relocateHome(id, newKey, tick);
        }
        // The spouse follows too (marrying while still at the parents' — the couple starts their own home).
        const spouseId = spouseAt(pool, personId, tick);
        if (spouseId && this.homeKeyOf.get(spouseId) === homeKey) {
            this.relocateHome(spouseId, newKey, tick);
        }
    }

    // --- Entry / exit ---------------------------------------------------------------------------------------

    // A person enters detailed simulation (founder at t0, or a newborn): assign a home, one-time age-appropriate
    // skill seeding (SkillBook.initialize — idempotent), and a first home object fill.
    onEnter(personId: PersonId, ageYears: number, birthTick: number, tick: number, skillBook: SkillBook, pool: PopulationState['people']): void {
        this.assignHome(personId, pool);
        skillBook.initialize(personId, ageYears, birthTick, tick, this.worldSeed, JOB_CORE_SKILLS);
        if (this.config.objects) {
            this.ensureHomeObjects(personId, tick);
        }
        // Starting funds (task 121, mirroring the live placement seed): adults arrive with the configured
        // stake; people who come of age IN the sim start from zero and earn wages — the poverty modifiers
        // then read a real distribution instead of a flat 0 for everyone.
        if (ageYears >= 18 && this.economy.getPersonBalance(personId) === 0) {
            this.economy.adjustPerson(personId, DEFAULT_ECONOMY_PARAMS.startingPersonFunds);
        }
    }

    onDeath(personId: PersonId): void {
        this.jobMarket?.fire(personId);
        this.socialGraph.removePerson(personId); // death dissolves elective bonds (task 083)
        this.needs.removePerson(personId);
        this.mood.removePerson(personId);
        this.habits.removePerson(personId);
        this.agenda.removePerson(personId);
        this.pets.removeOwner(personId); // companions don't outlive the record (mirrors live teardown)
        this.knownFacts.removePerson(personId);
        this.schoolRegistry.release(personId);
        this.locationNow.delete(personId);
        // Remove from the co-location index so peopleAt never returns the dead (homeKeyOf is kept; the
        // isAliveAt guards in the daily sweeps already skip them).
        const locKey = this.locKeyOf.get(personId);
        if (locKey !== undefined) {
            this.byLocationKey.get(locKey)?.delete(personId);
            this.locKeyOf.delete(personId);
        }
    }

    private filledHomes = new Set<string>();

    private ensureHomeObjects(personId: PersonId, tick: number): void {
        const homeKey = this.homeKeyOf.get(personId);
        if (!homeKey || this.filledHomes.has(homeKey)) {
            return;
        }
        this.filledHomes.add(homeKey);
        generateBuildingObjects({ anchorKey: homeKey, tags: HOUSE_PLACEMENT_TAGS, host: 'house', worldSeed: this.worldSeed, tick }, this.inventory);
    }

    // --- Schools --------------------------------------------------------------------------------------------

    // Builds a logical school pool with enough seats for the expected school-age cohort (~15% of the target
    // living band). Off-map schools have null positions (distance scored at max — the sweep still enrolls).
    buildSchools(targetLiving: number): void {
        if (!this.config.schools) {
            return;
        }
        const size = 5; // a mid-size school; capacity curve maps size → seats
        const seatsPerSchool = Math.max(1, Math.round(evaluateCurve(SCHOOL_CONFIG.capacity, size)));
        const schoolAgeShare = Math.max(seatsPerSchool, Math.ceil(targetLiving * 0.2)); // generous, no unseated child
        const count = Math.max(1, Math.ceil(schoolAgeShare / seatsPerSchool));
        this.schoolSeats = [];
        for (let i = 0; i < count; i++) {
            this.schoolSeats.push({ key: `school:${i}`, seats: seatsPerSchool, position: null });
        }
    }

    // The sorted living ids to sweep each step. Prefers the generator's incremental `living` set (task 078):
    // homeKeyOf RETAINS the dead (never pruned), so iterating it grew O(total-ever-lived) per step over a long
    // run — iterating the living set keeps the day-cadence sweeps O(living). Falls back to homeKeyOf (alive-
    // filtered) when no living set is supplied (e.g. the unit test), preserving the identical set of people.
    private sweepIds(state: PopulationState, tick: number, living?: ReadonlySet<PersonId>): PersonId[] {
        const source = living ?? this.homeKeyOf.keys();
        const ids: PersonId[] = [];
        for (const personId of source) {
            if (!this.homeKeyOf.has(personId)) {
                continue;
            }
            const person = state.people[personId];
            if (person && isAliveAt(person, tick)) {
                ids.push(personId);
            }
        }
        return ids.sort();
    }

    // The daily enrollment sweep (mirrors City.runSchoolSweeps): enroll/release school-age children, invoking
    // the education texture events so the log carries them.
    runSchoolSweep(state: PopulationState, tick: number, ticksPerYear: number, engine: EventEngine, ids?: PersonId[]): void {
        if (!this.config.schools || this.schoolSeats.length === 0) {
            return;
        }
        const pool = state.people;
        const candidates: SchoolCandidate[] = [];
        for (const personId of ids ?? this.sweepIds(state, tick)) {
            const person = pool[personId];
            if (!person) {
                continue;
            }
            const ageYears = ageAt(person, tick, ticksPerYear);
            if (ageYears < SCHOOL_CONFIG.minAgeYears) {
                continue;
            }
            candidates.push({ personId, ageYears, homePosition: null });
        }
        candidates.sort((a, b) => a.personId.localeCompare(b.personId));
        const outcome = this.schoolRegistry.sweep(SCHOOL_CONFIG, candidates, this.schoolSeats, tick);
        for (const assignment of outcome.enrolled) {
            engine.invoke(state, 'started_school', assignment.personId, tick, ticksPerYear, { source: 'system', causationId: null });
        }
        for (const personId of outcome.agedOut) {
            engine.invoke(state, 'graduated_school', personId, tick, ticksPerYear, { source: 'system', causationId: null });
        }
    }

    // Early-childhood milestone grants for under-school-age children (mirrors City.runSkillMilestones).
    runSkillMilestones(state: PopulationState, tick: number, ticksPerYear: number, skillBook: SkillBook, ids?: PersonId[]): void {
        const pool = state.people;
        for (const personId of ids ?? this.sweepIds(state, tick)) {
            const person = pool[personId];
            if (!person) {
                continue;
            }
            const ageYears = ageAt(person, tick, ticksPerYear);
            if (ageYears >= 1 && ageYears < SCHOOL_CONFIG.minAgeYears) {
                skillBook.applyMilestones(personId, ageYears, tick);
            }
        }
    }

    // --- Jobs -----------------------------------------------------------------------------------------------

    // Generates a logical business roster with enough positions for the working-age cohort, and the job market
    // over it. Sized to the target living band; a fixed roster (task 077 §9 open decision: grow-with-population
    // is a future refinement).
    buildJobs(skillBook: SkillBook, targetLiving: number): void {
        if (!this.config.jobs) {
            return;
        }
        const businesses: LogicalBusiness[] = [];
        const targetPositions = Math.max(1, Math.ceil(targetLiving * 0.55)); // ~working-age share
        const blueprintKeys = Object.keys(BLUEPRINTS).sort();
        let totalPositions = 0;
        let index = 0;
        while (totalPositions < targetPositions && blueprintKeys.length > 0) {
            const blueprintKey = blueprintKeys[index % blueprintKeys.length]!;
            const blueprint = BLUEPRINTS[blueprintKey]!;
            const size = this.rng.nextInt(blueprint.size.min, blueprint.size.max);
            const instance = generateBusiness(blueprintKey, blueprint, JOBS, `logical-${index}`, size);
            if (instance.positions.length > 0) {
                businesses.push({
                    key: `biz:${index}`,
                    blueprintKey,
                    positions: instance.positions,
                    filled: instance.positions.map(() => false),
                    position: null,
                });
                totalPositions += instance.positions.length;
            }
            index++;
            if (index > targetPositions * 4 + blueprintKeys.length) {
                break; // safety: never loop forever on tiny/edge blueprints
            }
        }
        this.jobMarket = new LogicalJobMarket(businesses, skillBook);
    }

    // --- Day-cadence: sweeps + DIRECT progression accrual (task 077 §3) -------------------------------------

    // Runs once per generator step over the window [fromTick, toTick): early-childhood milestones, the school
    // enrollment sweep, then DIRECT skill accrual for the days elapsed — school-day gains to enrolled children
    // and work-day gains + promotion to employed adults. This replaces the intra-day shift-obligation chain
    // (attend_school / stopped_working), which coarse stepping can't drive, with a stepping-tolerant accrual
    // that reproduces the same per-day numbers (schoolDailyGain / WORK_DAILY_GAIN). Deterministic, RNG-free.
    runDaily(state: PopulationState, fromTick: number, toTick: number, ticksPerYear: number, skillBook: SkillBook, engine: EventEngine, living?: ReadonlySet<PersonId>): void {
        // Sweep the living once per step (task 078) and reuse the sorted list across every sub-sweep, so the
        // ever-growing homeKeyOf (which retains the dead) is never re-iterated four times per step.
        const ids = this.sweepIds(state, fromTick, living);
        this.runSkillMilestones(state, fromTick, ticksPerYear, skillBook, ids);
        this.runSchoolSweep(state, fromTick, ticksPerYear, engine, ids);
        const fromDay = dayOfTick(fromTick);
        const toDay = dayOfTick(toTick);
        if (this.config.schools) {
            this.accrueSchoolDays(state, fromDay, toDay, skillBook, fromTick, ids);
        }
        if (this.config.jobs && this.jobMarket) {
            this.accrueWorkDays(state, fromDay, toDay, ticksPerYear, skillBook, engine, toTick, ids);
        }
        // The city-system day sweeps (task 121) — the off-map analogues of City.handleNewDay's loops.
        this.collectGarbage(fromTick);
        this.runPoliceDay(state, engine, fromTick, ticksPerYear);
        this.runReleasesDay(state, engine, fromTick, ticksPerYear);
        this.runPetDay(state, engine, fromTick, ticksPerYear);
    }

    // --- City-system mirrors (task 121) ----------------------------------------------------------------------
    // Off-map analogues of City's signal handlers and day sweeps — same rules, same salted-RNG conventions,
    // engine-invoked milestones so the histories carry the chains live play produces. The live loops read the
    // map (Field/Workplace); these read the logical stores. Divergences are deliberate and documented inline
    // (elastic housing, abstract facilities, neutral service coverage).

    // Curbside collection (the 112 loop's off-map analogue): live collectors consume `bag_of_garbage` on
    // their rounds; off-map the abstract service collects daily, so the curb never accumulates unboundedly
    // (pre-121, a 4-year small-scale run stacked 25k bags at `outside`).
    private collectGarbage(tick: number): void {
        for (const id of this.inventory.matchingIdsAtLocation('outside', { archetype: 'bag_of_garbage' })) {
            this.inventory.removeInstance(id);
        }
        void tick;
    }

    // Mirrors City.runPoliceWork: cold cases fire impunity for witnessed suspects; open witnessed cases
    // resolve with odds scaled by coverage — off-map, the NEUTRAL coverage the hazards already assume.
    private runPoliceDay(state: PopulationState, engine: EventEngine, tick: number, ticksPerYear: number): void {
        for (const wentCold of this.incidents.sweepCold(tick)) {
            if (wentCold.suspectId && wentCold.witnesses > 0) {
                this.invokeMilestone(state, engine, 'got_away_with_it', wentCold.suspectId, tick, ticksPerYear);
            }
        }
        const coverage = SERVICES_CONFIG.neutralCoverage;
        if (coverage <= 0) {
            return;
        }
        const rng = new SeededRandom((this.worldSeed ^ hashStringToSeed(`police#${Math.floor(tick / 24)}`)) >>> 0);
        for (const incident of [...this.incidents.open()].sort((a, b) => a.id - b.id)) {
            if (incident.witnesses <= 0 || !incident.suspectId) {
                continue; // nobody saw it — the case is unknowable (the 099 contract)
            }
            const chance = Math.min(0.9, 0.12 * coverage * Math.min(incident.witnesses, 3));
            if (rng.next() < chance) {
                this.convictSuspect(state, engine, incident.suspectId, tick, ticksPerYear);
            }
        }
    }

    // Mirrors City.runReleases: lapsed sentences walk free.
    private runReleasesDay(state: PopulationState, engine: EventEngine, tick: number, ticksPerYear: number): void {
        for (const personId of this.detention.due(tick)) {
            this.detention.release(personId);
            this.invokeMilestone(state, engine, 'released_from_jail', personId, tick, ticksPerYear);
        }
    }

    // Mirrors City.runPetLifecycle: past the species lifespan, a small daily passing roll; the owner grieves
    // through the normal valence machinery.
    private runPetDay(state: PopulationState, engine: EventEngine, tick: number, ticksPerYear: number): void {
        const day = Math.floor(tick / 24);
        for (const pet of this.pets.all()) {
            const spec = PETS_CONFIG.species[pet.species];
            if (!spec) {
                continue;
            }
            if ((tick - pet.birthTick) / ticksPerYear < spec.lifespanYears) {
                continue;
            }
            const rng = new SeededRandom((this.worldSeed ^ hashStringToSeed('petDeath#' + pet.id + '#' + day)) >>> 0);
            if (rng.next() >= 0.05) {
                continue;
            }
            this.pets.removePet(pet.id);
            this.invokeMilestone(state, engine, 'pet_passed_away', pet.ownerId, tick, ticksPerYear);
        }
    }

    // The tick's signal/commit reactions (task 121) — the off-map analogue of City.handleTick's onCommitted
    // block. The generator calls this right after applying each tick's results.
    handleTickOutcomes(state: PopulationState, engine: EventEngine, result: TickResult, tick: number, ticksPerYear: number): void {
        for (const signal of result.signals) {
            if (signal.personId === null) {
                continue;
            }
            if (signal.signal === 'partnershipFormed') {
                this.cohabit(state, signal.personId, tick, ticksPerYear);
            } else if (signal.signal === 'crimeCommitted') {
                this.fileIncident(state, engine, signal.personId, tick, ticksPerYear);
            } else if (signal.signal === 'chaseConcluded') {
                this.resolveChase(state, engine, signal.personId, tick, ticksPerYear);
            } else if (signal.signal === 'petAdopted') {
                this.resolveAdoption(state, engine, signal.personId, tick, ticksPerYear);
            }
        }
        for (const commit of result.committed) {
            if (commit.eventId === 'had_sex') {
                // Conception rides intimacy (W4 / P1-6) — the same salted roll live play runs, so the
                // deep-sim and the map agree on how babies happen.
                maybeConceive(state, engine, commit.personId, tick, ticksPerYear, commit.seq);
            }
            if (commit.eventId === 'moved_out_of_parents') {
                this.moveOutOfParents(state, commit.personId, tick, ticksPerYear);
            } else if (commit.eventId === 'shared_gossip' && typeof commit.params?.['target'] === 'string') {
                this.transferGossip(commit.personId, commit.params['target'], tick);
            } else if (commit.eventId === 'visited_person_in_jail' && typeof commit.params?.['target'] === 'string') {
                engine.invoke(state, 'received_a_visitor', commit.params['target'], tick, ticksPerYear,
                    { source: 'system', causationId: commit.seq });
            } else if (commit.eventId === 'visited_sick_relative' && typeof commit.params?.['target'] === 'string') {
                engine.invoke(state, 'was_visited_while_sick', commit.params['target'], tick, ticksPerYear,
                    { source: 'system', causationId: commit.seq });
            }
        }
    }

    // Mirrors City.fileIncident: the crime kind from the tick's log tail, witnesses from real co-location.
    private fileIncident(state: PopulationState, engine: EventEngine, suspectId: PersonId, tick: number, ticksPerYear: number): void {
        void ticksPerYear;
        void state;
        const log = engine.getPersonLog(suspectId);
        let kind: 'shoplifting' | 'pickpocketing' | null = null;
        for (let index = log.length - 1; index >= 0 && log[index]!.tick === tick; index--) {
            const entry = log[index]!;
            if (entry.kind === 'event' && entry.defId === 'committed_shoplifting') {
                kind = 'shoplifting';
                break;
            }
            if (entry.kind === 'event' && entry.defId === 'committed_pickpocketing') {
                kind = 'pickpocketing';
                break;
            }
        }
        if (!kind) {
            return;
        }
        const location = this.locationOf(suspectId);
        const witnesses = this.peopleAt(location).filter(id => id !== suspectId).length;
        this.incidents.report(kind, tick, locationKey(location), suspectId, witnesses);
    }

    // Mirrors City.resolveChase: the same catch-chance formula over age and health.
    private resolveChase(state: PopulationState, engine: EventEngine, suspectId: PersonId, tick: number, ticksPerYear: number): void {
        if (!this.incidents.isWanted(suspectId)) {
            return;
        }
        const record = state.people[suspectId];
        if (!record) {
            return;
        }
        const rng = new SeededRandom((this.worldSeed ^ hashStringToSeed(`chase#${suspectId}#${tick}`)) >>> 0);
        const age = ageAt(record, tick, ticksPerYear);
        const health = Number(engine.contextFor(state, suspectId, tick, ticksPerYear).getAttr('health') ?? 1);
        let catchChance = 0.55;
        if (age >= 50) {
            catchChance += 0.2;
        } else if (age < 25) {
            catchChance -= 0.15;
        }
        if (health < 0.7) {
            catchChance += 0.15;
        }
        if (rng.next() < catchChance) {
            this.arrestSuspect(state, engine, suspectId, tick, ticksPerYear);
        } else {
            this.invokeMilestone(state, engine, 'evaded_the_police', suspectId, tick, ticksPerYear);
        }
    }

    // Mirrors City.arrestSuspect: officer's act + counterpart, kin fan-out, the escort, then conviction.
    // Off-map the facility is the abstract station (the town "has" one — the hasVenue posture).
    private arrestSuspect(state: PopulationState, engine: EventEngine, suspectId: PersonId, tick: number, ticksPerYear: number): void {
        const pool = state.people;
        // The arresting officer: the first living police officer by id (live: first ON-DUTY officer — the
        // logical world has no shift clock at arrest time, so employment stands in for duty).
        const officerId = this.jobMarket
            ? [...this.jobMarket.employedWithTitle('Police Officer')].filter(id => pool[id] && isAliveAt(pool[id]!, tick)).sort()[0] ?? null
            : null;
        let arrestSeq: number | null = null;
        if (officerId) {
            const { outcome } = engine.invoke(state, 'arrested_suspect', officerId, tick, ticksPerYear,
                { source: 'system', causationId: null }, {}, {}, { target: suspectId });
            arrestSeq = outcome.ok ? outcome.seq : null;
        }
        engine.invoke(state, 'was_arrested', suspectId, tick, ticksPerYear, { source: 'system', causationId: arrestSeq });
        const kin = new Set<PersonId>();
        const spouse = spouseAt(pool, suspectId, tick);
        if (spouse) {
            kin.add(spouse);
        }
        for (const id of [...childrenOf(pool, suspectId), ...parentsOf(pool, suspectId)]) {
            kin.add(id);
        }
        for (const relativeId of [...kin].sort()) {
            this.invokeMilestone(state, engine, 'relative_arrested', relativeId, tick, ticksPerYear);
        }
        if (officerId) {
            engine.invoke(state, 'offered_a_ride', officerId, tick, ticksPerYear, { source: 'system', causationId: arrestSeq }, {}, {}, { target: suspectId });
            engine.invoke(state, 'got_a_ride', suspectId, tick, ticksPerYear, { source: 'system', causationId: arrestSeq });
            this.requestTransition(suspectId, { kind: 'building', key: DETENTION_FACILITY_KEY }, tick, arrestSeq);
        }
        this.convictSuspect(state, engine, suspectId, tick, ticksPerYear);
    }

    // Mirrors City.convictSuspect: repeat offenders serve record-scaled time at the abstract facility;
    // every open case closes; the fine moves through the ledger (external-mirrored — conserved).
    private convictSuspect(state: PopulationState, engine: EventEngine, suspectId: PersonId, tick: number, ticksPerYear: number): void {
        const context = engine.contextFor(state, suspectId, tick, ticksPerYear);
        const isRepeat = context.hasEvent('got_caught', { withinTicks: CRIMINAL_RECORD_WINDOW_TICKS });
        if (isRepeat) {
            const hardened = context.hasEvent('got_caught', { withinTicks: CRIMINAL_RECORD_WINDOW_TICKS, minCount: 2 });
            const days = hardened ? DEFAULT_ECONOMY_PARAMS.detentionDaysRepeat : DEFAULT_ECONOMY_PARAMS.detentionDays;
            this.detention.detain(suspectId, tick + days * 24, DETENTION_FACILITY_KEY);
            this.invokeMilestone(state, engine, 'was_detained', suspectId, tick, ticksPerYear);
        }
        for (const incident of this.incidents.all()) {
            if (incident.status === 'open' && incident.suspectId === suspectId) {
                this.incidents.resolve(incident.id, tick);
            }
        }
        this.economy.adjustPerson(suspectId, -DEFAULT_ECONOMY_PARAMS.crimeFineAmount);
        this.invokeMilestone(state, engine, 'got_caught', suspectId, tick, ticksPerYear);
    }

    // Mirrors City.resolveAdoption: cap-gated species draw + faker name, the species event lands.
    private resolveAdoption(state: PopulationState, engine: EventEngine, ownerId: PersonId, tick: number, ticksPerYear: number): void {
        if (this.pets.countOf(ownerId) >= PETS_CONFIG.maxPerOwner) {
            return;
        }
        const rng = new SeededRandom((this.worldSeed ^ hashStringToSeed('pet#' + ownerId + '#' + tick)) >>> 0);
        const entries = Object.entries(PETS_CONFIG.species).sort(([a], [b]) => a.localeCompare(b));
        const total = entries.reduce((sum, [, spec]) => sum + spec.weight, 0);
        let roll = rng.next() * total;
        let picked = entries[entries.length - 1]!;
        for (const entry of entries) {
            roll -= entry[1].weight;
            if (roll <= 0) {
                picked = entry;
                break;
            }
        }
        fakerPT_BR.seed((this.worldSeed ^ hashStringToSeed('petname#' + ownerId + '#' + tick)) >>> 0);
        const name = fakerPT_BR.person.firstName();
        this.pets.adopt(ownerId, picked[0], name, tick);
        this.invokeMilestone(state, engine, picked[1].event, ownerId, tick, ticksPerYear);
    }

    // Mirrors City.transferGossip: the speaker's juiciest fact (|valence| × recency) travels.
    private transferGossip(speakerId: PersonId, listenerId: PersonId, tick: number): void {
        const candidates = this.knownFacts.factsOf(speakerId, tick)
            .filter(fact => fact.aboutId !== listenerId && fact.aboutId !== speakerId);
        if (candidates.length === 0) {
            return;
        }
        const scored = candidates
            .map(fact => ({ fact, score: Math.abs(fact.valence) * Math.max(0, 1 - (tick - fact.learnedAtTick) / (90 * 24)) }))
            .sort((a, b) => b.score - a.score || a.fact.seq - b.fact.seq);
        this.knownFacts.learn(listenerId, { ...scored[0]!.fact, learnedAtTick: tick, viaWitness: false });
    }

    // Monthly wages + cost of living (task 121): the minimal off-map money loop. Employed people earn their
    // logical salary FROM the external sector; each home pays the live cost-of-living formula (housing +
    // per-capita over its living members) TO the external sector, debited to the eldest adult (the logical
    // head). Both flows are external-mirrored, so the money invariant holds. No business P&L, arrears, or
    // evictions off-map (elastic housing) — documented divergence.
    runMonthlyEconomy(state: PopulationState, tick: number, ticksPerYear: number, living: ReadonlySet<PersonId>): void {
        const pool = state.people;
        const ids = [...living].sort();
        if (this.config.jobs && this.jobMarket) {
            for (const personId of ids) {
                const assignment = this.jobMarket.assignmentOf(personId);
                if (assignment) {
                    this.economy.adjustPerson(personId, assignment.salary);
                }
            }
        }
        if (this.config.homes) {
            // Mirrors City.runCostOfLiving: the month's concrete purchases net off the abstract charge
            // (never below the housing cost), and the household drains AVAILABLE funds member-by-member
            // (adults first) — never forced negative. No arrears/evictions off-map (elastic housing).
            const materializedSpend = this.economy.drainMaterializedSpend();
            const seen = new Set<string>();
            for (const personId of ids) {
                const homeKey = this.homeKeyOf.get(personId);
                if (!homeKey || seen.has(homeKey)) {
                    continue;
                }
                seen.add(homeKey);
                const members = this.livingMembersOf(homeKey, pool, tick);
                if (members.length === 0) {
                    continue;
                }
                const adults = members.filter(id => ageAt(pool[id]!, tick, ticksPerYear) >= 18);
                const minors = members.filter(id => !adults.includes(id));
                const householdSpend = members.reduce((total, id) => total + (materializedSpend[id] ?? 0), 0);
                const fullExpense = DEFAULT_ECONOMY_PARAMS.housingCost + DEFAULT_ECONOMY_PARAMS.perCapitaCost * members.length;
                const expense = Math.max(DEFAULT_ECONOMY_PARAMS.housingCost, fullExpense - householdSpend);
                const funds = members.reduce((total, id) => total + Math.max(0, this.economy.getPersonBalance(id)), 0);
                let toCharge = Math.min(expense, funds);
                for (const id of [...adults, ...minors]) {
                    if (toCharge <= 0) {
                        break;
                    }
                    const share = Math.min(toCharge, Math.max(0, this.economy.getPersonBalance(id)));
                    if (share > 0) {
                        this.economy.adjustPerson(id, -share);
                        toCharge -= share;
                    }
                }
            }
        }
    }

    // Manual milestone invoke with the invalid-outcome tolerance City.fireMilestone has (unknown/limited
    // events are quiet no-ops — the engine's typed rejections are the contract).
    private invokeMilestone(state: PopulationState, engine: EventEngine, eventId: string, subjectId: PersonId | null, tick: number, ticksPerYear: number): void {
        if (!subjectId) {
            return;
        }
        engine.invoke(state, eventId, subjectId, tick, ticksPerYear, { source: 'system', causationId: null });
    }

    private accrueSchoolDays(state: PopulationState, fromDay: number, toDay: number, skillBook: SkillBook, tick: number, ids: PersonId[]): void {
        const days = countSchoolDays(SCHOOL_CONFIG, fromDay, toDay);
        if (days <= 0) {
            return;
        }
        const basics = Object.keys(skillBook.getManifest()).filter(id => skillBook.getManifest()[id]!.basic).sort();
        for (const personId of ids) {
            const assignment = this.schoolRegistry.assignmentOf(personId);
            const person = state.people[personId];
            if (!assignment || !person) {
                continue;
            }
            const gain = schoolDailyGain(SCHOOL_CONFIG, person.birthTick) * days;
            for (const basic of basics) {
                const current = skillBook.proficiency(personId, basic);
                if (current >= SCHOOL_BASIC_CAP) {
                    continue;
                }
                skillBook.grant(personId, basic, { toAtLeast: Math.min(SCHOOL_BASIC_CAP, current + gain) }, tick, 'school');
            }
        }
    }

    private accrueWorkDays(state: PopulationState, fromDay: number, toDay: number, ticksPerYear: number, skillBook: SkillBook, engine: EventEngine, tick: number, ids: PersonId[]): void {
        for (const personId of ids) {
            const assignment = this.jobMarket!.assignmentOf(personId);
            if (!assignment || !assignment.rankId) {
                continue;
            }
            const entry = JOB_DEF_BY_TITLE.get(assignment.title);
            if (!entry) {
                continue;
            }
            const { key: defKey, def: definition } = entry;
            const rankIndex = definition.ranks.findIndex(rank => rank.rankId === assignment.rankId);
            if (rankIndex === -1) {
                continue;
            }
            const rank = definition.ranks[rankIndex]!;
            const workDays = countWorkDays(fromDay, toDay, assignment.daysOfWeek);
            if (workDays <= 0) {
                continue;
            }
            for (const progress of rank.progresses) {
                skillBook.grant(personId, progress.skill, { add: WORK_DAILY_GAIN * progress.multiplier * workDays }, tick, `job:${defKey}`);
            }
            assignment.workDaysInRank = (assignment.workDaysInRank ?? 0) + workDays;
            assignment.totalWorkDays = (assignment.totalWorkDays ?? 0) + workDays;

            // Batch promotion: if the next rung's requirements are met and enough time in rank has accrued.
            const next = definition.ranks[rankIndex + 1];
            const minInRank = rank.promotion?.minWorkDaysInRank ?? rank.promotion?.evaluateEveryWorkDays ?? 30;
            if (next && assignment.workDaysInRank >= minInRank && skillBook.meets(personId, next.requires)) {
                assignment.rankId = next.rankId;
                assignment.workDaysInRank = 0;
                engine.invoke(state, PROMOTION_EVENT, personId, tick, ticksPerYear, { source: 'system', causationId: null });
            }
        }
    }

    // --- Tick facts -----------------------------------------------------------------------------------------

    tickFacts(skillBook: SkillBook, tick: number): LogicalTickFacts {
        const skillRegistry = new SkillRegistry(skillBook, tick);
        return {
            ctx: { mode: 'bootstrap', world: this, markets: { jobMarket: this.config.jobs ? this.jobMarket : null, housing: LOGICAL_HOUSING, skills: skillRegistry, social: this.socialGraph, needs: this.needs, agenda: this.agenda, traits: this.traits, habits: this.habits, mood: this.mood, ledger: this.economy, incidents: this.incidents, pets: this.pets, knownFacts: this.knownFacts } },
            inventory: this.inventory,
        };
    }

    // Detention facts for the TickPlan (task 121): the detained hook keeps sentenced people at the abstract
    // facility, and the planner's jail-visit producer lights up for their kin.
    detentionOf(personId: PersonId): { locationKey: string } | null {
        const record = this.detention.detentionOf(personId);
        return record ? { locationKey: record.locationKey } : null;
    }

    // Records a skill snapshot for every currently-living person whose skills CHANGED since their last
    // snapshot (dedup by a proficiency signature keeps static-skill people to a single entry). Called by the
    // generator at the snapshot cadence + once at the end. Deterministic, RNG-free.
    snapshotSkills(skillBook: SkillBook, tick: number, livingIds: Iterable<PersonId>): void {
        for (const personId of [...livingIds].sort()) {
            const skills = skillBook.skillsOf(personId);
            const keys = Object.keys(skills);
            if (keys.length === 0) {
                continue;
            }
            let sig = '';
            for (const key of keys.sort()) {
                sig += `${key}:${skills[key]!.proficiency.toFixed(3)};`;
            }
            if (this.lastSkillSig.get(personId) === sig) {
                continue; // unchanged since the last snapshot — no new entry
            }
            this.lastSkillSig.set(personId, sig);
            const copy = JSON.parse(JSON.stringify(skills)) as PersonSkills;
            const timeline = this.skillTimeline.get(personId) ?? [];
            timeline.push({ tick, skills: copy });
            this.skillTimeline.set(personId, timeline);
        }
    }

    // The per-person skill timeline, filtered to retained people (warm-up dead are pruned from the asset).
    skillTimelineState(retainedIds: Set<PersonId>): SkillTimeline {
        const out: SkillTimeline = {};
        for (const [personId, timeline] of this.skillTimeline) {
            if (retainedIds.has(personId) && timeline.length > 0) {
                out[personId] = timeline;
            }
        }
        return out;
    }

    // Hands back + clears the accumulated skill-timeline snapshots (task 077 streaming), keeping the per-person
    // dedup signatures so future snapshots still skip unchanged people. Warm-up-dead entries are filtered at
    // selection (by retained-pool membership), so no filtering is needed here.
    drainSkillTimeline(): SkillTimeline {
        const out: SkillTimeline = {};
        for (const [personId, timeline] of this.skillTimeline) {
            if (timeline.length > 0) {
                out[personId] = timeline;
            }
        }
        this.skillTimeline = new Map();
        return out;
    }

    // Person-carried instances only (task 077 §4): building fixtures regenerate on the live map, so only loose
    // Possessions travel into the asset. An instance is carried if its container chain roots at a retained
    // person's `possessions` (directly, or nested in a carried container — pencil-in-backpack).
    carriedInventoryState(retainedIds: Set<PersonId>): InventoryState {
        const full = this.inventory.getState();
        const instances = full.instances;
        const rootsAtRetainedPerson = (start: ObjectInstance): boolean => {
            const seen = new Set<string>();
            let current: ObjectInstance | undefined = start;
            while (current) {
                const container: ObjectContainerRef = current.container;
                if (container.kind === 'possessions') {
                    return retainedIds.has(container.personId);
                }
                if (container.kind === 'object') {
                    if (seen.has(container.instanceId)) {
                        return false; // defensive: broken cycle
                    }
                    seen.add(container.instanceId);
                    current = instances[container.instanceId];
                    continue;
                }
                return false; // location container (building fixture) — dropped
            }
            return false;
        };
        const kept: InventoryState['instances'] = {};
        for (const [id, instance] of Object.entries(instances)) {
            if (rootsAtRetainedPerson(instance)) {
                kept[id] = instance;
            }
        }
        return { instances: kept, nextInstanceSeq: full.nextInstanceSeq };
    }
}

// Days in [fromDay, toDay) whose weekday is one of the job's working days (absent/empty = every day).
function countWorkDays(fromDay: number, toDay: number, daysOfWeek?: readonly string[]): number {
    if (toDay <= fromDay) {
        return 0;
    }
    const allowed = daysOfWeek && daysOfWeek.length > 0 ? new Set(daysOfWeek) : null;
    if (!allowed) {
        return toDay - fromDay;
    }
    let count = 0;
    for (let day = fromDay; day < toDay; day++) {
        if (allowed.has(WEEKDAY_NAMES[dayOfWeekOfDay(day)]!)) {
            count++;
        }
    }
    return count;
}

// --- Logical job market (task 077) ---------------------------------------------------------------------------
// A scene-free JobMarket over logical businesses, porting the rank-matching + grant-on-hire logic from
// game/JobMarket.ts (which is Field/Workplace/Person-coupled). Distance scoring is dropped (off-map positions
// have no coordinates); selection is by rank fit, ties by business key. Grant applies ONLY inside a successful
// hire (atomic, revalidated) so evaluation can farm nothing — the CI no-farm rule.

const RANK_FIT_WEIGHT = 10;

interface RankMatch {
    defKey: string | null;
    rank: JobRank | null;
    viaGrant: boolean;
    fit: number;
}

export class LogicalJobMarket {
    private assignment = new Map<PersonId, JobPosition>();
    private employerOf = new Map<PersonId, string>();
    private defByTitle: Map<string, { key: string; def: JobDefinition }>;

    constructor(private businesses: LogicalBusiness[], private skillBook: SkillBook) {
        this.defByTitle = new Map(Object.entries(JOBS).map(([key, def]) => [def.title, { key, def }]));
    }

    assignmentOf(personId: PersonId): JobPosition | null {
        return this.assignment.get(personId) ?? null;
    }

    employerKeyOf(personId: PersonId): string | null {
        return this.employerOf.get(personId) ?? null;
    }

    isEmployed(personId: PersonId): boolean {
        return this.assignment.has(personId);
    }

    canHire(personId: PersonId): boolean {
        return this.bestMatch(personId) !== null;
    }

    // Everyone currently holding a position with the given title (task 121: the arrest mirror picks its
    // officer from real logical employment). Unsorted — callers order deterministically.
    employedWithTitle(title: string): PersonId[] {
        const ids: PersonId[] = [];
        for (const [personId, position] of this.assignment) {
            if (position.title === title) {
                ids.push(personId);
            }
        }
        return ids;
    }

    hire(personId: PersonId): boolean {
        const match = this.bestMatch(personId);
        if (!match) {
            return false;
        }
        const { business, positionIndex, rankMatch } = match;

        if (rankMatch.viaGrant && rankMatch.rank?.entryTrainingGrant) {
            const grants = rankMatch.rank.entryTrainingGrant.grants.map(grant => ({
                skill: grant.skill,
                amount: { toAtLeast: grant.toProficiency },
            }));
            const granted = this.skillBook.grantClosure(personId, grants, 0, `trainingGrant:${rankMatch.defKey}`);
            if (!granted.ok) {
                return false;
            }
            if (rankMatch.rank && !this.skillBook.meets(personId, rankMatch.rank.requires)) {
                return false;
            }
        }

        const position: JobPosition = {
            ...business.positions[positionIndex]!,
            ...(rankMatch.rank ? { rankId: rankMatch.rank.rankId, workDaysInRank: 0, totalWorkDays: 0 } : {}),
        };
        business.filled[positionIndex] = true;
        this.assignment.set(personId, position);
        this.employerOf.set(personId, business.key);
        return true;
    }

    fire(personId: PersonId): void {
        const employerKey = this.employerOf.get(personId);
        if (employerKey === undefined) {
            return;
        }
        const business = this.businesses.find(candidate => candidate.key === employerKey);
        const job = this.assignment.get(personId);
        if (business && job) {
            // Free the first filled position with a matching title.
            const index = business.positions.findIndex((position, i) => business.filled[i] && position.title === job.title);
            if (index >= 0) {
                business.filled[index] = false;
            }
        }
        this.assignment.delete(personId);
        this.employerOf.delete(personId);
    }

    private matchPosition(personId: PersonId, position: JobPosition): RankMatch | null {
        const entry = this.defByTitle.get(position.title);
        if (!entry || entry.def.ranks.length === 0) {
            if (position.requirements.every(requirement => this.skillBook.has(personId, requirement))) {
                return { defKey: null, rank: null, viaGrant: false, fit: position.requirements.length };
            }
            return null;
        }
        const ranks = entry.def.ranks;
        for (let index = ranks.length - 1; index >= 0; index--) {
            const rank = ranks[index]!;
            if (this.skillBook.meets(personId, rank.requires)) {
                return { defKey: entry.key, rank, viaGrant: false, fit: index * RANK_FIT_WEIGHT + rank.requires.length };
            }
        }
        const entryRank = ranks.find(rank => rank.entry);
        if (entryRank?.entryTrainingGrant && this.shortcutFeasible(personId, entryRank)) {
            return { defKey: entry.key, rank: entryRank, viaGrant: true, fit: entryRank.requires.length };
        }
        return null;
    }

    private shortcutFeasible(personId: PersonId, rank: JobRank): boolean {
        const grant = rank.entryTrainingGrant!;
        const floorOf = new Map(grant.grants.map(entry => [entry.skill, entry.toProficiency]));
        for (const requirement of rank.requires) {
            const covered = this.skillBook.proficiency(personId, requirement.skill) >= requirement.minProficiency
                || (floorOf.get(requirement.skill) ?? 0) >= requirement.minProficiency;
            if (!covered) {
                return false;
            }
        }
        const manifest = this.skillBook.getManifest();
        for (const entry of grant.grants) {
            for (const dependency of manifest[entry.skill]?.dependencies ?? []) {
                const reachable = Math.max(this.skillBook.proficiency(personId, dependency.skill), floorOf.get(dependency.skill) ?? 0);
                if (reachable < dependency.minProficiency) {
                    return false;
                }
            }
        }
        return true;
    }

    private bestMatch(personId: PersonId): { business: LogicalBusiness; positionIndex: number; rankMatch: RankMatch } | null {
        if (this.assignment.has(personId) || !this.skillBook.hasAny(personId)) {
            return null;
        }
        let best: { business: LogicalBusiness; positionIndex: number; rankMatch: RankMatch } | null = null;
        let bestScore = -Infinity;
        let bestKey = '';
        for (const business of [...this.businesses].sort((a, b) => a.key.localeCompare(b.key))) {
            for (let i = 0; i < business.positions.length; i++) {
                if (business.filled[i]) {
                    continue;
                }
                const rankMatch = this.matchPosition(personId, business.positions[i]!);
                if (!rankMatch) {
                    continue;
                }
                if (rankMatch.fit > bestScore || (rankMatch.fit === bestScore && business.key < bestKey)) {
                    bestScore = rankMatch.fit;
                    bestKey = business.key;
                    best = { business, positionIndex: i, rankMatch };
                }
            }
        }
        return best;
    }
}
