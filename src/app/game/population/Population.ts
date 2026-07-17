import { fakerPT_BR } from '@faker-js/faker';

import { selectHousehold, HouseholdSelection } from 'game/population/HouseholdDraw';
import lifeSimulationConfig from 'json/lifeSimulation.json';
import populationConfig from 'json/population.json';
import { GenPerson, PersonId, PersonTable, PopulationState, PopulationParams, SimulationParams, SimulationResult } from 'types/Genealogy';
import { Genders, Gender } from 'types/Social';
import { sampleMaxChildren } from 'util/fertility';
import { isAliveAt, spouseAt, childrenOf, ageAt } from 'util/kinship';
import { SeededRandom } from 'util/random';

export const DEFAULT_POPULATION_PARAMS: PopulationParams = populationConfig as PopulationParams;
export const DEFAULT_SIMULATION_PARAMS: SimulationParams = lifeSimulationConfig as SimulationParams;

// Annual probability of death at a given age (Gompertz), clamped; certain death at/over the age cap.
export function annualMortality(ageYears: number, params: SimulationParams): number {
    if (ageYears >= params.maxAgeYears) {
        return 1;
    }
    const q = params.mortalityBase * Math.exp(params.mortalityGrowth * Math.max(0, ageYears));
    return Math.min(params.maxMortality, q);
}

// Advances the living population by whole in-game years up to `currentTick`: applies age-based mortality and
// births to married, fertile couples. Pure given the world seed (each year derives its own RNG stream), so it
// is deterministic and reproducible across save/load. Mutates the pool (deathTicks, new children,
// lastSimulatedYear) and returns what changed so callers can reconcile materialized residents.
export function simulatePopulation(
    state: PopulationState,
    currentTick: number,
    ticksPerYear: number,
    params: SimulationParams = DEFAULT_SIMULATION_PARAMS,
    excludeIds: Set<PersonId> = new Set()
): SimulationResult {
    const result: SimulationResult = { died: [], born: [] };
    if (ticksPerYear <= 0) {
        return result;
    }

    const currentYear = Math.floor(currentTick / ticksPerYear);
    const fromYear = state.lastSimulatedYear + 1;
    const toYear = Math.min(currentYear, state.lastSimulatedYear + params.maxCatchUpYears);

    for (let year = fromYear; year <= toYear; year++) {
        simulateYear(state, year, ticksPerYear, params, result, excludeIds);
    }
    // Advance the cursor only to the last year actually simulated (task 076/M7). Previously this jumped to the
    // full currentYear, so any year beyond the maxCatchUpYears cap was silently never simulated (mortality and
    // births for those years vanished). Now the capped remainder is caught up on subsequent calls instead.
    state.lastSimulatedYear = Math.max(state.lastSimulatedYear, toYear);
    return result;
}

