// Deterministic contextual object generation (task 070): fills a newly placed building with plausible
// Object Instances from the placement-tag intersection (069). Runs ONCE per building at placement (and once
// per pre-existing building via the load sweep); the results live in the save thereafter — never
// regenerated on load. Deterministic per (worldSeed, anchorKey, generation index): the same lot with the
// same seed always fills identically, and a re-occupied lot (037) draws a FRESH fill (its dead
// predecessor's shelves don't haunt the new business).
//
// Algorithm (069's contract): resolve the building's tags → candidates = archetypes whose `placement`
// intersects → guaranteed minimums first (minPerBuilding — the essentials: every kitchen gets its stove),
// then weighted seeded draws honoring maxPerBuilding/uniquePerBuilding up to the per-building cap.
// Ownership: authored 'building' resolves to business ownership inside a business and building ownership in
// a house; 'none' marks free-to-take loose items. Containment is always the building's location key.

import Inventory from 'game/objects/Inventory';
import objectGenerationConfig from 'json/objectGeneration.json';
import { ObjectArchetype, ObjectOwner } from 'types/Objects';
import { SeededRandom, hashStringToSeed } from 'util/random';

export interface ObjectGenerationParams {
    perBuildingCap: number;
    densityMultiplier: number;
}

export const DEFAULT_OBJECT_GENERATION_PARAMS = objectGenerationConfig as ObjectGenerationParams;

const GENERATION_SALT = 0x0b9;

export interface BuildingFillSpec {
    anchorKey: string; // the building's anchor ("row-col")
    tags: readonly string[]; // the building's placement tags (blueprint/residence)
    host: 'house' | 'business';
    worldSeed: number;
    generationIndex?: number; // re-occupancy count (037): fresh fills per occupant
    tick: number;
}

export function generateBuildingObjects(
    spec: BuildingFillSpec,
    inventory: Inventory,
    params: ObjectGenerationParams = DEFAULT_OBJECT_GENERATION_PARAMS
): number {
    const tagSet = new Set(spec.tags);
    const manifest = inventory.getArchetypes() as Record<string, ObjectArchetype>;
    const candidates = Object.entries(manifest)
        .filter(([, archetype]) => (archetype.placement ?? []).some(tag => tagSet.has(tag)) && archetype.generation)
        .sort((a, b) => a[0].localeCompare(b[0]));
    if (candidates.length === 0) {
        return 0;
    }

    const seedKey = spec.generationIndex ? `objgen:${spec.anchorKey}#${spec.generationIndex}` : `objgen:${spec.anchorKey}`;
    const rng = new SeededRandom((spec.worldSeed ^ hashStringToSeed(seedKey)) >>> 0).fork(GENERATION_SALT);

    const owner = (archetype: ObjectArchetype): ObjectOwner => {
        if ((archetype.generation?.ownershipDefault ?? 'building') === 'none') {
            return { kind: 'none' };
        }
        return spec.host === 'business' ? { kind: 'business', key: spec.anchorKey } : { kind: 'building', key: spec.anchorKey };
    };
    const container = { kind: 'location' as const, key: `building:${spec.anchorKey}` };

    let created = 0;
    const cap = Math.max(0, Math.floor(params.perBuildingCap * params.densityMultiplier));
    const place = (archetypeId: string, archetype: ObjectArchetype): void => {
        inventory.createInstance({ archetypeId, owner: owner(archetype), container, tick: spec.tick });
        created++;
    };

    // Pass 1 — guaranteed minimums (the essentials).
    const countsByArchetype = new Map<string, number>();
    for (const [archetypeId, archetype] of candidates) {
        const min = archetype.generation?.minPerBuilding ?? 0;
        for (let index = 0; index < min && created < cap; index++) {
            place(archetypeId, archetype);
            countsByArchetype.set(archetypeId, (countsByArchetype.get(archetypeId) ?? 0) + 1);
        }
    }

    // Pass 2 — weighted draws up to the cap, honoring per-archetype maximums/uniqueness.
    const pool = candidates
        .map(([archetypeId, archetype]) => ({ archetypeId, archetype, weight: archetype.generation?.weight ?? 1 }))
        .filter(entry => entry.weight > 0);
    while (created < cap && pool.length > 0) {
        const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
        let roll = rng.next() * total;
        let index = pool.length - 1;
        for (let i = 0; i < pool.length; i++) {
            roll -= pool[i]!.weight;
            if (roll <= 0) {
                index = i;
                break;
            }
        }
        const picked = pool[index]!;
        const generation = picked.archetype.generation!;
        const max = generation.uniquePerBuilding ? 1 : (generation.maxPerBuilding ?? 1);
        const have = countsByArchetype.get(picked.archetypeId) ?? 0;
        if (have < max) {
            place(picked.archetypeId, picked.archetype);
            countsByArchetype.set(picked.archetypeId, have + 1);
        }
        if ((countsByArchetype.get(picked.archetypeId) ?? 0) >= max) {
            pool.splice(index, 1); // exhausted — deterministic removal keeps the stream aligned
        }
    }
    return created;
}
