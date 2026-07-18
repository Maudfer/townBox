import { fakerPT_BR } from '@faker-js/faker';

import GameManager from 'game/GameManager';
import { JobFacts } from 'game/actions/Brain';
import BrainWakeQueue, { WAKE_CLEARS } from 'game/actions/Wakes';
import Person from 'game/agents/Person';
import Vehicle from 'game/agents/Vehicle';
import { generateBusiness } from 'game/economy/BusinessGen';
import CityServices, { SERVICES_CONFIG } from 'game/economy/CityServices';
import LiveWorld from 'game/execution/LiveWorld';
import { runTick } from 'game/execution/TickRunner';
import { DEFAULT_ECONOMY_PARAMS } from 'game/economy/Economy';
import HousingMarket from 'game/economy/HousingMarket';
import JobMarket from 'game/economy/JobMarket';
import { generateBuildingObjects } from 'game/objects/ObjectGeneration';
import { DEFAULT_POPULATION_PARAMS } from 'game/population/Population';
import { SchoolSeat } from 'game/skills/SchoolRegistry';
import SkillProgression from 'game/skills/SkillProgression';
import SkillRegistry from 'game/skills/SkillRegistry';
import Building from 'game/world/Building';
import House from 'game/world/House';
import Workplace from 'game/world/Workplace';
import { BusinessBlueprintTable, BusinessInstance, JobTable } from 'types/Business';
import { DemandTable } from 'types/Demand';
import { CityStats } from 'types/City';
import { NewDayEvent, NewTickEvent, TimeChangedEvent } from 'types/Time';
import { SchoolConfig, SchoolFacts } from 'types/School';
import { ServiceInputs } from 'types/Services';
import { RetconConfig } from 'types/Retcon';
import { locationKey } from 'types/Objects';
import { FIRE_CONFIG } from 'game/economy/BuildingConditions';
import { PETS_CONFIG } from 'game/population/PetRegistry';
import { Tool } from 'types/Cursor';

import businessesConfig from 'json/businesses.json';
import jobsConfig from 'json/jobs.json';
import householdDrawConfig from 'json/householdDraw.json';
import materialsConfig from 'json/materials.json';
import demandConfig from 'json/demand.json';
import schoolsConfig from 'json/schools.json';
import residencesConfig from 'json/residences.json';
import retconsConfig from 'json/retcons.json';
import { PersonId, PersonTable } from 'types/Genealogy';
import { Household, HouseholdArrangements } from 'types/Household';
import { TickResult } from 'types/LifeEvent';
import { computeBusinessPnl, positionDelta, unitMaterialCost, resolveDemand, aggregateMaterialDemand, DemandBusiness } from 'util/businessFinance';
import { evaluateCurve } from 'util/curve';
import { ageAt, relationshipLabel, isAliveAt, siblingsOf, unclesAuntsOf, grandparentsOf, spouseAt, childrenOf, parentsOf } from 'util/kinship';
import { notificationForSignal } from 'util/notifications';
import { SeededRandom, hashStringToSeed } from 'util/random';
import { isSchoolAge, schoolFactsFor } from 'util/school';
import { TICKS_PER_MONTH } from 'util/time';

const BUSINESS_BLUEPRINTS = businessesConfig as unknown as BusinessBlueprintTable;
const JOBS = jobsConfig as unknown as JobTable;
const MATERIAL_PRICES: Record<string, number> = Object.fromEntries(
    Object.entries(materialsConfig as Record<string, { basePrice: number }>).map(([key, value]) => [key, value.basePrice])
);
const DEMAND_TABLE = demandConfig as unknown as DemandTable;
const HOUSE_PLACEMENT_TAGS: readonly string[] = (residencesConfig as { house: { tags: string[] } }).house.tags;
// Skill ids referenced by any job's requirements — the employability bias for initialization assortments
// (task 062; consumed by SkillBook.initialize).
const JOB_CORE_SKILLS: ReadonlySet<string> = new Set(Object.values(JOBS).flatMap(job => job.requiredSkills ?? []));
const ADULT_AGE_YEARS = (householdDrawConfig as { adultAgeYears: number }).adultAgeYears;
const SCHOOL_CONFIG = schoolsConfig as unknown as SchoolConfig;
const RETCON_CONFIG = retconsConfig as unknown as RetconConfig;
// Civic blueprints (task 108) are placed deliberately through the construction menu — never drawn onto
// generic lots by the random draw, re-occupancy, or entrepreneurship.
const isCivicBlueprint = (key: string): boolean => BUSINESS_BLUEPRINTS[key]?.placement === 'civic';
// A criminal record fades after two in-game years (task 099) — the town forgives, slowly.
const CRIMINAL_RECORD_WINDOW_TICKS = 2 * 8640;
// The business blueprint that makes a building a school (task 058). Students enroll against it; its staff
// (manager/teacher/janitor) remain ordinary employment.
const SCHOOL_BLUEPRINT_KEY = 'school';

let Game: GameManager;

export default class City {
    private name: string;
    private population: number;
    // Evicted households with no home (task 022). Their members stay materialized (home = null, hidden) so they
    // can recover; this registry drives the monthly recovery attempt and is serialized in the save.
    private homelessHouseholds: Household[];
    // Session vital tallies for the city overview (task 031). Cumulative since load (not persisted) — a live
    // dashboard convenience, incremented as the daily sim runs.
    private births: number;
    private deaths: number;
    private bankruptcies: number;
    private evictions: number;
    // The live-mode WorldAdapter (task 040): the map-backed side of the execution boundary. Location
    // transitions requested through it drive the real commute machinery and resolve on physical arrival.
    private world: LiveWorld;
    // Reactive Brain wakeups (LP-12): world mutations enqueue; the minute cadence drains. Transient.
    private wakes = new BrainWakeQueue();
    // The services coverage ledger (task 096): derived daily, serialized nowhere. Hazards read it through
    // markets.services; the dashboard reads latest(). A fresh session is unmeasured (neutral) until day 1.
    private services: CityServices;
    private lastServicesAdvisoryMonth: number;
    // Completed-day -> proficiency service (task 063). One instance so its per-day duplicate guard persists
    // across ticks; constructed lazily because the SkillBook exists only after postSceneInit.
    private skillProgression: SkillProgression | null;


    constructor(gameManager: GameManager) {
        Game = gameManager;

        this.name = fakerPT_BR.location.city();
        this.population = 0;
        this.homelessHouseholds = [];
        this.births = 0;
        this.deaths = 0;
        this.bankruptcies = 0;
        this.evictions = 0;
        this.skillProgression = null;
        this.services = new CityServices();
        this.lastServicesAdvisoryMonth = -1;
        this.world = new LiveWorld({
            getPeople: () => Game.field?.getPeople() ?? [],
            buildingByKey: key => {
                for (const structure of Game.field?.getStructures() ?? []) {
                    if (structure instanceof Building && structure.getIdentifier() === key) {
                        return structure;
                    }
                }
                return null;
            },
            startCommute: (person, destination) => this.startCommute(person, destination),
            // Venue grounding (task 107): resolution scans placed structures for hosting businesses.
            listBuildings: () => (Game.field?.getStructures() ?? []).filter((tile): tile is Building => tile instanceof Building),
            getInventory: () => Game.inventory,
        });

        Game.on("houseBuilt", { callback: this.setupHousehold, context: this });
        Game.on("workplaceBuilt", { callback: this.setupBusiness, context: this });
        Game.on("newDay", { callback: this.handleNewDay, context: this });
        Game.on("newTick", { callback: this.handleTick, context: this });
        Game.on("timeChanged", { callback: this.handleCommute, context: this });
        console.log('City created:', this.name);
    }

    public getName(): string {
        return this.name;
    }

    public setName(name: string): void {
        this.name = name;
    }

    public getPopulation(): number {
        return this.population;
    }

    public setPopulation(population: number): void {
        this.population = population;
    }

    // Homeless households (task 022) — exposed so the save manager can round-trip the registry.
    public getHomelessHouseholds(): Household[] {
        return this.homelessHouseholds;
    }

    public setHomelessHouseholds(households: Household[]): void {
        this.homelessHouseholds = households;
    }

    // Macro snapshot for the city-overview dashboard (task 031), derived live from the field/economy/population.
    // Cheap enough to call on the day tick or window refresh (O(people + structures + pool)). React reads this;
    // no game internals leak into the HUD.
    public getCityStats(): CityStats {
        const field = Game.field;
        const economy = Game.economy;
        const population = Game.population;
        const tick = Game.clock ? Game.clock.getCurrentTick() : 0;

        const people = field ? field.getPeople() : [];
        let employedAdults = 0;
        let unemployedAdults = 0;
        for (const person of people) {
            if (person.social.getAge() < ADULT_AGE_YEARS) {
                continue;
            }
            if (person.work.getJob()) {
                employedAdults += 1;
            } else {
                unemployedAdults += 1;
            }
        }

        let households = 0;
        let residentsInHouseholds = 0;
        let stressedHouseholds = 0;
        let businesses = 0;
        let vacantWorkBuildings = 0;
        let openPositions = 0;
        let stressedBusinesses = 0;
        let householdWealth = 0;
        let businessBalance = 0;
        const lineCounts = new Map<string, number>();

        for (const structure of field ? field.getStructures() : []) {
            if (structure instanceof House) {
                const household = structure.getHousehold();
                if (household) {
                    households += 1;
                    residentsInHouseholds += structure.getResidents().length;
                    if ((household.arrears ?? 0) > 0) {
                        stressedHouseholds += 1;
                    }
                }
            } else if (structure instanceof Workplace) {
                const business = structure.getBusiness();
                if (business) {
                    businesses += 1;
                    lineCounts.set(business.lineOfWork, (lineCounts.get(business.lineOfWork) ?? 0) + 1);
                    openPositions += structure.getOpenPositions().length;
                    const balance = economy ? economy.getBusinessBalance(structure.getIdentifier()) : 0;
                    businessBalance += balance;
                    if (balance < 0) {
                        stressedBusinesses += 1;
                    }
                } else {
                    vacantWorkBuildings += 1;
                }
            }
        }

        if (economy) {
            for (const person of people) {
                const id = person.social.getPersonId();
                if (id) {
                    householdWealth += economy.getPersonBalance(id);
                }
            }
        }

        let poolSize = 0;
        let livingPool = 0;
        if (population) {
            const pool = population.getPeople();
            for (const id in pool) {
                poolSize += 1;
                if (isAliveAt(pool[id]!, tick)) {
                    livingPool += 1;
                }
            }
        }

        return {
            name: this.name,
            population: people.length,
            households,
            avgHouseholdSize: households > 0 ? residentsInHouseholds / households : 0,
            homelessHouseholds: this.homelessHouseholds.length,
            homelessPeople: this.homelessHouseholds.reduce((sum, hh) => sum + hh.memberIds.length, 0),
            businesses,
            vacantWorkBuildings,
            byLineOfWork: [...lineCounts.entries()].map(([line, count]) => ({ line, count })).sort((a, b) => b.count - a.count),
            employedAdults,
            unemployedAdults,
            openPositions,
            poolSize,
            livingPool,
            householdWealth,
            businessBalance,
            stressedBusinesses,
            services: this.services.latest(),
            stressedHouseholds,
            births: this.births,
            deaths: this.deaths,
            bankruptcies: this.bankruptcies,
            evictions: this.evictions,
        };
    }

    public async setupHousehold(house: House): Promise<void> {
        if (!house) {
            throw new Error("Invalid house to setup household");
        }

        const population = Game.population;
        if (!population) {
            throw new Error("Cannot setup household before the population pool exists");
        }

        // Draw at the current in-game moment so household composition (who is alive, who is an adult) is
        // coherent with the date. Falls back to the pool's default scale only if the clock is missing.
        const clock = Game.clock;
        const currentTick = clock ? clock.getCurrentTick() : 0;
        const ticksPerYear = clock ? clock.getTicksPerYear() : DEFAULT_POPULATION_PARAMS.ticksPerYear;
        const capacity = house.getOverview().maxResidents;
        const selection = population.drawHousehold(currentTick, capacity, ticksPerYear);
        const pool = population.getPeople();

        // Lazy history hydration (task 012 follow-up): pull the drawn members' pre-game logs/skills from the
        // history asset BEFORE materialization, so initialize() below sees their lived skills as `initialized`
        // and the inspector shows their real pre-game history. No-op for cold-start worlds / unknown people.
        await Game.hydratePeople?.(selection.memberIds);

        // Materialize each drawn pool person into a live Person bound to this house.
        const personByGenId = new Map<PersonId, Person>();
        for (const memberId of selection.memberIds) {
            const genPerson = population.getPerson(memberId);
            if (!genPerson) {
                continue;
            }

            const person: Person = await Game.emitSingle("personSpawnRequest", house.getEntrance());
            if (!person) {
                continue;
            }

            person.setIndoors(true);
            person.social.setHome(house);
            const age = ageAt(genPerson, currentTick, ticksPerYear);
            person.setupCitizenship(genPerson.firstName, genPerson.familyName, age, genPerson.gender);
            // Link to the genealogy record so age derives from the clock and deaths can be reconciled later.
            person.social.setBirthTick(genPerson.birthTick);
            person.social.setPersonId(memberId);
            // One-time, age-appropriate skill seeding (task 062): basics/milestones/assortment into the
            // central SkillBook so hiring (015) has something to match. Idempotent across rematerialization.
            Game.skillBook?.initialize(memberId, age, genPerson.birthTick, currentTick, population.getState().worldSeed, JOB_CORE_SKILLS);
            // Seed starting funds (task 017). Newborns (materializeNewborns) start at 0.
            // Seed starting funds as an injection from the external sector (task 076/H3): idempotent (adjust by
            // the delta to the target) so re-materialization never double-mints, and conserved (external tracks it).
            Game.economy?.adjustPerson(memberId, DEFAULT_ECONOMY_PARAMS.startingPersonFunds - (Game.economy?.getPersonBalance(memberId) ?? 0));

            house.addResident(person);
            house.addOccupant(person);
            personByGenId.set(memberId, person);
        }

        // Mirror the pool's kinship onto the materialized residents so the family-tree window renders.
        for (const [aId, aPerson] of personByGenId) {
            for (const [bId, bPerson] of personByGenId) {
                if (aId === bId) {
                    continue;
                }
                const label = relationshipLabel(pool, aId, bId);
                if (label) {
                    aPerson.social.addRelationship(label, bPerson);
                }
            }
        }

        const household: Household = {
            id: `hh-${house.getIdentifier()}`,
            houseKey: house.getIdentifier(),
            headId: selection.headId,
            memberIds: selection.memberIds,
            arrangement: selection.arrangement,
        };
        house.setHousehold(household);

        // Fill the home with contextual objects at placement (task 070; H1 fix — previously only the
        // save-load sweep ran this, so a fresh session's homes were empty and object-grounded actions were
        // unreachable until a round-trip).
        this.fillBuildingObjects(house);

        // Career retcon (task 098 / I4): if the town critically lacks a service, this draw MAY gain a
        // plausible injected chapter. Runs after skill initialization so the grant tops up either entry path.
        this.applyCareerRetcon(house.getIdentifier(), selection.memberIds, currentTick, ticksPerYear);

        this.population += personByGenId.size;
        // An empty draw is a real outcome (pool thin at this window), but it must never be a SILENT one
        // (W0 / proposal simulation-aliveness-3 P0-4): the player placed a home and nobody came — say so.
        if (personByGenId.size === 0) {
            const tick = clock ? clock.getCurrentTick() : 0;
            this.announce('vacancy', tick, 'No one moved into the new home — the town has no takers right now', null);
        }
        console.log('Household spawned', household.arrangement, household.memberIds.length, 'members');
    }

