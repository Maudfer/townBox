// Pets (task 103 / proposal N): lightweight companions — records, not Persons. No Brain, no needs of their
// own this iteration; they exist through their owner's behavior (adoption at the pet shop, care routines,
// dog walks) and land a REAL mood impulse when they die. Deliberately restrained; serialized (v16 family).

import { PersonId } from 'types/Genealogy';

export interface PetRecord {
    id: number;
    species: string;
    name: string;
    ownerId: PersonId;
    birthTick: number;
}

export interface PetsState {
    nextId: number;
    pets: PetRecord[];
}

export interface PetSpeciesSpec {
    weight: number; // adoption draw weight
    lifespanYears: number;
    event: string; // the species texture event the adoption fires (C2-wired, no longer free-rolling)
}

export interface PetsConfig {
    maxPerOwner: number;
    species: Record<string, PetSpeciesSpec>;
}

// The surface the engine consults through SimulationMarkets.pets (the petCount context attribute).
export interface PetsReader {
    countOf(ownerId: PersonId): number;
}
