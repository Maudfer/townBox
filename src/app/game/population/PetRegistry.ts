// The pet registry (task 103 / proposal N): who owns which companion. Lightweight, serialized (v16
// family), deterministic, RNG-free — adoption draws and lifespan rolls happen in City. An owner's death
// removes their pets (rehomed off-screen; a pet with no one is not simulated).

import petsConfig from 'json/pets.json';
import { PersonId } from 'types/Genealogy';
import { PetRecord, PetsConfig, PetsReader, PetsState } from 'types/Pets';

export const PETS_CONFIG = petsConfig as unknown as PetsConfig;

export default class PetRegistry implements PetsReader {
    private state: PetsState;

    constructor() {
        this.state = { nextId: 1, pets: [] };
    }

    adopt(ownerId: PersonId, species: string, name: string, birthTick: number): PetRecord {
        const record: PetRecord = { id: this.state.nextId, species, name, ownerId, birthTick };
        this.state.nextId += 1;
        this.state.pets.push(record);
        return record;
    }

    countOf(ownerId: PersonId): number {
        return this.state.pets.filter(pet => pet.ownerId === ownerId).length;
    }

    petsOf(ownerId: PersonId): PetRecord[] {
        return this.state.pets.filter(pet => pet.ownerId === ownerId);
    }

    all(): PetRecord[] {
        return [...this.state.pets];
    }

    removePet(id: number): void {
        this.state.pets = this.state.pets.filter(pet => pet.id !== id);
    }

    removeOwner(ownerId: PersonId): void {
        this.state.pets = this.state.pets.filter(pet => pet.ownerId !== ownerId);
    }

    serialize(): PetsState {
        return { nextId: this.state.nextId, pets: this.state.pets.map(pet => ({ ...pet })) };
    }

    loadState(state: PetsState | undefined): void {
        this.state = state
            ? { nextId: state.nextId, pets: state.pets.map(pet => ({ ...pet })) }
            : { nextId: 1, pets: [] };
    }
}