    // The bounded, history-coherent career retcon (task 098 / proposal I4). When the coverage ledger reports
    // a critical gap that has an authored template (json/retcons.json), a deterministic per-household roll
    // may pick ONE age-band member and commit the template's education event at a plausible PAST tick —
    // through the normal EventEngine.invoke + SkillRegistry machinery, so eligibility, the log entry, the
    // aggregate history, and the dependency-valid skill grants are all real. Nothing is overwritten: family,
    // possessions, and every existing entry stay; the person just ALSO went to nursing school at 24, and the
    // JobMarket can now staff the clinic. At most one retcon per household; members who already hold the
    // template's skills are never re-schooled.
    public applyCareerRetcon(houseKey: string, memberIds: PersonId[], currentTick: number, ticksPerYear: number): void {
        const population = Game.population;
        const engine = Game.eventEngine;
        const skillBook = Game.skillBook;
        if (!population || !engine || !skillBook) {
            return;
        }
        // Measure the town NOW (a brand-new session is otherwise unmeasured until the first day sweep).
        this.recomputeServices(currentTick);
        // A retcon answers a STAFFING gap, not a missing building: without a facility the chapter would
        // create a nurse with nowhere to practice (build the clinic first; the next draws can staff it).
        const gaps = this.services.latest()
            .filter(line => line.ratio < RETCON_CONFIG.coverageBelow && line.facilities > 0 && RETCON_CONFIG.templates[line.service] !== undefined)
            .sort((a, b) => a.ratio - b.ratio || a.service.localeCompare(b.service));
        if (gaps.length === 0) {
            return;
        }
        const worldSeed = population.getState().worldSeed;
        const rng = new SeededRandom((worldSeed ^ hashStringToSeed(`retcon#${houseKey}`)) >>> 0);
        if (rng.next() >= RETCON_CONFIG.chancePerHousehold) {
            return; // the bounded fraction: most households arrive exactly as recorded
        }
        const pool = population.getState().people;
        const state = population.getState();
        for (const gap of gaps) {
            const template = RETCON_CONFIG.templates[gap.service]!;
            const definition = engine.getManifest()[template.event];
            const grantedSkills = (definition?.effects ?? [])
                .filter((effect): effect is { type: 'acquireSkill'; value: string; proficiency?: number } => effect.type === 'acquireSkill')
                .map(effect => ({ skill: effect.value, floor: effect.proficiency ?? 25 }));
            for (const memberId of [...memberIds].sort()) {
                const record = pool[memberId];
                if (!record) {
                    continue;
                }
                const age = ageAt(record, currentTick, ticksPerYear);
                if (age < RETCON_CONFIG.minAgeYears || age > RETCON_CONFIG.maxAgeYears) {
                    continue;
                }
                // Someone who already holds the chapter's skills doesn't need the chapter.
                if (grantedSkills.length > 0 && grantedSkills.every(grant => skillBook.proficiency(memberId, grant.skill) >= grant.floor)) {
                    continue;
                }
                const pastTick = Math.min(record.birthTick + template.atAgeYears * ticksPerYear, currentTick - 1);
                const registry = new SkillRegistry(skillBook, pastTick);
                const { outcome } = engine.invoke(state, template.event, memberId, pastTick, ticksPerYear,
                    { source: 'system', causationId: null }, {}, { markets: { skills: registry } });
                if (outcome.ok) {
                    return; // at most one retcon per household
                }
            }
        }
    }

    // Fills a freshly placed/occupied building with contextual Object Instances (task 070). Idempotent via the
    // building's objects-generated flag, so re-materialization and the load sweep never double-fill.
    // Deterministic per (worldSeed, anchorKey, generation index) — matches the SaveManager sweep's convention
    // (generationIndex = generations - 1) so a building fills identically whether at placement or on load.
    private fillBuildingObjects(building: House | Workplace): void {
        const inventory = Game.inventory;
        if (!inventory || building.isObjectsGenerated()) {
            return;
        }
        const worldSeed = Game.population ? Game.population.getState().worldSeed : 0;
        const tick = Game.clock ? Game.clock.getCurrentTick() : 0;
        if (building instanceof House) {
            generateBuildingObjects({ anchorKey: building.getIdentifier(), tags: HOUSE_PLACEMENT_TAGS, host: 'house', worldSeed, tick }, inventory);
        } else {
            const business = building.getBusiness();
            if (!business) {
                return; // vacant lot — fills on re-occupancy
            }
            const blueprint = BUSINESS_BLUEPRINTS[business.blueprintKey] as { tags?: string[] } | undefined;
            generateBuildingObjects({
                anchorKey: building.getIdentifier(), tags: blueprint?.tags ?? [], host: 'business',
                worldSeed, generationIndex: Math.max(0, building.getBusinessGenerations() - 1), tick,
            }, inventory);
        }
        building.setObjectsGenerated(true);
    }

    // Fires an effect-free milestone/relationship event on a person the simulation KNOWS reached that state
    // (task 076/M4: wiring reserved events that shadow transitions the sim already computes — births, deaths,
    // eviction, move-out, recovery — so a person's actual life milestones land in their log instead of only
    // random texture). System-sourced, no causation chain. No-ops silently if the subject can't satisfy the
    // event's own authored eligibility (e.g. an age gate) — we never override the predicate. Works pool-wide,
    // so off-map relatives (a widow who isn't on the map) get the milestone too, enriching the asset.
    private fireMilestone(eventId: string, subjectId: PersonId | null | undefined, tick: number): void {
        const engine = Game.eventEngine;
        const population = Game.population;
        if (!engine || !population || subjectId == null) {
            return;
        }
        const ticksPerYear = Game.clock ? Game.clock.getTicksPerYear() : DEFAULT_POPULATION_PARAMS.ticksPerYear;
        engine.invoke(population.getState(), eventId, subjectId, tick, ticksPerYear, { source: 'system', causationId: null });
    }

    // Generates a business for a newly placed work building (Engine A). Deterministic per save + location: the
    // seed is the world seed mixed with the workplace's anchor key, so the same building at the same spot
    // always yields the same business, and it survives save/load without a persisted cursor. Picks a blueprint,
    // draws a size, names it, expands its job positions, and assigns it to the workplace.
    public setupBusiness(workplace: Workplace): void {
        if (!workplace) {
            throw new Error("Invalid workplace to setup business");
        }
        // The construction menu's pin (task 108): a chosen civic/specific building instantiates exactly
        // that blueprint; unpinned lots keep the demand-weighted draw.
        const pinned = workplace.takePendingBlueprint();
        const business = this.openBusiness(workplace, undefined, pinned ? { blueprintKey: pinned } : {});
        if (business) {
            console.log('Business spawned:', business.name, `(${business.lineOfWork}, size ${business.size}, ${business.positions.length} positions)`);
            // Reactive wake (LP-12): a new employer wakes the unemployed at the next minute — resolved at
            // drain time, with job-seeking cooldowns cleared, so the town answers the placement NOW rather
            // than after the routine's multi-day cadence.
            this.wakes.enqueue('businessOpened');
        }
    }

    // Generates and installs a business on a work building (Engine A). Deterministic per save + location +
    // generation: the seed mixes the world seed with the lot's anchor key and its generation index, so the
    // first business matches the legacy location-only seed (generation 0) while a re-occupied lot
    // (generation ≥ 1) draws a *different* business. Optionally constrains the draw to a demand `category`
    // (task 037 re-occupancy). Picks a blueprint, draws a size, names it, seeds capital, advances the lot's
    // generation count, and clears its vacancy clock.
    private openBusiness(workplace: Workplace, category?: string, options: { blueprintKey?: string; name?: string } = {}): BusinessInstance | null {
        const blueprintKeys = Object.keys(BUSINESS_BLUEPRINTS);
        if (blueprintKeys.length === 0) {
            return null;
        }

        const generation = workplace.getBusinessGenerations();
        const key = workplace.getIdentifier();
        const worldSeed = Game.population ? Game.population.getState().worldSeed : 0;
        // Generation 0 keeps the legacy location-only seed, so existing placements/saves are unchanged.
        const seedKey = generation === 0 ? key : `${key}#${generation}`;
        const seed = (worldSeed ^ hashStringToSeed(seedKey)) >>> 0;
        const rng = new SeededRandom(seed);
        fakerPT_BR.seed(seed);

        const drawable = blueprintKeys.filter(candidate => !isCivicBlueprint(candidate));
        let blueprintKey: string;
        if (options.blueprintKey) {
            // A forced blueprint (task 097/I3 founders; task 108 construction-menu pins).
            blueprintKey = options.blueprintKey;
        } else if (category) {
            const candidates = drawable.filter(candidate => BUSINESS_BLUEPRINTS[candidate]!.category === category);
            blueprintKey = rng.pick(candidates.length > 0 ? candidates : drawable);
        } else {
            // First-placement matching (task 097/I2): an unconstrained draw prefers categories the town's
            // demand actually lacks, weighted by unmet demand. With no positive deficit anywhere (an empty
            // map) the draw falls back to the legacy uniform pick — same seed, same stream, same business.
            const { deficits } = this.categorySupplyAndDeficits();
            const weighted = [...deficits.entries()].filter(([, deficit]) => deficit > 0).sort((a, b) => a[0].localeCompare(b[0]));
            if (weighted.length === 0) {
                blueprintKey = rng.pick(drawable);
            } else {
                const total = weighted.reduce((sum, [, deficit]) => sum + deficit, 0);
                let roll = rng.next() * total;
                let picked = weighted[weighted.length - 1]![0];
                for (const [candidateCategory, deficit] of weighted) {
                    roll -= deficit;
                    if (roll <= 0) {
                        picked = candidateCategory;
                        break;
                    }
                }
                const candidates = drawable.filter(candidate => BUSINESS_BLUEPRINTS[candidate]!.category === picked);
                blueprintKey = rng.pick(candidates.length > 0 ? candidates : drawable);
            }
        }
        const blueprint = BUSINESS_BLUEPRINTS[blueprintKey]!;
        const size = rng.nextInt(blueprint.size.min, blueprint.size.max);
        const name = options.name ?? fakerPT_BR.company.name();

        const business = generateBusiness(blueprintKey, blueprint, JOBS, name, size);
        workplace.setBusiness(business);
        // Seed starting capital (task 017), scaled by size so bigger establishments start with more.
        // Starting capital injected from the external sector (task 076/H3): idempotent + conserved.
        Game.economy?.adjustBusiness(key, DEFAULT_ECONOMY_PARAMS.startingBusinessCapital * size - (Game.economy?.getBusinessBalance(key) ?? 0));
        workplace.setBusinessGenerations(generation + 1);
        workplace.setVacantMonths(0);
        // Fill the venue with contextual objects at placement/re-occupancy (task 070; H1 fix). Runs after the
        // generation count is bumped so generationIndex matches the SaveManager sweep convention.
        this.fillBuildingObjects(workplace);
        return business;
    }

    // Indexes materialized (on-map) people by their pool id.
    private indexMaterialized(): Map<PersonId, Person> {
        const personByGenId = new Map<PersonId, Person>();
        const field = Game.field;
        if (!field) {
            return personByGenId;
        }
        for (const person of field.getPeople()) {
            const id = person.social.getPersonId();
            if (id) {
                personByGenId.set(id, person);
            }
        }
        return personByGenId;
    }

    // Day-cadence upkeep (task 040 split): the coarse off-map pool sim (yearly, excluding materialized
    // people — Engine B owns their life events) and the monthly economic gate. The detailed per-tick life
    // simulation runs from handleTick. Public for unit testing; invoked via "newDay" in production.
    public handleNewDay(event: NewDayEvent): void {
        const population = Game.population;
        const clock = Game.clock;
        if (!population || !clock) {
            return;
        }
        // Spoilage sweep (task 089 / F3): perishables past their shelf life are removed daily — bread rots,
        // shelves drain, production resumes below the stock ceiling.
        Game.inventory?.sweepExpired(event.tick);
        const materializedIds = new Set(this.indexMaterialized().keys());
        const coarse = population.simulate(event.tick, clock.getTicksPerYear(), undefined, materializedIds);

        // Cross-fidelity reconciliation (task 076/L4): off-map (coarse-sim) deaths used to reach nobody — a
        // materialized person whose off-map spouse/parent/child died got no milestone in their log (only
        // Engine-B deaths flowed through onCommitted). Fire the same relative milestones here so the loss
        // registers regardless of which fidelity owned the deceased. (`marital` already self-corrects, since it
        // checks the spouse is alive.) Pool-wide, matching the M4 birth/death wiring; disjoint from Engine B's
        // set (materialized are excluded from the coarse sim), so no double-fire.
        const coarsePool = population.getState().people;
        for (const deceased of coarse.died) {
            this.fireMilestone('became_widowed', spouseAt(coarsePool, deceased, event.tick), event.tick);
            for (const childId of childrenOf(coarsePool, deceased)) {
                this.fireMilestone('lost_parent', childId, event.tick);
            }
            for (const parentId of parentsOf(coarsePool, deceased)) {
                this.fireMilestone('lost_child', parentId, event.tick);
            }
        }

        // School enrollment upkeep (task 058): release invalid assignments, enroll unassigned children.
        this.runSchoolSweeps(event.tick, clock.getTicksPerYear());

        // Early-childhood skill milestones (task 062): simulated children gain the next foundational grants
        // as they cross birthdays (idempotent toAtLeast grants; deterministic, RNG-free).
        this.runSkillMilestones(event.tick, clock.getTicksPerYear());

        // The services coverage sweep (task 096): recompute the ledger daily from what actually exists.
        this.recomputeServices(event.tick);

        // Police work (task 099): cold-case sweep + witnessed-incident resolution, scaled by coverage.
        this.runPoliceWork(event.tick, clock.getTicksPerYear());

        // Release the served (task 100): sentences that lapsed walk free — back into whatever life is left.
        this.runReleases(event.tick);

        // The ignition sweep (task 102): worn buildings are hazards; kept-up ones almost never ignite.
        this.runFireHazard(event.tick);

        // Pet lifespans (task 103): old companions pass, and it genuinely hurts (a -3 mood impulse).
        this.runPetLifecycle(event.tick);

        // Monthly economic update. Independent of the event engine, so it runs even in engine-less harnesses.
        this.processMonthlyEconomy(event.tick);
    }