function simulateYear(
    state: PopulationState,
    year: number,
    ticksPerYear: number,
    params: SimulationParams,
    result: SimulationResult,
    excludeIds: Set<PersonId>
): void {
    const pool = state.people;
    const tick = year * ticksPerYear;
    // Each year gets its own deterministic stream derived from the world seed; seed faker likewise so
    // newborn names are reproducible across save/load.
    const rng = new SeededRandom(state.worldSeed).fork(year);
    fakerPT_BR.seed((state.worldSeed ^ (year * 0x9e3779b1)) >>> 0);

    // Snapshot the living before mutating, so newborns aren't processed in the same year. Materialized
    // (on-map) people are excluded — their life events are owned by the per-day event engine (Engine B),
    // so the coarse pool sim only advances the off-map population. See docs/tasks/013 §1 decision 4.
    const living = Object.values(pool).filter(person => isAliveAt(person, tick) && !excludeIds.has(person.id));

    // Mortality.
    for (const person of living) {
        const ageYears = (tick - person.birthTick) / ticksPerYear;
        if (rng.chance(annualMortality(ageYears, params))) {
            person.deathTick = tick;
            result.died.push(person.id);
        }
    }

    // Births: married, fertile women still alive after this year's mortality.
    for (const woman of living) {
        if (woman.gender !== Genders.Female || woman.deathTick !== null) {
            continue;
        }
        const ageYears = (tick - woman.birthTick) / ticksPerYear;
        if (ageYears < params.fertileMinAgeYears || ageYears > params.fertileMaxAgeYears) {
            continue;
        }
        const partnerId = spouseAt(pool, woman.id, tick);
        if (!partnerId) {
            continue;
        }
        const partner = pool[partnerId];
        if (!partner || partner.deathTick !== null) {
            continue;
        }
        // Bounded fertility: a woman stops once she has reached her innate willingness (maxChildren). Mirrors
        // the pregnancy event's `wantsMoreChildren` gate so the off-map coarse sim doesn't over-breed either.
        if (childrenOf(pool, woman.id).length >= (woman.maxChildren ?? Number.POSITIVE_INFINITY)) {
            continue;
        }
        if (rng.chance(params.annualBirthProbability)) {
            const id = `p${state.nextSeq++}`;
            const gender = rng.chance(0.5) ? Genders.Male : Genders.Female;
            pool[id] = {
                id,
                firstName: fakerPT_BR.person.firstName(gender),
                familyName: partner.familyName,
                gender,
                birthTick: tick,
                deathTick: null,
                fatherId: partner.id,
                motherId: woman.id,
                partnerships: [],
                maxChildren: sampleMaxChildren(rng),
            };
            result.born.push(id);
        }
    }
}

// The present epoch. Ages are derived against the clock's current tick at runtime; generation anchors "now"
// at tick 0 so ancestors have negative birthTicks and the living cohort straddles it.
const PRESENT_TICK = 0;

// --- Founder primitive (task 055 Phase 0) ---------------------------------------------------------------
// The offline history generator (game/HistoryAsset.ts) needs ONLY founder creation — the detailed engine does
// the breeding forward from tick 0, so the coarse descendant generation above is never run on the asset path.
// createFounders is a pure function of (seed, count): `count` founders (count/2 couples) born at negative
// ticks so they are already adults at tick 0, paired and married just before it, ready to reproduce as the
// engine ticks forward. Deterministic and RNG-explicit, mirroring generatePopulation's conventions.

export interface FounderParams {
    ticksPerYear: number;
    minFounderAgeYears: number;
    maxFounderAgeYears: number;
    spouseMaxAgeGapYears: number;
}

export const DEFAULT_FOUNDER_PARAMS: FounderParams = {
    ticksPerYear: DEFAULT_POPULATION_PARAMS.ticksPerYear,
    minFounderAgeYears: 20,
    maxFounderAgeYears: 35,
    spouseMaxAgeGapYears: DEFAULT_POPULATION_PARAMS.spouseMaxAgeGapYears,
};

export function createFounders(seed: number, count: number, params: FounderParams = DEFAULT_FOUNDER_PARAMS): PopulationState {
    const rng = new SeededRandom(seed);
    fakerPT_BR.seed(seed >>> 0);

    const people: PersonTable = {};
    let counter = 0;
    const yearsToTicks = (years: number): number => Math.round(years * params.ticksPerYear);

    const createFounder = (gender: Gender, birthTick: number): GenPerson => {
        const id = `p${counter++}`;
        const person: GenPerson = {
            id,
            firstName: fakerPT_BR.person.firstName(gender),
            familyName: fakerPT_BR.person.lastName(),
            gender,
            birthTick,
            deathTick: null,
            fatherId: null,
            motherId: null,
            partnerships: [],
            maxChildren: sampleMaxChildren(rng),
        };
        people[id] = person;
        return person;
    };

    const coupleCount = Math.floor(Math.max(0, count) / 2);
    for (let i = 0; i < coupleCount; i++) {
        const husbandAge = rng.nextInt(params.minFounderAgeYears, params.maxFounderAgeYears);
        const husband = createFounder(Genders.Male, -yearsToTicks(husbandAge));
        const gapYears = rng.nextInt(-params.spouseMaxAgeGapYears, params.spouseMaxAgeGapYears);
        const wife = createFounder(Genders.Female, husband.birthTick + yearsToTicks(gapYears));
        // Married just before the present so they can reproduce as the engine ticks forward from 0.
        const startTick = Math.max(husband.birthTick, wife.birthTick) + yearsToTicks(params.minFounderAgeYears);
        husband.partnerships.push({ partnerId: wife.id, startTick, endTick: null });
        wife.partnerships.push({ partnerId: husband.id, startTick, endTick: null });
    }

    return {
        worldSeed: seed,
        people,
        drawSeed: rng.getState(),
        placedIds: [],
        nextSeq: counter,
        lastSimulatedYear: 0,
    };
}

