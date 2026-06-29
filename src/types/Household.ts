import { PersonId } from 'types/Genealogy';

// A household is a *living arrangement* — who co-resides in a placed House and why — kept distinct from
// blood/marriage relations (the genealogy). This separation is what lets the model express arrangements
// the old single-family system could not: roommates, a child living with an adult sibling because the
// parents are deceased, single occupants, multi-generational homes, etc.
// See docs/tasks/004-household-generation-redesign_DONE.md.

export type HouseholdId = string;

export enum HouseholdArrangements {
    Nuclear = 'nuclear', // a couple and/or their minor children
    Single = 'single', // one occupant
    Siblings = 'siblings', // adult siblings sharing a home
    Guardianship = 'guardianship', // a minor living with an adult relative (e.g. parents deceased)
    Roommates = 'roommates', // unrelated co-residents
    Multigen = 'multigen', // nuclear plus a grandparent
    Homeless = 'homeless', // evicted household with no home, awaiting re-housing (task 022)
}

export type HouseholdArrangement = HouseholdArrangements;

export interface Household {
    id: HouseholdId;
    houseKey: string; // House anchor "row-col" (matches the addressing used by types/Save.ts)
    headId: PersonId; // primary reference person the draw was built around
    memberIds: PersonId[]; // currently-living residents
    arrangement: HouseholdArrangement;
    arrears?: number; // consecutive months the household could not cover its cost of living (task 019 → 022)
}

// Tunable inputs to the household draw (src/json/householdDraw.json).
export interface DrawParams {
    adultAgeYears: number;
    maxRoommates: number;
    // Drawable arrangements only — Homeless is reached solely via eviction (task 022), never drawn.
    arrangementWeights: Partial<Record<HouseholdArrangement, number>>;
}