    // The daily services sweep (task 096 / H1): coverage derives from the real map — facilities from placed
    // businesses, providers from who is EMPLOYED at them in the service's declared jobs (a doctor at the
    // hospital practices; an unemployed one doesn't), education from real seats vs the enrollable band. The
    // math is the pure computeCoverage; hazards read the ledger through markets.services, the dashboard
    // through getCityStats. One monthly feed advisory names the worst uncovered service (H2 surfacing).
    public recomputeServices(tick: number): void {
        const field = Game.field;
        if (!field) {
            return;
        }
        // jobs.json keys → position titles (a JobPosition carries the title, not the key).
        const providerTitles = new Map<string, Set<string>>();
        for (const [service, def] of Object.entries(SERVICES_CONFIG.services)) {
            const titles = new Set<string>();
            for (const jobKey of def.providerJobs) {
                const job = JOBS[jobKey];
                if (job) {
                    titles.add(job.title);
                }
            }
            providerTitles.set(service, titles);
        }
        const providersByService: Record<string, number> = {};
        const facilitiesByService: Record<string, number> = {};
        for (const structure of field.getStructures()) {
            if (!(structure instanceof Workplace)) {
                continue;
            }
            const business = structure.getBusiness();
            if (!business) {
                continue;
            }
            for (const [service, def] of Object.entries(SERVICES_CONFIG.services)) {
                if (!def.facilityBlueprints.includes(business.blueprintKey)) {
                    continue;
                }
                facilitiesByService[service] = (facilitiesByService[service] ?? 0) + 1;
                const titles = providerTitles.get(service)!;
                for (const employee of structure.getEmployees()) {
                    const title = employee.work.getJob()?.title;
                    if (title && titles.has(title)) {
                        providersByService[service] = (providersByService[service] ?? 0) + 1;
                    }
                }
            }
        }
        const people = field.getPeople();
        let schoolAgeChildren = 0;
        for (const person of people) {
            if (isSchoolAge(SCHOOL_CONFIG, person.social.getAge())) {
                schoolAgeChildren += 1;
            }
        }
        const schoolSeats = this.listSchools().reduce((sum, school) => sum + school.seats, 0);
        // The squalor outcome reading (LP-8): garbage that actually sits at the curb. The shared curb is
        // the 'outside' location (task 112); the count is what collection rounds failed to consume.
        const curbBags = (Game.inventory?.instancesAtLocation('outside') ?? [])
            .filter(instance => instance.archetypeId === 'bag_of_garbage')
            .reduce((total, instance) => total + instance.quantity, 0);
        const inputs: ServiceInputs = { population: people.length, providersByService, facilitiesByService, schoolSeats, schoolAgeChildren, curbBags };
        const coverages = this.services.update(inputs);
        // The live surface (task 114): the nagbar derives its warnings from exactly what the ledger holds.
        Game.emit('servicesChanged', this.services.latest());

        const month = Math.floor(Math.floor(tick / 24) / 30);
        if (month !== this.lastServicesAdvisoryMonth && people.length > 0) {
            this.lastServicesAdvisoryMonth = month;
            const worst = [...coverages].sort((a, b) => a.ratio - b.ratio || a.service.localeCompare(b.service))[0];
            if (worst && worst.ratio < SERVICES_CONFIG.advisoryBelow) {
                this.announce('services', tick, `${this.name} lacks ${worst.label.toLowerCase()} (coverage ${(worst.ratio * 100).toFixed(0)}%)`, null);
            }
        }
    }

    // The placed school buildings and their seat counts (capacity curve over the school business size).
    private listSchools(): SchoolSeat[] {
        const field = Game.field;
        if (!field) {
            return [];
        }
        const schools: SchoolSeat[] = [];
        for (const structure of field.getStructures()) {
            if (!(structure instanceof Workplace)) {
                continue;
            }
            const business = structure.getBusiness();
            if (!business || business.blueprintKey !== SCHOOL_BLUEPRINT_KEY) {
                continue;
            }
            schools.push({
                key: structure.getIdentifier(),
                seats: Math.max(0, Math.floor(evaluateCurve(SCHOOL_CONFIG.capacity, business.size))),
                position: structure.getPosition(),
            });
        }
        return schools.sort((a, b) => a.key.localeCompare(b.key));
    }

    // The daily school sweep (task 058): drop assignments that stopped being valid (aged out, died, school
    // closed), enroll unassigned 7–17 children into the nearest school with a free seat, and narrate the
    // milestones through the existing manual education events (started_school / graduated_school). Children
    // with no reachable seat stay unenrolled and simply follow free-time behavior — no silent auto-schooling.
    private runSchoolSweeps(tick: number, ticksPerYear: number): void {
        const registry = Game.schools;
        const population = Game.population;
        if (!registry || !population) {
            return;
        }
        const personByGenId = this.indexMaterialized();
        const pool = population.getPeople();
        const candidates = [...personByGenId.keys()].sort().flatMap(personId => {
            const genPerson = pool[personId];
            if (!genPerson || !isAliveAt(genPerson, tick)) {
                return [];
            }
            const ageYears = ageAt(genPerson, tick, ticksPerYear);
            // The sweep needs everyone school-age or just past it (so age-outs release); younger children
            // are not candidates yet.
            if (ageYears < SCHOOL_CONFIG.minAgeYears) {
                return [];
            }
            const home = personByGenId.get(personId)?.social.getHome();
            return [{
                personId,
                ageYears,
                homePosition: home ? home.getPosition() : null,
            }];
        });

        const outcome = registry.sweep(SCHOOL_CONFIG, candidates, this.listSchools(), tick);

        // Narrative wiring: enrollment/age-out invoke the existing manual education texture events. Limit or
        // eligibility rejections are fine (e.g. re-enrollment within started_school's cooldown) — the
        // assignment itself is authoritative; the event is flavor for the person's log.
        const engine = Game.eventEngine;
        if (!engine) {
            return;
        }
        for (const assignment of outcome.enrolled) {
            engine.invoke(population.getState(), 'started_school', assignment.personId, tick, ticksPerYear, { source: 'system', causationId: null });
        }
        for (const personId of outcome.agedOut) {
            engine.invoke(population.getState(), 'graduated_school', personId, tick, ticksPerYear, { source: 'system', causationId: null });
        }
    }

    // Early-childhood skill milestones (task 062): every simulated child under school age receives the
    // milestone grants for their current age. Grants are toAtLeast and dependency-free (foundational), so
    // the daily re-run is an idempotent no-op between birthdays. RNG-free.
    private runSkillMilestones(tick: number, ticksPerYear: number): void {
        const skillBook = Game.skillBook;
        const population = Game.population;
        if (!skillBook || !population) {
            return;
        }
        const pool = population.getPeople();
        for (const personId of [...this.indexMaterialized().keys()].sort()) {
            const genPerson = pool[personId];
            if (!genPerson || !isAliveAt(genPerson, tick)) {
                continue;
            }
            const ageYears = ageAt(genPerson, tick, ticksPerYear);
            if (ageYears >= 1 && ageYears < SCHOOL_CONFIG.minAgeYears) {
                skillBook.applyMilestones(personId, ageYears, tick);
            }
        }
    }

    // The Brain hook's school-facts resolver (task 058): a VALID assignment or null. Validity is derived
    // fresh — the school building still hosts a school business, and the person is inside the enrollment
    // age band. The daily sweep repairs/releases stale assignments; between sweeps this returns null for
    // them, so nobody attends a demolished school.
    // The reactive wake pass (LP-12 / proposal simulation-aliveness-2 M2). Drains the queue, resolves each
    // wake's people (explicit ids, or scope-resolved at drain time — businessOpened wakes the currently
    // unemployed adults), clears the wake kind's cooldown class so the re-evaluation can pick the thing
    // that changed, and runs a bounded Brain pass for the woken people only. Deterministic given the
    // mutation; hooks fork their usual per-(tick, person) streams. Runs between flips, so nothing here
    // re-rolls events — intents flow through the same engine the flip uses.
    private runWakePass(tick: number): void {
        if (!this.wakes.hasPending()) {
            return;
        }
        const population = Game.population;
        const clock = Game.clock;
        const field = Game.field;
        const engine = Game.eventEngine;
        const brain = Game.brain;
        const actionEngine = Game.actionEngine;
        if (!population || !clock || !field || !engine || !brain || !actionEngine) {
            this.wakes.drain(); // world not ready — drop rather than replay stale wakes forever
            return;
        }
        const records = this.wakes.drain();
        const ticksPerYear = clock.getTicksPerYear();
        const personByGenId = this.indexMaterialized();

        const woken = new Set<PersonId>();
        for (const record of records) {
            const ids = record.personIds ?? [...personByGenId.keys()].filter(id => {
                // Scope 'unemployed adults' (the businessOpened wake).
                const person = personByGenId.get(id)!;
                return !person.work.getJob() && person.social.getAge() >= 18;
            });
            for (const id of ids) {
                if (!personByGenId.has(id)) {
                    continue;
                }
                woken.add(id);
                for (const actionId of WAKE_CLEARS[record.kind]) {
                    actionEngine.clearActionRecency(id, actionId);
                }
            }
        }
        if (woken.size === 0) {
            return;
        }

        const hasRecord = (id: PersonId): boolean => engine
            .contextFor(population.getState(), id, tick, ticksPerYear).hasEvent('got_caught', { withinTicks: CRIMINAL_RECORD_WINDOW_TICKS });
        const jobMarket = Game.skillBook ? new JobMarket(personByGenId, field, Game.skillBook, tick, hasRecord) : null;
        const housing = new HousingMarket(personByGenId, field);
        const skills = Game.skillBook ? new SkillRegistry(Game.skillBook, tick) : null;
        const ctx = { mode: 'live' as const, world: this.world, markets: { jobMarket, ledger: Game.economy ?? null, housing, skills, social: Game.socialGraph ?? null, needs: Game.needs ?? null, agenda: Game.agenda ?? null, traits: Game.traits ?? null, habits: Game.habits ?? null, incidents: Game.incidents ?? null, pets: Game.pets ?? null, knownFacts: Game.knownFacts ?? null, mood: Game.mood ?? null, services: this.services } };
        const result = { died: [], born: [], signals: [], committed: [] };
        engine.bindMarkets(ctx);
        brain.processTick([...woken].sort(), {
            state: population.getState(),
            tick,
            ticksPerYear,
            ctx,
            eventEngine: engine,
            inventory: Game.inventory ?? null,
            employerKeyOf: id => {
                const workplace = personByGenId.get(id)?.work.getWorkplace();
                return workplace instanceof Workplace ? workplace.getIdentifier() : null;
            },
            jobOf: id => this.jobFactsOf(id, personByGenId),
            schoolOf: id => this.schoolFactsOf(id, personByGenId, tick, ticksPerYear),
            detentionOf: id => (Game.detention && Game.detention.isDetained(id, tick) ? Game.detention.detentionOf(id) : null),
        }, [], result);
        engine.unbindMarkets();
        // Stamp any log appends the pass produced (starts, declines) — same pass the flip runs (LP-11).
        engine.getLifeLog().stampMinutes(tick, population.getState().worldSeed);
    }

    // Job facts (task 046, extracted for LP-12): shift + workplace + the rank-resolved work repertoire,
    // joined from the jobs table by title. Consumed by handleTick's plan AND the wake pass.
    private jobFactsOf(id: PersonId, personByGenId: Map<PersonId, Person>): JobFacts | null {
        const person = personByGenId.get(id);
        const job = person?.work.getJob();
        const workplace = person?.work.getWorkplace();
        if (!person || !job || !(workplace instanceof Workplace)) {
            return null;
        }
        const entry = Object.entries(JOBS).find(([, candidate]) => candidate.title === job.title);
        const jobKey = entry?.[0];
        const definition = entry?.[1];
        // The person's current rank on the ladder (task 064): rank-specific work-action overrides
        // and progression/promotion facts ride along for the orchestrator + SkillProgression (065).
        const rank = definition?.ranks.find(candidate => candidate.rankId === job.rankId)
            ?? definition?.ranks.find(candidate => candidate.entry)
            ?? null;
        return {
            ...(jobKey ? { jobKey } : {}),
            shiftStart: job.shiftStart,
            shiftEnd: job.shiftEnd,
            ...(job.daysOfWeek ? { daysOfWeek: job.daysOfWeek } : {}),
            workplaceKey: workplace.getIdentifier(),
            continuousActions: rank?.workActions?.continuous ?? definition?.workActions.continuous ?? [],
            discreteActions: rank?.workActions?.discrete ?? definition?.workActions.discrete ?? [],
            ...(rank ? { rank } : {}),
        };
    }

    private schoolFactsOf(personId: PersonId, personByGenId: Map<PersonId, Person>, tick: number, ticksPerYear: number): SchoolFacts | null {
        const registry = Game.schools;
        const population = Game.population;
        const field = Game.field;
        if (!registry || !population || !field) {
            return null;
        }
        const assignment = registry.assignmentOf(personId);
        if (!assignment) {
            return null;
        }
        const genPerson = population.getPerson(personId);
        if (!genPerson || !isAliveAt(genPerson, tick) || !isSchoolAge(SCHOOL_CONFIG, ageAt(genPerson, tick, ticksPerYear))) {
            return null;
        }
        if (!personByGenId.has(personId)) {
            return null; // not materialized (defensive; live agents are materialized by construction)
        }
        for (const structure of field.getStructures()) {
            if (structure instanceof Workplace && structure.getIdentifier() === assignment.schoolKey) {
                const business = structure.getBusiness();
                if (business && business.blueprintKey === SCHOOL_BLUEPRINT_KEY) {
                    return schoolFactsFor(SCHOOL_CONFIG, assignment.schoolKey);
                }
                return null;
            }
        }
        return null;
    }

