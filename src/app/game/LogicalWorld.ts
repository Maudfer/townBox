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

import Inventory from 'game/Inventory';
import SkillBook from 'game/SkillBook';
import SkillRegistry from 'game/SkillRegistry';
import SchoolRegistry, { SchoolSeat, SchoolCandidate } from 'game/SchoolRegistry';
import EventEngine from 'game/EventEngine';
import { WORK_DAILY_GAIN, PROMOTION_EVENT } from 'game/SkillProgression';
import { generateBusiness } from 'game/BusinessGen';
import { generateBuildingObjects } from 'game/ObjectGeneration';
import { sameLocation } from 'game/BootstrapWorld';

import { SeededRandom } from 'util/random';
import { evaluateCurve } from 'util/curve';
import { ageAt, isAliveAt } from 'util/kinship';
import { schoolDailyGain, countSchoolDays, SCHOOL_BASIC_CAP } from 'util/school';
import { dayOfTick, dayOfWeekOfDay, WEEKDAY_NAMES } from 'util/time';

import { PersonId, PopulationState } from 'types/Genealogy';
import { LogicalLocation, TransitionHandle, WorldAdapter, SimulationMode } from 'types/Execution';
import { locationKey, InventoryState, ObjectInstance, ObjectContainerRef } from 'types/Objects';
import { SchoolConfig } from 'types/School';
import { JobPosition } from 'types/Work';
import { JobTable, JobDefinition, JobRank, BusinessBlueprintTable } from 'types/Business';
import { SkillTimeline, SkillSnapshot, PersonSkills } from 'types/Skill';

import jobsConfig from 'json/jobs.json';
import businessesConfig from 'json/businesses.json';
import schoolsConfig from 'json/schools.json';
import residencesConfig from 'json/residences.json';

const JOBS = jobsConfig as unknown as JobTable;
const BLUEPRINTS = businessesConfig as unknown as BusinessBlueprintTable;
const SCHOOL_CONFIG = schoolsConfig as unknown as SchoolConfig;
// The house's placement tags drive home object generation (mirrors City's HOUSE_PLACEMENT_TAGS).
const HOUSE_PLACEMENT_TAGS: readonly string[] = (residencesConfig as { house: { tags: string[] } }).house.tags;
// Job-core skills bias the adult skill assortment toward employable abilities (SkillBook.initialize contract).
export const JOB_CORE_SKILLS: ReadonlySet<string> = new Set(Object.values(JOBS).flatMap(job => job.requiredSkills ?? []));

const LOGICAL_SALT = 0x077;

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
    ctx: { mode: SimulationMode; world: WorldAdapter; markets: { jobMarket: LogicalJobMarket | null; skills: SkillRegistry | null } };
    inventory: Inventory;
}

export default class LogicalWorld implements WorldAdapter {
    readonly mode: SimulationMode = 'bootstrap';

    private config: LogicalWorldConfig;
    private worldSeed: number;
    private rng: SeededRandom;

    // Homes + current location (WorldAdapter state).
    private homeKeyOf = new Map<PersonId, string>();
    private locationNow = new Map<PersonId, LogicalLocation>();
    private nextHandleId = 0;

    // Subsystems (reused, scene-free).
    readonly inventory: Inventory;
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
        const ids: PersonId[] = [];
        for (const personId of this.homeKeyOf.keys()) {
            if (sameLocation(this.locationOf(personId), location)) {
                ids.push(personId);
            }
        }
        return ids.sort();
    }

    objectsAt(location: LogicalLocation): string[] {
        return this.inventory.instancesAtLocation(locationKey(location)).map(instance => instance.id);
    }

    register(personId: PersonId): void {
        this.assignHome(personId, null);
    }

    requestTransition(personId: PersonId, target: LogicalLocation, tick: number, causationId: number | null): TransitionHandle {
        this.locationNow.set(personId, target);
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
        if (!this.config.homes) {
            this.homeKeyOf.set(personId, 'home');
            return;
        }
        if (this.homeKeyOf.has(personId)) {
            return;
        }
        const person = pool?.[personId];
        if (person) {
            for (const partnership of person.partnerships) {
                const partnerHome = this.homeKeyOf.get(partnership.partnerId);
                if (partnerHome) {
                    this.homeKeyOf.set(personId, partnerHome);
                    return;
                }
            }
            for (const parentId of [person.motherId, person.fatherId]) {
                const parentHome = parentId ? this.homeKeyOf.get(parentId) : undefined;
                if (parentHome) {
                    this.homeKeyOf.set(personId, parentHome);
                    return;
                }
            }
        }
        this.homeKeyOf.set(personId, `home:${personId}`);
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
    }

    onDeath(personId: PersonId): void {
        this.jobMarket?.fire(personId);
        this.schoolRegistry.release(personId);
        this.locationNow.delete(personId);
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

    // The daily enrollment sweep (mirrors City.runSchoolSweeps): enroll/release school-age children, invoking
    // the education texture events so the log carries them.
    runSchoolSweep(state: PopulationState, tick: number, ticksPerYear: number, engine: EventEngine): void {
        if (!this.config.schools || this.schoolSeats.length === 0) {
            return;
        }
        const pool = state.people;
        const candidates: SchoolCandidate[] = [];
        for (const personId of this.homeKeyOf.keys()) {
            const person = pool[personId];
            if (!person || !isAliveAt(person, tick)) {
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
    runSkillMilestones(state: PopulationState, tick: number, ticksPerYear: number, skillBook: SkillBook): void {
        const pool = state.people;
        for (const personId of [...this.homeKeyOf.keys()].sort()) {
            const person = pool[personId];
            if (!person || !isAliveAt(person, tick)) {
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
    runDaily(state: PopulationState, fromTick: number, toTick: number, ticksPerYear: number, skillBook: SkillBook, engine: EventEngine): void {
        this.runSkillMilestones(state, fromTick, ticksPerYear, skillBook);
        this.runSchoolSweep(state, fromTick, ticksPerYear, engine);
        const fromDay = dayOfTick(fromTick);
        const toDay = dayOfTick(toTick);
        if (this.config.schools) {
            this.accrueSchoolDays(state, fromDay, toDay, skillBook, fromTick);
        }
        if (this.config.jobs && this.jobMarket) {
            this.accrueWorkDays(state, fromDay, toDay, ticksPerYear, skillBook, engine, toTick);
        }
    }

    private accrueSchoolDays(state: PopulationState, fromDay: number, toDay: number, skillBook: SkillBook, tick: number): void {
        const days = countSchoolDays(SCHOOL_CONFIG, fromDay, toDay);
        if (days <= 0) {
            return;
        }
        const basics = Object.keys(skillBook.getManifest()).filter(id => skillBook.getManifest()[id]!.basic).sort();
        for (const personId of [...this.homeKeyOf.keys()].sort()) {
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

    private accrueWorkDays(state: PopulationState, fromDay: number, toDay: number, ticksPerYear: number, skillBook: SkillBook, engine: EventEngine, tick: number): void {
        for (const personId of [...this.homeKeyOf.keys()].sort()) {
            const assignment = this.jobMarket!.assignmentOf(personId);
            if (!assignment || !assignment.rankId) {
                continue;
            }
            const entry = Object.entries(JOBS).find(([, definition]) => definition.title === assignment.title);
            if (!entry) {
                continue;
            }
            const [defKey, definition] = entry;
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
            ctx: { mode: 'bootstrap', world: this, markets: { jobMarket: this.config.jobs ? this.jobMarket : null, skills: skillRegistry } },
            inventory: this.inventory,
        };
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