interface Couple {
    maleId: PersonId;
    femaleId: PersonId;
}

// generatePopulation is a pure function of (seed, params): the same inputs always yield a byte-identical
// PopulationState. It forward-simulates several generations of intertwined family trees — founders pair and
// have children, those children pair (across family lines, giving cross-household genealogy) and have their
// own children, and lifespans are sampled so older generations are mostly deceased. The result is a flat,
// serializable table of people: a large pool of dead ancestors plus a living cohort to draw households from.
export function generatePopulation(seed: number, params: PopulationParams): PopulationState {
    const rng = new SeededRandom(seed);
    // faker shares the structural seed so generated names are reproducible alongside the graph.
    fakerPT_BR.seed(seed);

    const people: PersonTable = {};
    let counter = 0;

    const yearsToTicks = (years: number): number => Math.round(years * params.ticksPerYear);
    const ageGapYears = (a: GenPerson, b: GenPerson): number => Math.abs(a.birthTick - b.birthTick) / params.ticksPerYear;
    const atCap = (): boolean => counter >= params.maxPopulation;

    function createPerson(gender: Gender, birthTick: number, fatherId: PersonId | null, motherId: PersonId | null, familyName: string): GenPerson {
        const id = `p${counter++}`;
        const person: GenPerson = {
            id,
            firstName: fakerPT_BR.person.firstName(gender),
            familyName,
            gender,
            birthTick,
            deathTick: null,
            fatherId,
            motherId,
            partnerships: [],
            maxChildren: sampleMaxChildren(rng),
        };
        people[id] = person;
        return person;
    }

    // Samples a lifespan and marks the person dead if they would have died on or before the present.
    function assignLifespanDeath(person: GenPerson): void {
        // Triangular distribution centred on the mean, within ±spread.
        const lifespanYears = Math.max(1, params.lifespanMeanYears + (rng.next() + rng.next() - 1) * params.lifespanSpreadYears);
        const deathCandidate = person.birthTick + yearsToTicks(lifespanYears);
        if (deathCandidate <= PRESENT_TICK) {
            person.deathTick = deathCandidate;
        }
    }

    function sampleChildCount(): number {
        const weights = params.childDistribution;
        const total = weights.reduce((sum, weight) => sum + weight, 0);
        let roll = rng.next() * total;
        for (let i = 0; i < weights.length; i++) {
            roll -= weights[i]!;
            if (roll < 0) {
                return i;
            }
        }
        return weights.length - 1;
    }

    function shareParent(a: GenPerson, b: GenPerson): boolean {
        return (
            (a.fatherId !== null && a.fatherId === b.fatherId) ||
            (a.motherId !== null && a.motherId === b.motherId)
        );
    }

    function shuffle<T>(items: T[]): T[] {
        const copy = [...items];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = rng.nextInt(0, i);
            const swap = copy[i]!;
            copy[i] = copy[j]!;
            copy[j] = swap;
        }
        return copy;
    }

    // Records a (coherent) marriage between two people, ending it at the first spouse's death if applicable.
    function marry(a: GenPerson, b: GenPerson, startTick: number): void {
        const deaths = [a.deathTick, b.deathTick].filter((d): d is number => d !== null);
        let endTick: number | null = deaths.length ? Math.min(...deaths) : null;
        if (endTick !== null && endTick <= startTick) {
            endTick = startTick; // degenerate, but keep the invariant endTick >= startTick
        }
        a.partnerships.push({ partnerId: b.id, startTick, endTick });
        b.partnerships.push({ partnerId: a.id, startTick, endTick });
    }

    // A plausible marriage tick for a pair: the older partner reaches adulthood. Null if either is already
    // dead by then (so we never marry the deceased).
    function marriageTick(a: GenPerson, b: GenPerson): number | null {
        const tick = Math.max(a.birthTick, b.birthTick) + yearsToTicks(rng.nextInt(params.parentMinAgeYears, params.parentMinAgeYears + 6));
        if (!isAliveAt(a, tick) || !isAliveAt(b, tick)) {
            return null;
        }
        return tick;
    }

    // Pairs adults of one generation into reproductive couples for the next. Pairing reaches across family
    // lines (excluding siblings) so the resulting trees span what will become separate households. Unpaired
    // people may receive a fresh immigrant spouse to keep lines branching.
    function pairUp(individuals: GenPerson[]): Couple[] {
        const couples: Couple[] = [];
        const paired = new Set<PersonId>();
        const shuffled = shuffle(individuals);
        const females = shuffled.filter(person => person.gender === Genders.Female);

        for (const male of shuffled) {
            if (male.gender !== Genders.Male || paired.has(male.id)) {
                continue;
            }
            if (!rng.chance(params.pairingProbability)) {
                continue;
            }

            let matched: GenPerson | null = null;
            for (const female of females) {
                if (paired.has(female.id) || shareParent(male, female)) {
                    continue;
                }
                if (ageGapYears(male, female) > params.spouseMaxAgeGapYears) {
                    continue;
                }
                const tick = marriageTick(male, female);
                if (tick === null) {
                    continue;
                }
                marry(male, female, tick);
                matched = female;
                break;
            }

            if (matched) {
                paired.add(male.id);
                paired.add(matched.id);
                couples.push({ maleId: male.id, femaleId: matched.id });
            } else if (!atCap() && rng.chance(params.immigrantSpouseProbability)) {
                const gapYears = rng.nextInt(-params.spouseMaxAgeGapYears, params.spouseMaxAgeGapYears);
                const immigrant = createPerson(Genders.Female, male.birthTick + yearsToTicks(gapYears), null, null, fakerPT_BR.person.lastName());
                assignLifespanDeath(immigrant);
                const tick = marriageTick(male, immigrant);
                if (tick !== null) {
                    marry(male, immigrant, tick);
                    paired.add(male.id);
                    paired.add(immigrant.id);
                    couples.push({ maleId: male.id, femaleId: immigrant.id });
                }
            }
        }

        return couples;
    }

    // Births for one generation: each couple has children, all anchored after both parents reach the
    // sampled parenting age and only while both parents are still alive.
    function birthChildren(couples: Couple[]): GenPerson[] {
        const children: GenPerson[] = [];
        for (const couple of couples) {
            const father = people[couple.maleId]!;
            const mother = people[couple.femaleId]!;
            const count = sampleChildCount();
            for (let c = 0; c < count; c++) {
                if (atCap()) {
                    return children;
                }
                const parentAge = rng.nextInt(params.parentMinAgeYears, params.parentMaxAgeYears);
                const birthTick = Math.max(father.birthTick, mother.birthTick) + yearsToTicks(parentAge);
                if (birthTick > PRESENT_TICK) {
                    continue; // not yet born relative to the present epoch
                }
                if (!isAliveAt(father, birthTick) || !isAliveAt(mother, birthTick)) {
                    continue; // a parent had already died
                }
                const gender = rng.chance(0.5) ? Genders.Male : Genders.Female;
                const child = createPerson(gender, birthTick, father.id, mother.id, father.familyName);
                assignLifespanDeath(child);
                children.push(child);
            }
        }
        return children;
    }

    // --- Founders --------------------------------------------------------------
    // Anchor founders far enough in the past that, after `generations` of ~generationGapYears each, the
    // youngest generation straddles the present.
    const founderBirthYear = -(params.generations * params.generationGapYears);
    let couples: Couple[] = [];
    for (let i = 0; i < params.founderCouples && !atCap(); i++) {
        const husbandBirth = yearsToTicks(founderBirthYear + (rng.next() - 0.5) * params.generationGapYears);
        const husband = createPerson(Genders.Male, husbandBirth, null, null, fakerPT_BR.person.lastName());
        assignLifespanDeath(husband);

        if (atCap()) {
            break;
        }
        const wifeGap = rng.nextInt(-params.spouseMaxAgeGapYears, params.spouseMaxAgeGapYears);
        const wife = createPerson(Genders.Female, husbandBirth + yearsToTicks(wifeGap), null, null, fakerPT_BR.person.lastName());
        assignLifespanDeath(wife);

        const tick = marriageTick(husband, wife);
        if (tick !== null) {
            marry(husband, wife, tick);
        }
        couples.push({ maleId: husband.id, femaleId: wife.id });
    }

    // --- Descendant generations ------------------------------------------------
    for (let generation = 1; generation <= params.generations && !atCap(); generation++) {
        const children = birthChildren(couples);
        couples = pairUp(children);
    }

    return {
        worldSeed: seed,
        people,
        drawSeed: rng.getState(),
        placedIds: [],
        nextSeq: counter,
        lastSimulatedYear: 0,
    };
}

