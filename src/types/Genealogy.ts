import { Gender } from 'types/Social';

// The genealogy is the source of truth for people: a flat, serializable population of individuals across
// many generations (mostly deceased ancestors plus a living cohort). It is pure data with no Phaser/React
// references — game/Person instances are materialized views onto these records (referenced by PersonId).
// See docs/tasks/004-household-generation-redesign.md.

export type PersonId = string;

// A marriage/cohabitation episode. A person can have several over a lifetime (re-marriage, widowhood).
// `endTick === null` means the partnership is ongoing.
export interface Partnership {
    partnerId: PersonId;
    startTick: number;
    endTick: number | null;
}

// A single individual. Only primary, factual edges are stored (parents, partnerships, birth/death);
// all other kinship (siblings, grandparents, uncles/aunts, nieces/nephews, cousins) is DERIVED from the
// parent graph (see util/kinship.ts) rather than stored redundantly. `age` is intentionally absent — it
// is derived from `birthTick` against the current clock tick.
export interface GenPerson {
    id: PersonId;
    firstName: string;
    familyName: string; // birth surname; partnerships do not mutate the record
    gender: Gender;
    birthTick: number;
    deathTick: number | null; // null = alive
    fatherId: PersonId | null;
    motherId: PersonId | null;
    partnerships: Partnership[];
}

// The population keyed by id, for O(1) lookup and JSON serialization.
export type PersonTable = Record<PersonId, GenPerson>;

// The full, serializable population state. `drawSeed` is the placement-draw RNG state that must persist so
// reloading reproduces subsequent household draws (see SeededRandom.getState/setState). `placedIds` is the
// set of people already bound to a household (so a later draw never reuses them); `nextSeq` is the next id
// suffix for people added after generation (immigrants on pool exhaustion).
export interface PopulationState {
    worldSeed: number;
    people: PersonTable;
    drawSeed: number;
    placedIds: PersonId[];
    nextSeq: number;
    lastSimulatedYear: number; // highest in-game year the life simulation has applied
}

// Tunable inputs to the live life-event simulation (src/json/lifeSimulation.json). Mortality is a
// Gompertz curve: annual death probability = mortalityBase * exp(mortalityGrowth * ageYears), clamped.
export interface SimulationParams {
    mortalityBase: number;
    mortalityGrowth: number;
    maxMortality: number; // clamp on annual death probability
    maxAgeYears: number; // hard cap: nobody outlives this
    annualBirthProbability: number; // per fertile couple per year
    fertileMinAgeYears: number;
    fertileMaxAgeYears: number;
    maxCatchUpYears: number; // bound on years simulated in one call (e.g. after a big load jump)
}

// What one simulation pass changed, so callers can reconcile materialized residents.
export interface SimulationResult {
    died: PersonId[];
    born: PersonId[];
}

// Tunable inputs to the deterministic pool generator (src/json/population.json). All time spans are in
// years and converted to ticks via `ticksPerYear` (the canonical genealogy tick = one in-game day; see
// docs/tasks/005-clock-and-calendar-system.md Requirement 8). The generator anchors the present at tick 0,
// so ancestors carry negative birthTicks.
export interface PopulationParams {
    ticksPerYear: number;
    founderCouples: number;
    generations: number;
    childDistribution: number[]; // probability weights for 0, 1, 2, … children per couple
    pairingProbability: number; // chance an eligible adult seeks a partner each generation
    immigrantSpouseProbability: number; // chance an unpaired adult gets a fresh (parentless) spouse
    spouseMaxAgeGapYears: number;
    parentMinAgeYears: number;
    parentMaxAgeYears: number;
    generationGapYears: number; // average parent age at a child's birth; anchors founder birth dates
    lifespanMeanYears: number;
    lifespanSpreadYears: number;
    maxPopulation: number; // hard cap so generation always terminates
}