    // Runs the hourly life simulation and reconciles the materialized world (docs/tasks/013 §5.7, §9; hourly
    // since task 040). Each in-game hour the event engine (Engine B) runs detailed life events over
    // materialized people — deaths despawn the resident, births materialize a newborn into the mother's
    // house. Public for unit testing; invoked via "newTick" in production.
    public async handleTick(event: NewTickEvent): Promise<void> {
        // Burning fires resolve on the hour cadence (task 102) — a fire is not a monthly ledger line.
        this.resolveFires(event.tick);
        const population = Game.population;
        const clock = Game.clock;
        const field = Game.field;
        const engine = Game.eventEngine;
        if (!population || !clock || !field || !engine) {
            return;
        }
        const ticksPerYear = clock.getTicksPerYear();
        const personByGenId = this.indexMaterialized();
        const materializedIds = new Set(personByGenId.keys());

        // Employment market over the current materialized people, so get_job/layoff events hire/fire for real;
        // the economy ledger backs the `money` attribute and `adjustMoney` effect (task 017).
        // A got_caught within the record window handicaps hiring (task 099) — read from the aggregate history.
        const hasRecord = (id: PersonId): boolean => Game.eventEngine
            ? Game.eventEngine.contextFor(population.getState(), id, event.tick, ticksPerYear).hasEvent('got_caught', { withinTicks: CRIMINAL_RECORD_WINDOW_TICKS })
            : false;
        const jobMarket = Game.skillBook ? new JobMarket(personByGenId, field, Game.skillBook, event.tick, hasRecord) : null;
        // Housing market gates move-out eligibility (task 024): a person can only leave home when a vacant one
        // exists. Rebuilt each tick over the current materialized people, like the job market.
        const housing = new HousingMarket(personByGenId, field);
        // Skill registry lets education events grant real proficiency (tasks 032/059).
        const skills = Game.skillBook ? new SkillRegistry(Game.skillBook, event.tick) : null;
        if (!this.skillProgression && Game.skillBook) {
            this.skillProgression = new SkillProgression(Game.skillBook);
        }

        // The shared per-tick lifecycle (task 040): the same TickRunner the bootstrap uses, under the `live`
        // execution context. Phase 6 (onCommitted) is this city's world reconciliation.
        await runTick({
            engine,
            actionEngine: Game.actionEngine ?? undefined,
            brain: Game.brain ?? undefined,
            inventory: Game.inventory,
            employerKeyOf: id => {
                const workplace = personByGenId.get(id)?.work.getWorkplace();
                return workplace instanceof Workplace ? workplace.getIdentifier() : null;
            },
            // Job facts for the Brain's obligation hook (task 046): the person's shift + workplace + the
            // job's continuous work repertoire (mapped from the jobs table by title). Shared with the
            // wake pass (LP-12), so both evaluate identical facts.
            jobOf: id => this.jobFactsOf(id, personByGenId),
            // Detention facts (task 100): the detained hook keeps sentenced people at the facility.
            detentionOf: id => (Game.detention && Game.detention.isDetained(id, event.tick) ? Game.detention.detentionOf(id) : null),
            // School facts for the Brain's school-obligation hook (task 058): a valid assignment or null.
            schoolOf: id => this.schoolFactsOf(id, personByGenId, event.tick, ticksPerYear),
            ...(this.skillProgression ? { skillProgression: this.skillProgression } : {}),
            // The mutable job assignment for work-day counters + promotion (task 065).
            jobAssignmentOf: id => personByGenId.get(id)?.work.getJob() ?? null,
            state: population.getState(),
            agentIds: [...materializedIds],
            tick: event.tick,
            ticksPerYear,
            ctx: { mode: 'live', world: this.world, markets: { jobMarket, ledger: Game.economy ?? null, housing, skills, social: Game.socialGraph ?? null, needs: Game.needs ?? null, agenda: Game.agenda ?? null, traits: Game.traits ?? null, habits: Game.habits ?? null, incidents: Game.incidents ?? null, pets: Game.pets ?? null, knownFacts: Game.knownFacts ?? null, mood: Game.mood ?? null, services: this.services } },
            onCommitted: async result => {
                this.reconcileDeaths(result.died, personByGenId);
                // Death dissolves elective bonds (task 083) and needs (084); kinship stays derived.
                for (const deceased of result.died) {
                    Game.socialGraph?.removePerson(deceased);
                    Game.needs?.removePerson(deceased);
                    Game.agenda?.removePerson(deceased);
                    Game.mood?.removePerson(deceased);
                    Game.habits?.removePerson(deceased);
                    Game.incidents?.removePerson(deceased);
                    Game.detention?.removePerson(deceased);
                    Game.pets?.removeOwner(deceased);
                    Game.knownFacts?.removePerson(deceased);
                }
                await this.materializeNewborns(result.born, personByGenId);
                // City-overview vital tallies (task 031).
                this.deaths += result.died.length;
                this.births += result.born.length;
                // Wire the computable birth/death milestone events (task 076/M4) — the sim already knows these
                // happened; fire them on the real subjects so their logs carry their own milestones.
                const pool = population.getState().people;
                for (const birth of result.born) {
                    this.fireMilestone('was_born', birth.id, event.tick);
                    this.fireMilestone('gave_birth', birth.motherId, event.tick);
                    this.fireMilestone('became_parent', birth.motherId, event.tick);
                    this.fireMilestone('became_parent', birth.fatherId, event.tick);
                }
                for (const deceased of result.died) {
                    this.fireMilestone('became_widowed', spouseAt(pool, deceased, event.tick), event.tick);
                    for (const childId of childrenOf(pool, deceased)) {
                        this.fireMilestone('lost_parent', childId, event.tick);
                    }
                    for (const parentId of parentsOf(pool, deceased)) {
                        this.fireMilestone('lost_child', parentId, event.tick);
                    }
                }
                // Resolve households left incoherent by deaths (e.g. a minor whose guardian died) — task 011.
                if (result.died.length > 0) {
                    this.resolveRehousing(event.tick, ticksPerYear);
                }
                // Living-arrangement dynamics driven by event signals: newlyweds move in together (task 023)
                // and grown children leave the family home to form their own household (task 024).
                for (const signal of result.signals) {
                    if (!signal.personId) {
                        continue;
                    }
                    if (signal.signal === 'partnershipFormed') {
                        this.resolveCohabitation(signal.personId, event.tick, ticksPerYear);
                    } else if (signal.signal === 'movedOut') {
                        this.resolveMoveOut(signal.personId, event.tick);
                    } else if (signal.signal === 'crimeCommitted') {
                        // A crime event committed (task 099): file the incident with the ground-truth
                        // suspect and the co-located potential witnesses at the scene.
                        this.fileIncident(signal.personId, event.tick);
                    } else if (signal.signal === 'chaseConcluded') {
                        // The chase ended (task 099): roll the outcome — caught (fine + record) or evaded.
                        this.resolveChase(signal.personId, event.tick, ticksPerYear);
                    } else if (signal.signal === 'petAdopted') {
                        // The pet-shop adoption (task 103): draw the species, name it, register it.
                        this.resolveAdoption(signal.personId, event.tick);
                    }
                }
                // Gossip transfers (task 104 / O2): a shared_gossip commit moves the SPEAKER's juiciest
                // known fact (|valence| × recency, deterministic tie-break) to the LISTENER — never one
                // about either of them. The heard_gossip counterpart already landed the listener's log line.
                for (const commit of result.committed) {
                    if (commit.eventId === 'shared_gossip' && typeof commit.params?.['target'] === 'string') {
                        this.transferGossip(commit.personId, commit.params['target'], event.tick);
                    } else if (commit.eventId === 'visited_person_in_jail' && typeof commit.params?.['target'] === 'string') {
                        // The jail visit's counterpart (task 109): the visit travels TO its target, so it
                        // can't be an interaction contract (those require co-location at START); the
                        // detainee's half rides the payload instead, chained to the visitor's commit.
                        Game.eventEngine?.invoke(population.getState(), 'received_a_visitor', commit.params['target'], event.tick, ticksPerYear,
                            { source: 'system', causationId: commit.seq });
                    } else if (commit.eventId === 'visited_sick_relative' && typeof commit.params?.['target'] === 'string') {
                        // The sick visit's counterpart (task 111, same travelling-visit pattern): the
                        // patient's half — its positive valence feeds their mood through the normal
                        // machinery, which is what makes lifted_spirits reachable (the 095 support loop).
                        Game.eventEngine?.invoke(population.getState(), 'was_visited_while_sick', commit.params['target'], event.tick, ticksPerYear,
                            { source: 'system', causationId: commit.seq });
                    }
                }
                // Surface the tick's notable happenings to the HUD feed (task 029).
                this.announceCityEvents(result, personByGenId, event.tick);
                // Remaining signals (hired, fellIll, …) are consumed by the feed and later phases.
            },
        });
    }

    // Translates the day's deaths, births, and event signals into cityEvent feed entries (task 029). The
    // single place that maps the simulation's outcomes to player-facing notifications.
    private announceCityEvents(result: TickResult, personByGenId: Map<PersonId, Person>, tick: number): void {
        const population = Game.population;
        const nameOf = (id: PersonId): string => {
            const person = personByGenId.get(id);
            if (person) {
                return person.social.getFullName();
            }
            const record = population?.getPerson(id);
            return record ? `${record.firstName} ${record.familyName}` : 'Someone';
        };

        for (const id of result.died) {
            this.announce('death', tick, `${nameOf(id)} passed away`, personByGenId.get(id) ?? null);
        }
        for (const birth of result.born) {
            this.announce('birth', tick, `${nameOf(birth.motherId)} had a baby`, personByGenId.get(birth.id) ?? null);
        }
        for (const signal of result.signals) {
            if (!signal.personId) {
                continue;
            }
            const notification = notificationForSignal(signal.signal, nameOf(signal.personId), signal.params);
            if (notification) {
                this.announce(notification.kind, tick, notification.message, personByGenId.get(signal.personId) ?? null);
            }
        }
    }

    private announce(kind: string, tick: number, message: string, person: Person | null): void {
        Game.emit("cityEvent", { kind, tick, message, person });
    }

    // The once-a-month economic update (task 018+). Gated by the economy's lastEconomyMonth so it runs once
    // per in-game month and never double-runs across save/load. Public for unit testing; in production it is
    // driven each day by handleNewDay. Cost of living (019) and business P&L (020) will hook in here.
    public processMonthlyEconomy(tick: number): void {
        const economy = Game.economy;
        if (!economy) {
            return;
        }
        const month = Math.floor(tick / TICKS_PER_MONTH);
        if (month <= economy.getLastEconomyMonth()) {
            return;
        }
        economy.setLastEconomyMonth(month);
        this.runPayroll(tick);
        this.runBusinessEconomics(tick);
        // Entrepreneurs get first pick of vacant lots (task 097/I3), before generic re-occupancy.
        this.runEntrepreneurship(tick);
        this.runReoccupancy(tick);
        this.runCostOfLiving(tick);
        this.runEvictions(tick);
        this.runRecovery(tick);
    }

    // Monthly business P&L driven by the demand model (task 033): households generate per-category demand,
    // businesses compete for it by capacity (staffing × throughput), and revenue = unitsSold × price. P&L =
    // revenue − materials − fixed − payroll (payroll already debited by runPayroll, so only the income side is
    // applied here). Records P&L + a profit/loss streak; a sustainedly profitable, fully-staffed business grows.
    // A business whose balance stays below the debt floor for too long goes bankrupt and closes (task 021).
    private runBusinessEconomics(tick: number): void {
        const field = Game.field;
        const economy = Game.economy;
        if (!field || !economy) {
            return;
        }

        // City-wide demand per category from the materialized population (consumers). v1 is flat per-capita;
        // demographic/income modifiers and locality are documented refinements (033 §A2/§A6).
        const population = field.getPeople().length;
        const demandByCategory: Record<string, number> = {};
        for (const [category, demand] of Object.entries(DEMAND_TABLE)) {
            demandByCategory[category] = population * demand.perCapita;
        }

        // Each operating business's capacity, and an index to resolve units back to it.
        const competitors: DemandBusiness[] = [];
        const byKey = new Map<string, { workplace: Workplace; business: NonNullable<ReturnType<Workplace['getBusiness']>>; blueprint: BusinessBlueprintTable[string] }>();
        for (const structure of field.getStructures()) {
            if (!(structure instanceof Workplace)) {
                continue;
            }
            const business = structure.getBusiness();
            if (!business) {
                continue;
            }
            const blueprint = BUSINESS_BLUEPRINTS[business.blueprintKey];
            if (!blueprint) {
                continue;
            }
            const key = structure.getIdentifier();
            const throughput = DEMAND_TABLE[blueprint.category]?.throughputPerEmployee ?? 0;
            competitors.push({ key, category: blueprint.category, capacity: structure.getEmployees().length * throughput });
            byKey.set(key, { workplace: structure, business, blueprint });
        }

        const unitsByKey = resolveDemand(competitors, demandByCategory);

        // Materialized retail netting (task 089 / F3): micro-purchases already moved money person → business
        // at the till; the demand model's revenue covers ALL consumer sales, so the already-collected part is
        // subtracted from this month's credit (capped at the model's revenue — genuine over-selling is kept).
        const materializedSales = economy.drainMaterializedSales();

        // B2B supply chain (task 035): the input materials those consumer sales require become demand on local
        // producers (businesses whose `products` are those materials). Producers compete to supply each material
        // by capacity (staffing × per-employee output), via the same demand resolution keyed by material id.
        const materialDemand = aggregateMaterialDemand(
            [...byKey.entries()].map(([key, { blueprint }]) => ({ unitsSold: unitsByKey.get(key) ?? 0, materialsPerUnit: blueprint.materialsPerUnit }))
        );
        const producerEntries: DemandBusiness[] = [];
        for (const [key, { workplace, blueprint }] of byKey) {
            if (!blueprint.products) {
                continue;
            }
            const staff = workplace.getEmployees().length;
            for (const [material, throughput] of Object.entries(blueprint.products)) {
                producerEntries.push({ key: `${key}::${material}`, category: material, capacity: staff * throughput });
            }
        }
        const producerUnitsByKey = resolveDemand(producerEntries, materialDemand);

        for (const [key, { workplace, business, blueprint }] of byKey) {
            const unitsSold = unitsByKey.get(key) ?? 0;
            const pricePerUnit = (DEMAND_TABLE[blueprint.category]?.pricePerUnit ?? 0) * (blueprint.economics?.priceMarkup ?? 1);
            // Consumer (household) revenue plus B2B revenue from any materials this business produces.
            let producerRevenue = 0;
            for (const material of Object.keys(blueprint.products ?? {})) {
                const sold = producerUnitsByKey.get(`${key}::${material}`) ?? 0;
                producerRevenue += sold * (MATERIAL_PRICES[material] ?? 0) * (blueprint.economics?.priceMarkup ?? 1);
            }
            const revenue = unitsSold * pricePerUnit + producerRevenue;
            const materialsCost = unitsSold * unitMaterialCost(blueprint, MATERIAL_PRICES);
            const fixedCosts = blueprint.economics?.fixedCostsPerMonth ? evaluateCurve(blueprint.economics.fixedCostsPerMonth, business.size) : 0;
            const payroll = workplace.getEmployees().reduce((total, employee) => total + (employee.work.getJob()?.salary ?? 0), 0);
            const finance = computeBusinessPnl(revenue, materialsCost, fixedCosts, payroll);

            // Payroll was already debited by runPayroll; apply only the income side here — minus whatever the
            // till already collected through materialized purchases this month (task 089).
            const alreadyCollected = Math.min(materializedSales[key] ?? 0, revenue);
            economy.adjustBusiness(key, revenue - alreadyCollected - materialsCost - fixedCosts);
            business.lastPnl = finance.pnl;

            const previousStreak = business.profitStreak ?? 0;
            if (finance.pnl > 0) {
                business.profitStreak = previousStreak > 0 ? previousStreak + 1 : 1;
            } else if (finance.pnl < 0) {
                business.profitStreak = previousStreak < 0 ? previousStreak - 1 : -1;
            }

            // Bankruptcy (task 021): once the balance has stayed below the debt floor for too many consecutive
            // months, the business is insolvent — close it (lay everyone off, vacate the building) and skip
            // growth. The starting capital gives a runway before the count begins (balance >= floor resets it).
            if (economy.getBusinessBalance(key) < DEFAULT_ECONOMY_PARAMS.bankruptcyDebtFloor) {
                business.insolventMonths = (business.insolventMonths ?? 0) + 1;
            } else {
                business.insolventMonths = 0;
            }
            if ((business.insolventMonths ?? 0) >= DEFAULT_ECONOMY_PARAMS.bankruptcyMonths) {
                this.bankruptcies += 1; // city-overview tally (task 031)
                this.closeBusiness(workplace, business, key, tick);
                continue;
            }

            // Grow when sustainedly profitable and already fully staffed (a proxy for "demand exceeds capacity").
            if ((business.profitStreak ?? 0) >= DEFAULT_ECONOMY_PARAMS.growthMonths
                && workplace.getOpenPositions().length === 0
                && business.size < blueprint.size.max) {
                const grown = generateBusiness(business.blueprintKey, blueprint, JOBS, business.name, business.size + 1);
                workplace.expandPositions(business.size + 1, grown.positions, positionDelta(business.positions, grown.positions));
                business.profitStreak = 0;
                this.announce('businessGrew', tick, `${business.name} is expanding`, null);
            } else if ((business.profitStreak ?? 0) <= -DEFAULT_ECONOMY_PARAMS.shrinkMonths
                && business.size > blueprint.size.min) {
                // Shrink-via-layoffs (task 076/M6): a solvent-but-sustainedly-unprofitable business downsizes
                // instead of only ever growing or bankrupting — it sheds a size step (cutting payroll to match
                // fallen demand). Laid-off staff re-enter the job market. Symmetric with growth.
                const shrunk = generateBusiness(business.blueprintKey, blueprint, JOBS, business.name, business.size - 1);
                const laidOff = workplace.shrinkPositions(business.size - 1, shrunk.positions);
                for (const person of laidOff) {
                    person.work.clearJob();
                }
                business.profitStreak = 0;
                this.announce('businessShrank', tick, `${business.name} is downsizing`, null);
                if (laidOff.length > 0) {
                    const subject = laidOff.length === 1 ? '1 person was' : `${laidOff.length} people were`;
                    this.announce('massLayoff', tick, `${subject} laid off from ${business.name}`, null);
                }
            }
        }
    }