// Owns the live PopulationState for a game and offers read access. Generation is the pure function above;
// this class is the simulation-core holder (created per game, serialized into the save). Household drawing
// and the live births/deaths simulation are layered on in later phases (004c/004d).
export default class Population {
    private state: PopulationState;

    constructor(state?: PopulationState) {
        this.state = state ?? { worldSeed: 0, people: {}, drawSeed: 0, placedIds: [], nextSeq: 0, lastSimulatedYear: 0 };
    }

    generate(seed: number, params: PopulationParams = DEFAULT_POPULATION_PARAMS): void {
        this.state = generatePopulation(seed, params);
    }

    getState(): PopulationState {
        return this.state;
    }

    loadState(state: PopulationState): void {
        this.state = state;
    }

    // Draws a coherent living household for a newly placed house, advancing (and persisting) the draw RNG so
    // reloads reproduce the sequence. Mutates state (placed people, any immigrants).
    drawHousehold(currentTick: number, capacity: number, ticksPerYear: number = DEFAULT_POPULATION_PARAMS.ticksPerYear): HouseholdSelection {
        const rng = new SeededRandom(this.state.drawSeed);
        const selection = selectHousehold(this.state, rng, currentTick, capacity, ticksPerYear);
        this.state.drawSeed = rng.getState();
        return selection;
    }

