// Per-person fertility willingness (task: bounded, non-exponential population). Every person carries an innate
// `maxChildren` — the number of children they are WILLING to have — sampled at creation from a fixed
// distribution that mounds on 2–4 (~70%) with 0 and 6 at the tails. This caps per-couple births regardless of
// probability, so population growth is bounded rather than purely exponential. Combined with the global
// fertility multiplier (EventEngine.setProbabilityScale) and the offline generator's population thermostat,
// it lets a run hold a stable target instead of ballooning.

import { SeededRandom, hashStringToSeed } from 'util/random';

// P(maxChildren = index) for index 0..6. Sums to 1; the 2–4 band is ~70%. A discretized bell favouring small
// families with rare childless (0) and large (6) tails — closer to real distributions than a flat rate.
export const DEFAULT_CHILDREN_WILLINGNESS: readonly number[] = [0.04, 0.10, 0.24, 0.24, 0.22, 0.10, 0.06];

// Samples a maximum-children value from the willingness distribution using the given RNG stream.
export function sampleMaxChildren(rng: SeededRandom, weights: readonly number[] = DEFAULT_CHILDREN_WILLINGNESS): number {
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

// Deterministic maxChildren for a person from (worldSeed, personId) — used to backfill legacy saves that
// predate the field, so the same person always gets the same innate value.
export function maxChildrenForPerson(worldSeed: number, personId: string, weights: readonly number[] = DEFAULT_CHILDREN_WILLINGNESS): number {
    return sampleMaxChildren(new SeededRandom((worldSeed ^ hashStringToSeed(personId)) >>> 0), weights);
}