    // Shuts down a bankrupt business (task 021): lays off every employee (clearing their WorkLife.job so they
    // re-enter the job market via get_job, 015), clears the BusinessInstance so the building becomes vacant, and
    // writes off the unrecoverable debt. The lot stays vacant (and renders desaturated) until the player
    // bulldozes/rebuilds (025) — re-occupancy over time is a documented follow-up. Surfaces businessClosed (and
    // a massLayoff when staff were let go) to the feed (029).
    private closeBusiness(workplace: Workplace, business: BusinessInstance, key: string, tick: number): void {
        const laidOff = workplace.closeBusiness();
        for (const person of laidOff) {
            person.work.clearJob();
        }
        // Reactive wake (LP-12): the laid-off re-plan their day at the next minute (job seeking cooldowns
        // cleared) instead of discovering their unemployment at the next flip.
        if (laidOff.length > 0) {
            this.wakes.enqueue('businessClosed', laidOff.map(person => person.social.getPersonId()).filter((id): id is PersonId => !!id));
        }
        // Write off the (usually negative) balance to zero, routed through the external sector (task 076/H3) so
        // the write-off is accounted rather than silently minting/burning money.
        Game.economy?.adjustBusiness(key, -(Game.economy?.getBusinessBalance(key) ?? 0));
        // A closing school drops its student assignments (task 058); the next daily sweep re-enrolls the
        // children elsewhere if seats exist. Covers both bankruptcy (021) and bulldozing (025).
        if (business.blueprintKey === SCHOOL_BLUEPRINT_KEY) {
            Game.schools?.releaseSchool(key);
        }
        // Teardown symmetry (task 070): the context dies with the business — location-contained objects are
        // removed (carried ones are untouched), and anything still business-owned elsewhere (borrowed tools,
        // employee-carried stock) becomes ownerless world property. The lot refills on re-occupancy (037).
        if (Game.inventory) {
            Game.inventory.clearLocation(`building:${key}`);
            Game.inventory.reassignOwnedBy({ kind: 'business', key }, { kind: 'world' });
            workplace.setObjectsGenerated(false);
        }

        this.announce('businessClosed', tick, `${business.name} has gone out of business`, null);
        if (laidOff.length > 0) {
            const subject = laidOff.length === 1 ? '1 person was' : `${laidOff.length} people were`;
            this.announce('massLayoff', tick, `${subject} laid off from ${business.name}`, null);
        }

        // Re-draw so the now-businessless building reads as vacant (desaturated), like an emptied house.
        Game.emit("tileSpawned", workplace);
    }

    // Re-occupies vacant work buildings over time (task 037): a lot vacated by bankruptcy stays vacant for
    // reoccupancyMonths, then attracts a *new, different* business — but only in a category with unmet demand,
    // so the city heals where investment is warranted instead of re-flooding an oversupplied market. Runs after
    // runBusinessEconomics so it sees this month's closures and post-closure supply. Deterministic.
    // Files a crime into the incidents registry (task 099): the committing signal names the ground-truth
    // suspect; the KIND comes from their freshest crime-event log entry, and the witnesses are whoever
    // shared the location at the scene. Whether justice ever learns is the witnesses' and coverage's call.
    public fileIncident(suspectId: PersonId, tick: number): void {
        const incidents = Game.incidents;
        const engine = Game.eventEngine;
        if (!incidents || !engine) {
            return;
        }
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
        const location = this.world.locationOf(suspectId);
        const witnesses = this.world.peopleAt(location).filter(id => id !== suspectId).length;
        incidents.report(kind, tick, locationKey(location), suspectId, witnesses);
    }