    // Advances the live population (mortality + births) up to the current tick. Returns what changed so the
    // caller can despawn materialized residents who died.
    simulate(currentTick: number, ticksPerYear: number, params: SimulationParams = DEFAULT_SIMULATION_PARAMS, excludeIds?: Set<PersonId>): SimulationResult {
        return simulatePopulation(this.state, currentTick, ticksPerYear, params, excludeIds);
    }

    getPerson(id: PersonId): GenPerson | null {
        return this.state.people[id] ?? null;
    }

    getPeople(): PersonTable {
        return this.state.people;
    }

    size(): number {
        return Object.keys(this.state.people).length;
    }

    isEmpty(): boolean {
        return this.size() === 0;
    }
}

function sharesParent(a: GenPerson, b: GenPerson): boolean {
    return (a.fatherId !== null && a.fatherId === b.fatherId) || (a.motherId !== null && a.motherId === b.motherId);
}

// Off-map courtship for the OFFLINE GENERATOR ONLY (extinction remedy). The romance arc (090) gates had_sex on
// a partner-or-dating edge and pregnancy on a spouse (`partnerOf`), and marriage on an ENGAGED edge — edges
// that form only through the Brain's social ACTIONS, which the logical world runs far too sparsely for the
// second generation to pair up. Left alone, the pre-married founders reproduce and then age out and the
// population collapses (births ≈ half of deaths). This is the generator's stand-in for the courtship the LIVE
// map simulates in full: each step it marries a bounded, deterministic fraction of compatible unpartnered
// adults — creating the real partnership so pregnancy's `partnerOf` binding resolves and they reproduce via
// the normal Engine-B path. LiveWorld NEVER calls this (real dating/engagement/marriage on the map is
// untouched). `ratePerYear` is the per-single annual marriage hazard; the generator scales it UP as the living
// count falls below target — the population thermostat's intent applied at the REAL bottleneck (pairing, not
// fertility, since boosting a pregnancy hazard gated to zero by a missing spouse does nothing). Deterministic
// given the passed RNG. Returns the number of new marriages formed.
export function pairUnpartneredAdults(
    state: PopulationState,
    livingIds: Iterable<PersonId>,
    tick: number,
    ticksPerYear: number,
    rng: SeededRandom,
    ratePerYear: number,
    stepTicks: number,
    minAgeYears = 18,
    maxAgeYears = 45,
    maxAgeGapYears = 12,
): number {
    if (ratePerYear <= 0 || stepTicks <= 0) {
        return 0;
    }
    const pool = state.people;
    const women: PersonId[] = [];
    const men: PersonId[] = [];
    for (const id of livingIds) {
        const person = pool[id];
        if (!person || !isAliveAt(person, tick)) {
            continue;
        }
        const age = ageAt(person, tick, ticksPerYear);
        if (age < minAgeYears || age > maxAgeYears || spouseAt(pool, id, tick) !== null) {
            continue;
        }
        (person.gender === Genders.Female ? women : men).push(id);
    }
    // Deterministic shuffle so pairing never biases by id order (Fisher–Yates on the passed stream).
    const shuffle = (arr: PersonId[]): void => {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = rng.nextInt(0, i);
            const swap = arr[i]!;
            arr[i] = arr[j]!;
            arr[j] = swap;
        }
    };
    shuffle(women);
    shuffle(men);
    // Per-step marriage probability from the annual hazard (Poisson-honest at any stride — K2).
    const perStep = 1 - Math.exp(-ratePerYear * stepTicks / ticksPerYear);
    const taken = new Set<PersonId>();
    let married = 0;
    for (const womanId of women) {
        if (rng.next() >= perStep) {
            continue; // she isn't pairing this step
        }
        const woman = pool[womanId]!;
        // The nearest-age eligible man not already claimed this step and not a blood relative.
        let best: PersonId | null = null;
        let bestGap = Infinity;
        for (const manId of men) {
            if (taken.has(manId)) {
                continue;
            }
            const man = pool[manId]!;
            const gap = Math.abs(man.birthTick - woman.birthTick) / ticksPerYear;
            if (gap <= maxAgeGapYears && !sharesParent(woman, man) && gap < bestGap) {
                best = manId;
                bestGap = gap;
            }
        }
        if (best === null) {
            continue;
        }
        taken.add(best);
        // Create the coherent partnership directly (the coarse-sim `marry` pattern): `marital` becomes married
        // and pregnancy/had_sex bindings resolve, so the couple reproduces on the normal probabilistic path.
        woman.partnerships.push({ partnerId: best, startTick: tick, endTick: null });
        pool[best]!.partnerships.push({ partnerId: womanId, startTick: tick, endTick: null });
        married++;
    }
    return married;
}
