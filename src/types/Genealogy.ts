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
// reloading reproduces subsequent household draws (see SeededRandom.getState/setState).
export interface PopulationState {
    worldSeed: number;
    people: PersonTable;
    drawSeed: number;
}