    // The chase's outcome (task 099): fleeing_the_police completed -> a deterministic roll weighted by the
    // suspect's age and health decides caught (fine + record + case closed) vs got away (still wanted).
    public resolveChase(suspectId: PersonId, tick: number, ticksPerYear: number): void {
        const incidents = Game.incidents;
        const population = Game.population;
        if (!incidents || !population || !incidents.isWanted(suspectId)) {
            return;
        }
        const record = population.getPerson(suspectId);
        if (!record) {
            return;
        }
        const worldSeed = population.getState().worldSeed;
        const rng = new SeededRandom((worldSeed ^ hashStringToSeed(`chase#${suspectId}#${tick}`)) >>> 0);
        const age = ageAt(record, tick, ticksPerYear);
        const engine = Game.eventEngine;
        const health = engine ? Number(engine.contextFor(population.getState(), suspectId, tick, ticksPerYear).getAttr('health') ?? 1) : 1;
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
            this.arrestSuspect(suspectId, tick, ticksPerYear);
        } else {
            this.fireMilestone('evaded_the_police', suspectId, tick);
        }
    }

    // Where a sentence is served (task 100): the jail if the town built one, else the police station as
    // the short-detention stopgap. Neither standing -> nobody can be held (the coverage ledger says so).
    private detentionFacility(): Workplace | null {
        const field = Game.field;
        if (!field) {
            return null;
        }
        let station: Workplace | null = null;
        for (const structure of field.getStructures()) {
            if (!(structure instanceof Workplace)) {
                continue;
            }
            const key = structure.getBusiness()?.blueprintKey;
            if (key === 'jail') {
                return structure;
            }
            if (key === 'police_station' && !station) {
                station = structure;
            }
        }
        return station;
    }

    // The release sweep (task 100): lapsed sentences walk free. Household membership was never touched, so
    // they return to their old life directly; if it moved on (eviction while inside), the homelessness
    // machinery already owns them.
    public runReleases(tick: number): void {
        const detention = Game.detention;
        if (!detention) {
            return;
        }
        for (const personId of detention.due(tick)) {
            detention.release(personId);
            this.fireMilestone('released_from_jail', personId, tick);
            const person = this.indexMaterialized().get(personId) ?? null;
            const name = Game.population?.getPerson(personId)?.firstName ?? 'Someone';
            this.announce('crime', tick, name + ' was released — time served', person);
        }
    }

    // The arrest (task 109): the officer's act and the criminal's counterpart land causation-linked; the
    // family hears (relative_arrested fan-out); the suspect is ESCORTED to the facility — logically riding
    // along (offered_a_ride / got_a_ride texture on the same causation; the vehicle system is untouched) —
    // and conviction bookkeeping (record, fine/sentence) runs as always.
    private arrestSuspect(suspectId: PersonId, tick: number, ticksPerYear: number): void {
        const engine = Game.eventEngine;
        const population = Game.population;
        if (!engine || !population) {
            this.convictSuspect(suspectId, tick);
            return;
        }
        const state = population.getState();
        // The arresting officer: the first on-duty police officer, deterministic by id.
        const byGenId = this.indexMaterialized();
        const officerId = [...byGenId.entries()]
            .filter(([, person]) => person.work.getJob()?.title === 'Police Officer')
            .map(([id]) => id)
            .sort()[0] ?? null;
        let arrestSeq: number | null = null;
        if (officerId) {
            const { outcome } = engine.invoke(state, 'arrested_suspect', officerId, tick,
                ticksPerYear, { source: 'system', causationId: null }, {}, {}, { target: suspectId });
            arrestSeq = outcome.ok ? outcome.seq : null;
        }
        engine.invoke(state, 'was_arrested', suspectId, tick, ticksPerYear, { source: 'system', causationId: arrestSeq });
        // The family hears — the same kinship fan-out the death milestones use.
        const pool = state.people;
        const kin = new Set<PersonId>();
        const spouse = spouseAt(pool, suspectId, tick);
        if (spouse) {
            kin.add(spouse);
        }
        for (const id of [...childrenOf(pool, suspectId), ...parentsOf(pool, suspectId)]) {
            kin.add(id);
        }
        for (const relativeId of [...kin].sort()) {
            this.fireMilestone('relative_arrested', relativeId, tick);
        }
        // Escort: taken to the facility in the car — the ride texture logs both sides; the transition
        // physically moves them (live: the commute; the detained hook then holds them there).
        const facility = this.detentionFacility();
        if (facility && officerId) {
            engine.invoke(state, 'offered_a_ride', officerId, tick, ticksPerYear, { source: 'system', causationId: arrestSeq }, {}, {}, { target: suspectId });
            engine.invoke(state, 'got_a_ride', suspectId, tick, ticksPerYear, { source: 'system', causationId: arrestSeq });
            this.world.requestTransition(suspectId, { kind: 'building', key: facility.getIdentifier() }, tick, arrestSeq);
        }
        this.convictSuspect(suspectId, tick);
    }

    // Conviction (task 099): every open case against the suspect closes, the fine moves through the ledger
    // (mirrored against the external sector - conserved), got_caught lands in the log (the criminal record
    // the JobMarket reads), and the feed hears about it.
    private convictSuspect(suspectId: PersonId, tick: number): void {
        const incidents = Game.incidents;
        if (!incidents) {
            return;
        }
        // Sentencing (task 100): a REPEAT offender (a prior got_caught still on the record) is detained when
        // the town can hold them — the jail if one stands, else the police station as the stopgap. First
        // offenses (and towns with nowhere to put anyone) stay fine-only. Checked before the fresh
        // got_caught below lands, so the current conviction never counts as its own prior.
        const engine = Game.eventEngine;
        const population = Game.population;
        const isRepeat = engine && population
            ? engine.contextFor(population.getState(), suspectId, tick, Game.clock?.getTicksPerYear() ?? DEFAULT_POPULATION_PARAMS.ticksPerYear)
                .hasEvent('got_caught', { withinTicks: CRIMINAL_RECORD_WINDOW_TICKS })
            : false;
        if (isRepeat && Game.detention) {
            const facility = this.detentionFacility();
            if (facility) {
                // Sentences scale with the record (task 109): a second offense serves detentionDays; a
                // third-and-later serves the long stretch. First offenses stay fine-only.
                const hardened = engine && population
                    ? engine.contextFor(population.getState(), suspectId, tick, Game.clock?.getTicksPerYear() ?? DEFAULT_POPULATION_PARAMS.ticksPerYear)
                        .hasEvent('got_caught', { withinTicks: CRIMINAL_RECORD_WINDOW_TICKS, minCount: 2 })
                    : false;
                const days = hardened ? DEFAULT_ECONOMY_PARAMS.detentionDaysRepeat : DEFAULT_ECONOMY_PARAMS.detentionDays;
                Game.detention.detain(suspectId, tick + days * 24, facility.getIdentifier());
                this.fireMilestone('was_detained', suspectId, tick);
            }
        }
        for (const incident of incidents.all()) {
            if (incident.status === 'open' && incident.suspectId === suspectId) {
                incidents.resolve(incident.id, tick);
            }
        }
        Game.economy?.adjustPerson(suspectId, -DEFAULT_ECONOMY_PARAMS.crimeFineAmount);
        this.fireMilestone('got_caught', suspectId, tick);
        const person = this.indexMaterialized().get(suspectId) ?? null;
        const name = Game.population?.getPerson(suspectId)?.firstName ?? 'Someone';
        this.announce('crime', tick, `${name} was caught by the police`, person);
    }

    // The police day sweep (task 099): witnessed open incidents resolve with odds scaled by coverage and
    // witness count; unwitnessed and stale cases go cold. No officers on the ledger -> nothing ever
    // resolves - the coverage consequence, measured.
    public runPoliceWork(tick: number, ticksPerYear: number): void {
        const incidents = Game.incidents;
        const population = Game.population;
        if (!incidents || !population) {
            return;
        }
        void ticksPerYear;
        for (const wentCold of incidents.sweepCold(tick)) {
            // Impunity (task 109): a WANTED suspect whose case went cold got away with it — a real log line,
            // and the emboldening it carries makes the next one likelier. A town without police teaches
            // crime. Unwitnessed crimes stay unknowable end to end (the 099 contract): no witnesses, no
            // jeopardy, no log line — the crime action's own habit practice already did the reinforcing.
            if (wentCold.suspectId && wentCold.witnesses > 0) {
                this.fireMilestone('got_away_with_it', wentCold.suspectId, tick);
            }
        }
        const coverage = this.services.coverageOf('police');
        if (coverage <= 0) {
            return;
        }
        const worldSeed = population.getState().worldSeed;
        const rng = new SeededRandom((worldSeed ^ hashStringToSeed(`police#${Math.floor(tick / 24)}`)) >>> 0);
        for (const incident of [...incidents.open()].sort((a, b) => a.id - b.id)) {
            if (incident.witnesses <= 0 || !incident.suspectId) {
                continue; // nobody saw it (or nobody DID it — fires) - the case is unknowable
            }
            const chance = Math.min(0.9, 0.12 * coverage * Math.min(incident.witnesses, 3));
            if (rng.next() < chance) {
                this.convictSuspect(incident.suspectId, tick);
            }
        }
    }

    // The juiciest thing the speaker knows travels (task 104): |valence| × recency scores the pick.
    public transferGossip(speakerId: PersonId, listenerId: PersonId, tick: number): void {
        const knownFacts = Game.knownFacts;
        if (!knownFacts) {
            return;
        }
        const candidates = knownFacts.factsOf(speakerId, tick)
            .filter(fact => fact.aboutId !== listenerId && fact.aboutId !== speakerId);
        if (candidates.length === 0) {
            return; // gossip about nothing — people manage
        }
        const scored = candidates
            .map(fact => ({ fact, score: Math.abs(fact.valence) * Math.max(0, 1 - (tick - fact.learnedAtTick) / (90 * 24)) }))
            .sort((a, b) => b.score - a.score || a.fact.seq - b.fact.seq);
        const juiciest = scored[0]!.fact;
        knownFacts.learn(listenerId, { ...juiciest, learnedAtTick: tick, viaWitness: false });
    }

    // The pet-shop adoption lands (task 103 / N): the adopted_a_pet event (cap-gated by petCount) emitted
    // petAdopted; City draws the species (weighted, deterministic), names the companion (faker), registers
    // it, and fires the species texture event — adopted_dog and friends are C2-wired now, never free-rolled.
    public resolveAdoption(ownerId: PersonId, tick: number): void {
        const pets = Game.pets;
        const population = Game.population;
        if (!pets || !population || pets.countOf(ownerId) >= PETS_CONFIG.maxPerOwner) {
            return;
        }
        const worldSeed = population.getState().worldSeed;
        const rng = new SeededRandom((worldSeed ^ hashStringToSeed('pet#' + ownerId + '#' + tick)) >>> 0);
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
        fakerPT_BR.seed((worldSeed ^ hashStringToSeed('petname#' + ownerId + '#' + tick)) >>> 0);
        const name = fakerPT_BR.person.firstName();
        pets.adopt(ownerId, picked[0], name, tick);
        this.fireMilestone(picked[1].event, ownerId, tick);
        const owner = Game.population?.getPerson(ownerId)?.firstName ?? 'Someone';
        this.announce('pet', tick, owner + ' adopted a ' + picked[0] + ' named ' + name, this.indexMaterialized().get(ownerId) ?? null);
    }

    // Pet lifespans (task 103): past the species lifespan, each day rolls a small deterministic passing
    // chance. The owner's log takes pet_passed_away — valence -3, a REAL grief impulse (091's machinery).
    public runPetLifecycle(tick: number): void {
        const pets = Game.pets;
        const population = Game.population;
        const clock = Game.clock;
        if (!pets || !population || !clock) {
            return;
        }
        const ticksPerYear = clock.getTicksPerYear();
        const worldSeed = population.getState().worldSeed;
        const day = Math.floor(tick / 24);
        for (const pet of pets.all()) {
            const spec = PETS_CONFIG.species[pet.species];
            if (!spec) {
                continue;
            }
            const ageYears = (tick - pet.birthTick) / ticksPerYear;
            if (ageYears < spec.lifespanYears) {
                continue;
            }
            const rng = new SeededRandom((worldSeed ^ hashStringToSeed('petDeath#' + pet.id + '#' + day)) >>> 0);
            if (rng.next() >= 0.05) {
                continue;
            }
            pets.removePet(pet.id);
            this.fireMilestone('pet_passed_away', pet.ownerId, tick);
            const owner = Game.population?.getPerson(pet.ownerId)?.firstName ?? 'Someone';
            this.announce('pet', tick, owner + "'s " + pet.species + ' ' + pet.name + ' passed away', this.indexMaterialized().get(pet.ownerId) ?? null);
        }
    }

    // The ignition sweep (task 102 / H4): one deterministic roll per standing building per day, the hazard
    // interpolated over CONDITION — near-zero for a kept-up building, real for a derelict one. An ignition
    // files a suspectless 'fire' incident (one registry for all emergencies) and the feed hears the alarm.
    public runFireHazard(tick: number): void {
        const field = Game.field;
        const incidents = Game.incidents;
        const conditions = Game.buildingConditions;
        const population = Game.population;
        if (!field || !incidents || !conditions || !population) {
            return;
        }
        const worldSeed = population.getState().worldSeed;
        const day = Math.floor(tick / 24);
        const config = FIRE_CONFIG;
        for (const structure of field.getStructures()) {
            if (!(structure instanceof House) && !(structure instanceof Workplace)) {
                continue;
            }
            if (structure instanceof Workplace && !structure.getBusiness()) {
                continue; // a vacant lot has nothing to burn worth narrating
            }
            const key = structure.getIdentifier();
            conditions.ensure(key, tick);
            if (incidents.openFireAt('building:' + key)) {
                continue; // already burning
            }
            const condition = conditions.conditionOf(key, tick);
            const span = Math.max(1, 100 - config.conditionFloor);
            const perYear = config.ignitionPerYearAtFullCondition
                + (config.ignitionPerYearAtFloor - config.ignitionPerYearAtFullCondition) * (100 - condition) / span;
            const perDay = 1 - Math.exp(-perYear / 360);
            const rng = new SeededRandom((worldSeed ^ hashStringToSeed('fire#' + key + '#' + day)) >>> 0);
            if (rng.next() >= perDay) {
                continue;
            }
            incidents.report('fire', tick, 'building:' + key, null, 0);
            Game.emit('fireStateChanged', { buildingKey: key, burning: true }); // the scene lights the flames (116)
            const name = structure instanceof Workplace ? structure.getBusiness()?.name ?? 'a workplace' : 'a home';
            this.announce('fire', tick, 'A fire broke out at ' + name, null);
        }
    }

    // The effective response quality at a burning building (task 110): system capacity (fire coverage) ×
    // whether the crew PHYSICALLY made it (firefighters on scene / crewForFullResponse, capped at 1). A
    // town with no firefighters employed at all leaves arrival unmeasured — pure coverage, the 102
    // behavior; a town WITH a crew that never arrives (off shift at 3am, stuck across town) burns at the
    // baseline odds no matter what the ledger claims. Never a hardcoded outcome — always the measured path.
    public fireResponseAt(key: string): number {
        const coverage = this.services.coverageOf('fire');
        const firefighters = [...this.indexMaterialized().entries()]
            .filter(([, person]) => person.work.getJob()?.title === 'Firefighter')
            .map(([id]) => id);
        if (firefighters.length === 0) {
            return coverage;
        }
        const onScene = new Set(this.world.peopleAt({ kind: 'building', key }));
        const arrived = firefighters.filter(id => onScene.has(id)).length;
        return coverage * Math.min(1, arrived / FIRE_CONFIG.crewForFullResponse);
    }

    // Burning fires resolve after the response window (task 102): the outcome curve rides the EFFECTIVE
    // RESPONSE (task 110: coverage × who physically arrived — fireResponseAt above) — a staffed station
    // whose crew makes it mostly extinguishes, a town without one watches buildings burn. Lingerers who
    // never evacuated risk the injury roll; a destroyed building leaves through the same coherent teardown
    // bulldozing uses (residents rehoused or homeless, businesses closed), and the lot heals via 037.
    public resolveFires(tick: number): void {
        const incidents = Game.incidents;
        const field = Game.field;
        const conditions = Game.buildingConditions;
        const population = Game.population;
        if (!incidents || !field || !conditions || !population) {
            return;
        }
        const burning = incidents.open().filter(incident => incident.kind === 'fire' && tick - incident.tick >= FIRE_CONFIG.responseTicks);
        if (burning.length === 0) {
            return;
        }
        const worldSeed = population.getState().worldSeed;
        for (const incident of burning.sort((a, b) => a.id - b.id)) {
            const key = incident.locationKey.startsWith('building:') ? incident.locationKey.slice('building:'.length) : incident.locationKey;
            const structure = field.getStructures().find(candidate => candidate instanceof Building && candidate.getIdentifier() === key) as Building | undefined;
            incidents.resolve(incident.id, tick);
            Game.emit('fireStateChanged', { buildingKey: key, burning: false }); // the scene douses the flames (116)
            if (!structure) {
                continue; // already gone (bulldozed mid-fire)
            }
            // Lingerers: whoever is STILL physically inside when the outcome lands rolls the injury die —
            // the responding crew included (task 110: firefighting is an occupational hazard, not a pass)
            // and residents inside their OWN home (their locationOf reads 'home', so the plain building
            // query misses them — the same wart the evacuation hook works around).
            const rng = new SeededRandom((worldSeed ^ hashStringToSeed('fireOutcome#' + incident.id)) >>> 0);
            const inside = new Set(this.world.peopleAt({ kind: 'building', key }));
            if (structure instanceof House) {
                for (const resident of structure.getResidents()) {
                    const residentId = resident.social.getPersonId();
                    if (residentId && resident.getCurrentBuilding() === structure) {
                        inside.add(residentId);
                    }
                }
            }
            for (const occupantId of [...inside].sort()) {
                if (rng.next() < FIRE_CONFIG.injuryChancePerOccupant) {
                    this.fireMilestone('injury', occupantId, tick);
                }
            }
            const response = this.fireResponseAt(key);
            const roll = rng.next();
            const extinguishChance = Math.min(0.92, 0.25 + 0.6 * response);
            const destroyChance = Math.max(0.05, 0.45 - 0.5 * response);
            if (roll < extinguishChance) {
                conditions.damage(key, FIRE_CONFIG.damage.extinguished, tick);
                this.announce('fire', tick, 'The fire was put out — minor damage', null);
            } else if (roll < extinguishChance + destroyChance) {
                // Destroyed: the residents' loss lands in their logs, then the coherent teardown.
                if (structure instanceof House) {
                    for (const resident of structure.getResidents()) {
                        this.fireMilestone('lost_home_to_fire', resident.social.getPersonId(), tick);
                    }
                }
                conditions.remove(key);
                const position = structure.getPosition();
                if (position) {
                    field.bulldoze({ position, tool: Tool.Bulldoze });
                }
                this.announce('fire', tick, 'The building burned to the ground', null);
            } else {
                conditions.damage(key, FIRE_CONFIG.damage.damaged, tick);
                this.announce('fire', tick, 'The fire was contained — heavy damage', null);
            }
        }
    }

    // Entrepreneurship (task 097/I3): a qualified unemployed adult with savings may FOUND a business on a
    // vacant work lot, in the category with the largest unmet demand, in the trade they strictly know (no
    // training-grant founders — you don't open a clinic on a shortcut). At most one founding per month,
    // behind a deterministic seeded roll, so it stays a town event rather than a monthly certainty. The
    // founder's own capital seeds the business (the external sector only tops up the standard amount), they
    // hire themselves at their matched rank, the shop takes their name, and `founded_business` lands in
    // their log with a feed line. Towns grow their own economy instead of waiting for the player.
    private runEntrepreneurship(tick: number): void {
        const field = Game.field;
        const economy = Game.economy;
        const skillBook = Game.skillBook;
        const population = Game.population;
        if (!field || !economy || !skillBook || !population) {
            return;
        }
        const { deficits, vacant } = this.categorySupplyAndDeficits();
        if (vacant.length === 0) {
            return;
        }
        const openCategories = [...deficits.entries()]
            .filter(([, deficit]) => deficit > 0)
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        if (openCategories.length === 0) {
            return;
        }
        const byGenId = this.indexMaterialized();
        const jobMarket = new JobMarket(byGenId, field, skillBook, tick);
        const threshold = DEFAULT_ECONOMY_PARAMS.foundingCapitalThreshold;
        // Age from the pool record (the source of truth), not the sprite — clock-exact and harness-safe.
        const ticksPerYear = Game.clock ? Game.clock.getTicksPerYear() : DEFAULT_POPULATION_PARAMS.ticksPerYear;
        const pool = population.getState().people;
        const candidates = [...byGenId.entries()]
            .filter(([id, person]) => {
                const record = pool[id];
                return record !== undefined
                    && ageAt(record, tick, ticksPerYear) >= ADULT_AGE_YEARS
                    && person.work.getJob() === null
                    && economy.getPersonBalance(id) >= threshold;
            })
            .map(([id]) => id)
            .sort();
        if (candidates.length === 0) {
            return;
        }

        // The first (deficit-ranked, then deterministic) trade someone in town actually knows.
        let pick: { category: string; blueprintKey: string; founderId: PersonId } | null = null;
        for (const [category] of openCategories) {
            const blueprintKeys = Object.keys(BUSINESS_BLUEPRINTS)
                .filter(key => BUSINESS_BLUEPRINTS[key]!.category === category && !isCivicBlueprint(key))
                .sort();
            for (const blueprintKey of blueprintKeys) {
                const blueprint = BUSINESS_BLUEPRINTS[blueprintKey]!;
                const coreJobs = Object.keys(blueprint.jobs).filter(jobKey => jobKey !== 'manager' && jobKey !== 'janitor');
                const trades = coreJobs.length > 0 ? coreJobs : Object.keys(blueprint.jobs);
                const founderId = candidates.find(candidate => trades.some(jobKey => jobMarket.strictlyQualifiesFor(candidate, jobKey)));
                if (founderId) {
                    pick = { category, blueprintKey, founderId };
                    break;
                }
            }
            if (pick) {
                break;
            }
        }
        if (!pick) {
            return;
        }

        const month = Math.floor(tick / TICKS_PER_MONTH);
        const rng = new SeededRandom((population.getState().worldSeed ^ hashStringToSeed(`founding#${month}`)) >>> 0);
        if (rng.next() >= DEFAULT_ECONOMY_PARAMS.foundingChancePerMonth) {
            return; // the spark didn't catch this month
        }

        const lot = vacant[0]!;
        const founder = byGenId.get(pick.founderId)!;
        const blueprint = BUSINESS_BLUEPRINTS[pick.blueprintKey]!;
        // The shop takes the founder's name — from the pool record, the identity source of truth.
        const founderName = pool[pick.founderId]?.firstName || founder.social.getFirstName();
        const business = this.openBusiness(lot, pick.category, {
            blueprintKey: pick.blueprintKey,
            name: `${blueprint.friendlyName} de ${founderName}`,
        });
        if (!business) {
            return;
        }
        // The founder's savings seed the shop; the external-sector standard seed shrinks by the same amount,
        // so total starting capital is unchanged but genuinely SOURCED from the founder (conserved).
        const lotKey = lot.getIdentifier();
        const contribution = Math.min(economy.getPersonBalance(pick.founderId), DEFAULT_ECONOMY_PARAMS.startingBusinessCapital * business.size);
        economy.transfer({ kind: 'person', id: pick.founderId }, { kind: 'business', id: lotKey }, contribution);
        economy.adjustBusiness(lotKey, -contribution);
        jobMarket.hireInto(pick.founderId, lot);
        this.fireMilestone('founded_business', pick.founderId, tick);
        this.announce('career', tick, `${founder.social.getFullName()} founded ${business.name}`, founder);
        Game.emit("tileSpawned", lot);
    }

    // The shared demand-gap scan (tasks 037/097): potential supply per category from operating businesses
    // (full establishment: positions × throughput — don't over-build while an understaffed business still has
    // room to hire up), the unmet-demand deficit per blueprint-buildable category, and the vacant lots.
    // Consumed by re-occupancy (037), the weighted first-placement draw (097/I2), and entrepreneurship (I3).
    private categorySupplyAndDeficits(): { supply: Record<string, number>; deficits: Map<string, number>; vacant: Workplace[] } {
        const field = Game.field;
        const supply: Record<string, number> = {};
        const vacant: Workplace[] = [];
        const deficits = new Map<string, number>();
        if (!field) {
            return { supply, deficits, vacant };
        }
        const categories = new Set(Object.values(BUSINESS_BLUEPRINTS).map(blueprint => blueprint.category));
        for (const structure of field.getStructures()) {
            if (!(structure instanceof Workplace)) {
                continue;
            }
            const business = structure.getBusiness();
            if (!business) {
                vacant.push(structure);
                continue;
            }
            const blueprint = BUSINESS_BLUEPRINTS[business.blueprintKey];
            if (!blueprint) {
                continue;
            }
            const throughput = DEMAND_TABLE[blueprint.category]?.throughputPerEmployee ?? 0;
            supply[blueprint.category] = (supply[blueprint.category] ?? 0) + business.positions.length * throughput;
        }
        const population = field.getPeople().length;
        for (const category of categories) {
            const demand = population * (DEMAND_TABLE[category]?.perCapita ?? 0);
            deficits.set(category, demand - (supply[category] ?? 0));
        }
        vacant.sort((a, b) => a.getIdentifier().localeCompare(b.getIdentifier()));
        return { supply, deficits, vacant };
    }

    private runReoccupancy(tick: number): void {
        const field = Game.field;
        const economy = Game.economy;
        if (!field || !economy) {
            return;
        }

        // Blueprints grouped by category, so a chosen category always has something to build.
        const blueprintsByCategory = new Map<string, string[]>();
        for (const [blueprintKey, blueprint] of Object.entries(BUSINESS_BLUEPRINTS)) {
            if (isCivicBlueprint(blueprintKey)) {
                continue; // civic buildings are placed, never attracted (task 108)
            }
            const keys = blueprintsByCategory.get(blueprint.category) ?? [];
            keys.push(blueprintKey);
            blueprintsByCategory.set(blueprint.category, keys);
        }

        const { supply, vacant } = this.categorySupplyAndDeficits();
        const population = field.getPeople().length;

        for (const workplace of vacant) {
            workplace.setVacantMonths(workplace.getVacantMonths() + 1);
            if (workplace.getVacantMonths() < DEFAULT_ECONOMY_PARAMS.reoccupancyMonths) {
                continue;
            }

            // The category with the largest unmet demand (demand − potential supply) that has a blueprint.
            let bestCategory: string | null = null;
            let bestDeficit = 0;
            for (const category of blueprintsByCategory.keys()) {
                const demand = population * (DEMAND_TABLE[category]?.perCapita ?? 0);
                const deficit = demand - (supply[category] ?? 0);
                if (deficit > bestDeficit) {
                    bestDeficit = deficit;
                    bestCategory = category;
                }
            }
            if (!bestCategory) {
                continue; // no unmet demand anywhere → the lot stays vacant
            }

            const business = this.openBusiness(workplace, bestCategory);
            if (!business) {
                continue;
            }
            // Count the new business's potential capacity so later lots this tick don't pile into the same gap.
            const throughput = DEMAND_TABLE[bestCategory]?.throughputPerEmployee ?? 0;
            supply[bestCategory] = (supply[bestCategory] ?? 0) + business.positions.length * throughput;
            this.announce('businessOpened', tick, `${business.name} opened on a vacant lot`, null);
            Game.emit("tileSpawned", workplace);
        }
    }

    // Pays each employed person their monthly salary from their employer's balance, through the ledger (task
    // 018). A business that can't cover payroll simply goes into debt (negative balance); when it first crosses
    // into the red it surfaces a stress notification — the hook business P&L (020) / bankruptcy (021) consume.
    private runPayroll(tick: number): void {
        const field = Game.field;
        const economy = Game.economy;
        if (!field || !economy) {
            return;
        }

        for (const structure of field.getStructures()) {
            if (!(structure instanceof Workplace)) {
                continue;
            }
            const business = structure.getBusiness();
            if (!business) {
                continue;
            }

            const key = structure.getIdentifier();
            const balanceBefore = economy.getBusinessBalance(key);
            let totalPaid = 0;
            for (const employee of structure.getEmployees()) {
                const job = employee.work.getJob();
                const personId = employee.social.getPersonId();
                if (!job || !personId) {
                    continue;
                }
                economy.transfer({ kind: 'business', id: key }, { kind: 'person', id: personId }, job.salary);
                totalPaid += job.salary;
            }

            if (totalPaid > 0 && balanceBefore >= 0 && economy.getBusinessBalance(key) < 0) {
                this.announce('businessStress', tick, `${business.name} is struggling to pay wages`, null);
            }
        }
    }

    // Charges each household its monthly cost of living (housing + per-resident upkeep) against its residents'
    // pooled funds (task 019). A household that can't cover it pays what it can and accrues an arrears count —
    // the hook eviction (022) consumes. Money leaves to off-map suppliers for now; routing it to local
    // businesses as revenue is part of the demand model (020/035).
    private runCostOfLiving(tick: number): void {
        const field = Game.field;
        const economy = Game.economy;
        if (!field || !economy) {
            return;
        }

        // Materialized retail netting (task 089): what a household already spent at the till this month comes
        // off its abstract cost-of-living charge (they bought part of their consumption concretely) — never
        // below the housing cost itself (rent isn't groceries).
        const materializedSpend = economy.drainMaterializedSpend();

        for (const structure of field.getStructures()) {
            if (!(structure instanceof House)) {
                continue;
            }
            const household = structure.getHousehold();
            const residents = structure.getResidents().filter(resident => resident.social.getPersonId() !== null);
            if (!household || residents.length === 0) {
                continue;
            }

            const householdSpend = residents.reduce((total, resident) => total + (materializedSpend[resident.social.getPersonId()!] ?? 0), 0);
            const fullExpense = DEFAULT_ECONOMY_PARAMS.housingCost + DEFAULT_ECONOMY_PARAMS.perCapitaCost * residents.length;
            const expense = Math.max(DEFAULT_ECONOMY_PARAMS.housingCost, fullExpense - householdSpend);
            const funds = residents.reduce((total, resident) => total + economy.getPersonBalance(resident.social.getPersonId()!), 0);

            // Drain the household's available funds (head first) up to what it can afford; never forced negative.
            let toCharge = Math.min(expense, Math.max(0, funds));
            for (const resident of residents) {
                if (toCharge <= 0) {
                    break;
                }
                const id = resident.social.getPersonId()!;
                const take = Math.min(Math.max(0, economy.getPersonBalance(id)), toCharge);
                economy.adjustPerson(id, -take);
                toCharge -= take;
            }

            const wasInArrears = (household.arrears ?? 0) > 0;
            if (funds < expense) {
                household.arrears = (household.arrears ?? 0) + 1;
                if (!wasInArrears) {
                    this.announce('householdStress', tick, `The ${structure.getHouseholdName()} household can't make ends meet`, null);
                }
            } else {
                household.arrears = 0;
            }
        }
    }

    // Evicts households that have been in arrears (task 019) too long (task 022). Each member is first offered a
    // place in a solvent relative's household (reusing the relocation helper); any member with no taker becomes
    // homeless — they leave the resident list and are hidden, the original household dissolves, the house turns
    // vacant, and a Homeless household is registered for the monthly recovery attempt. Deterministic.
    private runEvictions(tick: number): void {
        const field = Game.field;
        if (!field) {
            return;
        }
        const threshold = DEFAULT_ECONOMY_PARAMS.evictionArrearsMonths;
        const toEvict = field.getStructures().filter((structure): structure is House =>
            structure instanceof House && (structure.getHousehold()?.arrears ?? 0) >= threshold
        );
        for (const house of toEvict) {
            this.evictions += 1; // city-overview tally (task 031)
            this.evictHousehold(house, tick);
        }
    }

    private evictHousehold(house: House, tick: number): void {
        const { householdName, rehoused, homeless } = this.displaceHousehold(house, tick);
        this.announce('evicted', tick, `The ${householdName} household was evicted`, null);
        if (rehoused > 0) {
            this.announce('rehoused', tick, `Relatives took in some of the ${householdName} household`, null);
        }
        if (homeless > 0) {
            this.announce('becameHomeless', tick, `The ${householdName} household is now homeless`, null);
        }
    }

    // Empties a house's household — each member moves to a solvent relative or becomes homeless (kept
    // materialized but hidden, in the registry) — then dissolves the household and vacates the house. Shared by
    // eviction (022) and bulldoze teardown (025); returns a summary so each caller can phrase its own feed
    // messages. A no-op (zeros) when the house has no household.
    private displaceHousehold(house: House, tick: number): { householdName: string; rehoused: number; homeless: number } {
        const population = Game.population;
        const household = house.getHousehold();
        const householdName = house.getHouseholdName();
        if (!population || !household) {
            return { householdName, rehoused: 0, homeless: 0 };
        }
        const pool = population.getPeople();
        const byGenId = this.indexByGenId();

        const homelessIds: PersonId[] = [];
        let rehoused = 0;
        for (const memberId of [...household.memberIds]) {
            const person = byGenId.get(memberId);
            if (!person) {
                continue; // not materialized — nothing to relocate on the map
            }
            const relativeHouse = this.findRelativeHouse(memberId, byGenId, pool, house, tick);
            if (relativeHouse) {
                this.relocateMember(memberId, byGenId, house, relativeHouse);
                this.fireMilestone('taken_in_by_relatives', memberId, tick); // task 076/M4
                rehoused += 1;
            } else {
                // No taker → homeless: leave the home, keep materialized but hidden, await recovery.
                house.removeResident(person);
                house.removeOccupant(person);
                person.social.setHome(null);
                person.setIndoors(true);
                this.fireMilestone('became_homeless', memberId, tick); // task 076/M4
                homelessIds.push(memberId);
            }
        }

        // The original household is dissolved; the house is now vacant.
        house.clearHousehold();
        this.vacateIfEmpty(house);

        if (homelessIds.length > 0) {
            this.homelessHouseholds.push({
                id: `homeless-${household.id}`,
                houseKey: '',
                headId: homelessIds[0]!,
                memberIds: homelessIds,
                arrangement: HouseholdArrangements.Homeless,
                arrears: household.arrears,
            });
        }
        return { householdName, rehoused, homeless: homelessIds.length };
    }

    // Teardown entry points for bulldoze (task 025), called from Field.bulldoze before the soil overwrite so no
    // Person/Household/business is left pointing at the destroyed structure. Reuse the eviction (022) and
    // business-closure (021) paths; the clock supplies the tick.
    public demolishHouse(house: House): void {
        const tick = Game.clock?.getCurrentTick() ?? 0;
        // Reactive wake (LP-12): the displaced re-plan their day at the next minute.
        const displacedIds = house.getResidents().map(person => person.social.getPersonId()).filter((id): id is PersonId => !!id);
        // Teardown symmetry (task 070): the house's objects go down with it; residents keep what they carry.
        Game.inventory?.clearLocation(`building:${house.getIdentifier()}`);
        Game.inventory?.reassignOwnedBy({ kind: 'building', key: house.getIdentifier() }, { kind: 'world' });
        const { householdName, homeless } = this.displaceHousehold(house, tick);
        if (displacedIds.length > 0) {
            this.wakes.enqueue('homeLost', displacedIds);
        }
        if (homeless > 0) {
            this.announce('becameHomeless', tick, `The ${householdName} household is now homeless`, null);
        }
        const label = householdName ? `The ${householdName} home was demolished` : 'A building was demolished';
        this.announce('structureDemolished', tick, label, null);
    }

    public demolishWorkplace(workplace: Workplace): void {
        const tick = Game.clock?.getCurrentTick() ?? 0;
        const business = workplace.getBusiness();
        if (business) {
            this.closeBusiness(workplace, business, workplace.getIdentifier(), tick); // 021: lay off + clear + write off
        }
        const label = business ? `${business.name} was demolished` : 'A building was demolished';
        this.announce('structureDemolished', tick, label, null);
    }

    // The placed home of a solvent relative (with spare capacity) willing to take someone in on eviction — broad
    // kinship search (parents → children → siblings → aunts/uncles → grandparents), deterministic by id.
    private findRelativeHouse(personId: PersonId, byGenId: Map<PersonId, Person>, pool: PersonTable, currentHouse: House, tick: number): House | null {
        const relativeFinders = [parentsOf, childrenOf, siblingsOf, unclesAuntsOf, grandparentsOf];
        for (const find of relativeFinders) {
            const candidates = find(pool, personId).filter(id => byGenId.has(id) && pool[id] && isAliveAt(pool[id]!, tick));
            for (const relativeId of candidates.sort()) {
                const home = byGenId.get(relativeId)!.social.getHome();
                if (home instanceof House && home !== currentHouse
                    && home.getResidents().length < home.getOverview().maxResidents
                    && this.householdSolvent(home)) {
                    return home;
                }
            }
        }
        return null;
    }

    // A household is solvent enough to take someone in when it isn't in arrears and its residents' pooled funds
    // are not in the red.
    private householdSolvent(house: House): boolean {
        const economy = Game.economy;
        const household = house.getHousehold();
        if (!household || (household.arrears ?? 0) > 0) {
            return false;
        }
        if (!economy) {
            return true;
        }
        const funds = house.getResidents().reduce((total, resident) => {
            const id = resident.social.getPersonId();
            return total + (id ? economy.getPersonBalance(id) : 0);
        }, 0);
        return funds >= 0;
    }

    // Monthly recovery (task 022): a homeless household whose members have recovered enough pooled funds (e.g. via
    // re-employment, 015) occupies the lowest-keyed vacant house, forming a fresh household. Members beyond the
    // home's capacity stay homeless; dead members are pruned. Keeps homelessness escapable, not a dead end.
    private runRecovery(tick: number): void {
        const population = Game.population;
        const economy = Game.economy;
        if (!population || !economy) {
            return;
        }
        const pool = population.getPeople();
        const byGenId = this.indexByGenId();

        const remaining: Household[] = [];
        for (const household of this.homelessHouseholds) {
            const livingMembers = household.memberIds.filter(id => byGenId.has(id) && pool[id] && isAliveAt(pool[id]!, tick));
            if (livingMembers.length === 0) {
                continue; // everyone gone — drop the record
            }

            const funds = livingMembers.reduce((total, id) => total + economy.getPersonBalance(id), 0);
            // Prefer a fully-vacant home; if none exists (task 076/L3: a fully-built city used to trap the
            // homeless forever regardless of funds), fall back to any home with a spare slot — moving in with a
            // relative or as roommates — so recovery stays reachable.
            const target = funds >= DEFAULT_ECONOMY_PARAMS.recoveryFunds
                ? (this.findVacantHouse() ?? this.findHouseWithCapacity(livingMembers))
                : null;
            if (!target) {
                remaining.push({ ...household, memberIds: livingMembers, headId: livingMembers[0]! });
                continue;
            }

            const existing = target.getHousehold();
            const freeSlots = Math.max(0, target.getOverview().maxResidents - target.getResidents().length);
            const movers = livingMembers.slice(0, freeSlots);
            for (const id of movers) {
                const person = byGenId.get(id)!;
                person.social.setHome(target);
                person.setIndoors(true);
                target.addResident(person);
                target.addOccupant(person);
                this.fireMilestone('got_back_on_feet', id, tick); // task 076/M4
            }
            if (existing) {
                // Joined an existing household (moved in with family/roommates): append, keep its head.
                target.setHousehold({ ...existing, memberIds: [...existing.memberIds, ...movers] });
            } else {
                target.setHousehold({
                    id: `hh-${target.getIdentifier()}`,
                    houseKey: target.getIdentifier(),
                    headId: movers[0]!,
                    memberIds: movers,
                    arrangement: movers.length === 1 ? HouseholdArrangements.Single : HouseholdArrangements.Nuclear,
                });
            }
            Game.emit("tileSpawned", target); // now occupied → drop the vacant look
            this.announce('rehoused', tick, `A homeless household found a home again`, null);

            // Anyone who didn't fit stays homeless.
            const leftover = livingMembers.slice(movers.length);
            if (leftover.length > 0) {
                remaining.push({ ...household, memberIds: leftover, headId: leftover[0]! });
            }
        }
        this.homelessHouseholds = remaining;
    }

    // Removes materialized residents who died this day from their house, household, and the field.
    private reconcileDeaths(diedIds: PersonId[], personByGenId: Map<PersonId, Person>): void {
        const field = Game.field;
        if (!field) {
            return;
        }
        for (const personId of diedIds) {
            const person = personByGenId.get(personId);
            if (!person) {
                continue;
            }

            const home = person.social.getHome();
            if (home) {
                home.removeResident(person);
                home.removeOccupant(person);
                const household = home.getHousehold();
                if (household) {
                    household.memberIds = household.memberIds.filter(memberId => memberId !== personId);
                    if (household.headId === personId) {
                        household.headId = household.memberIds[0] ?? household.headId;
                    }
                }
                // If the house just emptied out, re-draw it so it reads as vacant (desaturated).
                if (home instanceof House) {
                    this.vacateIfEmpty(home);
                }
            } else {
                // A homeless person who died: prune them from the homeless registry (task 022).
                this.removeFromHomelessRegistry(personId);
            }

            field.removePerson(person);
            this.population = Math.max(0, this.population - 1);
        }
    }

    // Drops a person from any homeless household, reassigning the head and discarding emptied records (task 022).
    private removeFromHomelessRegistry(personId: PersonId): void {
        for (const household of this.homelessHouseholds) {
            household.memberIds = household.memberIds.filter(id => id !== personId);
            if (household.headId === personId) {
                household.headId = household.memberIds[0] ?? household.headId;
            }
        }
        this.homelessHouseholds = this.homelessHouseholds.filter(household => household.memberIds.length > 0);
    }

    // Materializes newborns of materialized mothers into the mother's house, mirroring setupHousehold's
    // materialization. The newborn already exists in the genealogy pool (the birth effect appended it).
    private async materializeNewborns(born: { id: PersonId; motherId: PersonId; fatherId: PersonId }[], personByGenId: Map<PersonId, Person>): Promise<void> {
        const population = Game.population;
        const clock = Game.clock;
        if (!population || !clock) {
            return;
        }

        for (const birth of born) {
            const mother = personByGenId.get(birth.motherId);
            const home = mother?.social.getHome();
            if (!mother || !(home instanceof House)) {
                continue;
            }
            const genChild = population.getPerson(birth.id);
            if (!genChild) {
                continue;
            }

            const person: Person = await Game.emitSingle("personSpawnRequest", home.getEntrance());
            if (!person) {
                continue;
            }

            person.setIndoors(true);
            person.social.setHome(home);
            person.setupCitizenship(genChild.firstName, genChild.familyName, 0, genChild.gender);
            person.social.setBirthTick(genChild.birthTick);
            person.social.setPersonId(birth.id);
            // Newborns start skill-less (task 062); milestones/school/education add proficiency with age.
            Game.skillBook?.initialize(birth.id, 0, genChild.birthTick, clock.getCurrentTick(), population.getState().worldSeed, JOB_CORE_SKILLS);

            home.addResident(person);
            home.addOccupant(person);
            personByGenId.set(birth.id, person);

            const household = home.getHousehold();
            if (household) {
                household.memberIds.push(birth.id);
            }

            this.population += 1;
        }
    }

    // Relocates survivors of households left incoherent by a death — primarily a minor whose only adult
    // (guardian/parent) died, leaving them "living alone" (task 011 / docs/tasks/013 §10). Each orphaned minor
    // is moved into a living relative's placed household (sibling → aunt/uncle → grandparent priority) that has
    // capacity. Public for unit testing; in production it runs from handleNewDay after death reconciliation.
    public resolveRehousing(tick: number, ticksPerYear: number): void {
        const field = Game.field;
        const population = Game.population;
        if (!field || !population) {
            return;
        }
        const pool = population.getPeople();

        const byGenId = new Map<PersonId, Person>();
        for (const person of field.getPeople()) {
            const id = person.social.getPersonId();
            if (id) {
                byGenId.set(id, person);
            }
        }

        for (const structure of field.getStructures()) {
            if (!(structure instanceof House)) {
                continue;
            }
            const household = structure.getHousehold();
            if (!household) {
                continue;
            }

            const livingMembers = household.memberIds.filter(id => byGenId.has(id) && pool[id] && isAliveAt(pool[id]!, tick));
            if (livingMembers.length === 0) {
                continue;
            }
            const hasAdult = livingMembers.some(id => ageAt(pool[id]!, tick, ticksPerYear) >= ADULT_AGE_YEARS);
            if (hasAdult) {
                continue; // a coherent guardian remains
            }

            // No adult present: relocate each minor to a relative's adult household.
            for (const minorId of [...livingMembers]) {
                const target = this.findGuardianHouse(minorId, pool, byGenId, structure, tick, ticksPerYear);
                if (target) {
                    this.relocateMember(minorId, byGenId, structure, target);
                }
            }
        }
    }

    private findGuardianHouse(minorId: PersonId, pool: PersonTable, byGenId: Map<PersonId, Person>, currentHouse: House, tick: number, ticksPerYear: number): House | null {
        const relativeFinders = [siblingsOf, unclesAuntsOf, grandparentsOf];
        for (const find of relativeFinders) {
            const candidates = find(pool, minorId).filter(id =>
                byGenId.has(id) && pool[id] && isAliveAt(pool[id]!, tick) && ageAt(pool[id]!, tick, ticksPerYear) >= ADULT_AGE_YEARS
            );
            for (const relativeId of candidates.sort()) {
                const home = byGenId.get(relativeId)!.social.getHome();
                if (home instanceof House && home !== currentHouse && home.getResidents().length < home.getOverview().maxResidents) {
                    return home;
                }
            }
        }
        return null;
    }

    private relocateMember(personId: PersonId, byGenId: Map<PersonId, Person>, fromHouse: House, toHouse: House): void {
        const person = byGenId.get(personId);
        if (!person) {
            return;
        }

        this.removeFromHome(person, personId, fromHouse);

        toHouse.addResident(person);
        toHouse.addOccupant(person);
        person.social.setHome(toHouse);
        const toHousehold = toHouse.getHousehold();
        if (toHousehold && !toHousehold.memberIds.includes(personId)) {
            toHousehold.memberIds.push(personId);
        }
    }

    // Detaches a person from their current house + household (the removal half of a relocation, shared by
    // death-reconcile, rehousing, cohabitation, and move-out). Drops them from the resident/occupant lists,
    // prunes the household memberIds (reassigning head if needed), and re-draws the house vacant if it emptied.
    private removeFromHome(person: Person, personId: PersonId, fromHouse: House): void {
        fromHouse.removeResident(person);
        fromHouse.removeOccupant(person);
        const fromHousehold = fromHouse.getHousehold();
        if (fromHousehold) {
            fromHousehold.memberIds = fromHousehold.memberIds.filter(id => id !== personId);
            if (fromHousehold.headId === personId) {
                fromHousehold.headId = fromHousehold.memberIds[0] ?? fromHousehold.headId;
            }
        }
        this.vacateIfEmpty(fromHouse);
    }

    // Re-draws a house as vacant (desaturated) once its last resident leaves, mirroring the empty-house path in
    // reconcileDeaths. The MainScene vacancy check keys off an empty resident list, so a re-emit is enough.
    private vacateIfEmpty(house: House): void {
        if (house.getResidents().length === 0) {
            Game.emit("tileSpawned", house);
        }
    }

    // Indexes the materialized (on-map) people by their genealogy pool id — the lookup death-rehousing,
    // cohabitation, and move-out all need to map signals/relations back to live Persons.
    private indexByGenId(): Map<PersonId, Person> {
        const byGenId = new Map<PersonId, Person>();
        const field = Game.field;
        if (!field) {
            return byGenId;
        }
        for (const person of field.getPeople()) {
            const id = person.social.getPersonId();
            if (id) {
                byGenId.set(id, person);
            }
        }
        return byGenId;
    }

    // The materialized minor children of `parentId` who currently live in `house` — the dependents that move
    // with a parent on cohabitation (task 023).
    private dependentMinorsInHouse(parentId: PersonId, house: House, byGenId: Map<PersonId, Person>, pool: PersonTable, tick: number, ticksPerYear: number): PersonId[] {
        return childrenOf(pool, parentId).filter(childId => {
            const child = byGenId.get(childId);
            return !!child && child.social.getHome() === house
                && !!pool[childId] && isAliveAt(pool[childId]!, tick)
                && ageAt(pool[childId]!, tick, ticksPerYear) < ADULT_AGE_YEARS;
        });
    }

    // Newlywed cohabitation (task 023): when a marriage forms between two materialized people living apart, move
    // the couple (and the moving spouse's dependent minors) into one home. Policy: the larger household stays
    // put and the smaller side moves in (ties keep the subject's home); the move is skipped if the combined
    // household would exceed the target's capacity (a housing-market relocation is a future task). Public for
    // unit testing; in production it runs from handleNewDay on the `partnershipFormed` signal.
    public resolveCohabitation(subjectId: PersonId, tick: number, ticksPerYear: number): void {
        const population = Game.population;
        if (!population) {
            return;
        }
        const pool = population.getPeople();

        const spouseId = spouseAt(pool, subjectId, tick);
        if (!spouseId) {
            return;
        }

        const byGenId = this.indexByGenId();
        const subject = byGenId.get(subjectId);
        const spouse = byGenId.get(spouseId);
        if (!subject || !spouse) {
            return; // only relocate when both spouses are materialized (pool-only partners just record the marriage)
        }

        const subjectHome = subject.social.getHome();
        const spouseHome = spouse.social.getHome();
        if (!(subjectHome instanceof House) || !(spouseHome instanceof House) || subjectHome === spouseHome) {
            return;
        }

        // Keep the larger household put; the smaller side moves in (ties keep the subject's home).
        let target = subjectHome;
        let source = spouseHome;
        let moverSpouseId = spouseId;
        if (spouseHome.getResidents().length > subjectHome.getResidents().length) {
            target = spouseHome;
            source = subjectHome;
            moverSpouseId = subjectId;
        }

        const movers = [moverSpouseId, ...this.dependentMinorsInHouse(moverSpouseId, source, byGenId, pool, tick, ticksPerYear)];
        if (target.getResidents().length + movers.length > target.getOverview().maxResidents) {
            return; // neither home can hold the combined household — leave them put (housing market, future)
        }

        for (const moverId of movers) {
            this.relocateMember(moverId, byGenId, source, target);
        }
        this.announce('cohabited', tick, `${subject.social.getFullName()} and ${spouse.social.getFullName()} moved in together`, subject);
    }

    // Adult-child move-out (task 024): a grown child who leaves home (the `move_out` event, gated on a vacant
    // house being available) is relocated into that vacant house as a new single-person household, shrinking the
    // parental household. If the last vacant home was taken earlier the same day, the move is a no-op. Public for
    // unit testing; in production it runs from handleNewDay on the `movedOut` signal.
    public resolveMoveOut(personId: PersonId, tick: number): void {
        const byGenId = this.indexByGenId();
        const person = byGenId.get(personId);
        if (!person) {
            return;
        }
        const fromHouse = person.social.getHome();
        if (!(fromHouse instanceof House)) {
            return;
        }
        const vacant = this.findVacantHouse();
        if (!vacant) {
            return; // no home available (a same-day mover may have taken the last one)
        }

        this.removeFromHome(person, personId, fromHouse);
        vacant.addResident(person);
        vacant.addOccupant(person);
        person.social.setHome(vacant);
        vacant.setHousehold({
            id: `hh-${vacant.getIdentifier()}`,
            houseKey: vacant.getIdentifier(),
            headId: personId,
            memberIds: [personId],
            arrangement: HouseholdArrangements.Single,
        });
        // Now occupied → re-draw so it drops the vacant (desaturated) look.
        Game.emit("tileSpawned", vacant);
        this.fireMilestone('left_home_first_time', personId, tick); // task 076/M4
        this.announce('movedOut', tick, `${person.social.getFullName()} moved into their own place`, person);
    }

    // The lowest-keyed vacant house (no residents), or null — the destination for move-out (024) and the
    // recovery path for eviction (022). Deterministic by anchor key.
    private findVacantHouse(): House | null {
        const field = Game.field;
        if (!field) {
            return null;
        }
        let best: House | null = null;
        let bestKey = '';
        for (const structure of field.getStructures()) {
            if (structure instanceof House && structure.getResidents().length === 0) {
                const key = structure.getIdentifier();
                if (!best || key < bestKey) {
                    best = structure;
                    bestKey = key;
                }
            }
        }
        return best;
    }

    // An occupied house with at least one free resident slot (task 076/L3): the recovery fallback when no
    // fully-vacant home exists. Prefers a house where the recovering members already have a living relative
    // (move in with family), else the lowest-keyed house with room. Null only if every home is full.
    private findHouseWithCapacity(memberIds: PersonId[]): House | null {
        const field = Game.field;
        if (!field) {
            return null;
        }
        const pool = Game.population?.getPeople() ?? {};
        const relatives = new Set<PersonId>();
        for (const id of memberIds) {
            for (const relative of [...parentsOf(pool, id), ...childrenOf(pool, id), ...siblingsOf(pool, id)]) {
                relatives.add(relative);
            }
        }
        let best: House | null = null, bestKey = '';
        let relativeHome: House | null = null, relativeKey = '';
        for (const structure of field.getStructures()) {
            if (!(structure instanceof House)) {
                continue;
            }
            const residents = structure.getResidents();
            if (residents.length === 0 || residents.length >= structure.getOverview().maxResidents) {
                continue; // fully vacant is handled by findVacantHouse; full has no room
            }
            const key = structure.getIdentifier();
            const hasRelative = residents.some(resident => {
                const rid = resident.social.getPersonId();
                return rid != null && relatives.has(rid);
            });
            if (hasRelative && (!relativeHome || key < relativeKey)) {
                relativeHome = structure;
                relativeKey = key;
            }
            if (!best || key < bestKey) {
                best = structure;
                bestKey = key;
            }
        }
        return relativeHome ?? best;
    }

    // Schedule-driven commute (task 006). On each in-game minute, dispatch employed, idle residents: out to
    // work once their shift has started, back home once it has ended. Each trip spawns a car at the origin's
    // entrance and drives the Person's TravelStep machine (walk → drive → walk), despawning the car on arrival.
    // Public for unit testing; invoked via the "timeChanged" event in production.
    public getWorld(): LiveWorld {
        return this.world;
    }

    // The per-person shift loop that used to live here is retired (task 046): work attendance is now a
    // Brain obligation intent — the work Action requests a transition through the execution boundary, and
    // LiveWorld drives the same commute machinery. This handler only pumps pending transitions at the finer
    // minute cadence so arrivals resolve promptly between hourly ticks.
    public handleCommute(event: TimeChangedEvent): void {
        // The minute rides along (LP-11): deferred departures leave at their scheduled minute of the hour.
        this.world.pump(event.tick, event.timestamp.minute);

        // Reactive wakes drain on the same minute cadence (LP-12): world mutations between flips re-evaluate
        // the affected people NOW, not at the next hour.
        this.runWakePass(event.tick);

        // Ambulatory sweep (task 093 / E1): each in-game minute, flag residents whose ACTIVE action is
        // authored `ambulatory` so the field's wander machinery visibly walks them — joggers jog, strollers
        // stroll. Derived state (never serialized); clears itself when the activity ends.
        const actionEngine = Game.actionEngine;
        const field = Game.field;
        if (actionEngine && field) {
            for (const person of field.getPeople()) {
                const personId = person.social.getPersonId();
                if (!personId) {
                    continue;
                }
                const active = actionEngine.activeInstanceOf(personId);
                const def = active && active.status === 'running' ? actionEngine.getDefinition(active.defId) : null;
                person.setAmbulatory(def?.ambulatory !== undefined);
            }
        }
    }

    private startCommute(person: Person, destination: Building): void {
        const field = Game.field;
        if (!field) {
            return;
        }
        const origin = person.getCurrentBuilding() ?? person.social.getHome();
        const entrance = origin ? origin.getEntrance() : null;
        if (!entrance) {
            return;
        }

        // Minors walk (task 058): children don't drive, so no commute car is spawned — Person.processTravel
        // routes them on foot straight to the destination over the pedestrian network.
        if (person.social.getAge() < ADULT_AGE_YEARS) {
            person.setDestination(destination);
            return;
        }

        // The car materializes ON THE STREET in front of the origin building (task 008 commute spec), never
        // inside a footprint — the person walks out to it and boards. Entrance fallback for legacy/test
        // worlds with no adjacent road.
        const streetTile = origin ? field.getAdjacentRoadTile(origin) : null;
        const streetSpot = streetTile ? Game.tileToPixelPosition(streetTile) : null;
        const vehicle = field.spawnVehicle(streetSpot ?? entrance);
        vehicle.setControlled(true);
        person.setVehicle(vehicle);
        person.setDestination(destination);
    }

    public setupCar(vehicle: Vehicle): void {
        console.log('Car spawning', vehicle);
    }
}


