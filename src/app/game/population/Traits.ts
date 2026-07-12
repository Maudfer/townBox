// The traits service (task 087 / proposal M1): per-person temperament axes, derived — never stored. An axis
// is a deterministic blend of the person's own seeded roll and their parents' BASE rolls (one generation of
// heritability: family temperaments correlate without unbounded recursion up the genealogy). Pure function
// of (worldSeed, personId, parent ids), so asset people, newborns, and legacy saves all have traits with no
// migration; a memo caches per person (traits are effectively immutable).

import traitsConfig from 'json/traits.json';
import { PersonId, PersonTable } from 'types/Genealogy';
import { PersonTraits, TRAIT_IDS, TraitsConfig, TraitsReader } from 'types/Traits';
import { SeededRandom, hashStringToSeed } from 'util/random';

export const TRAITS_CONFIG = traitsConfig as unknown as TraitsConfig;

const TRAITS_SALT = 0x7a17;

// The person's own seeded roll for every axis — the heritability blend's raw material.
function baseTraits(worldSeed: number, personId: PersonId): PersonTraits {
    const rng = new SeededRandom(worldSeed).fork(TRAITS_SALT).fork(hashStringToSeed(personId));
    const traits = {} as PersonTraits;
    for (const trait of TRAIT_IDS) {
        traits[trait] = rng.next() * 100;
    }
    return traits;
}

export default class Traits implements TraitsReader {
    // A PROVIDER rather than captured state: the pool object is replaced on load/new-game, and a stale
    // reference would silently derive against the old world. `reset()` drops the memo on those transitions.
    private source: () => { worldSeed: number; people: PersonTable };
    private config: TraitsConfig;
    private memo = new Map<PersonId, PersonTraits>();

    constructor(source: () => { worldSeed: number; people: PersonTable }, config: TraitsConfig = TRAITS_CONFIG) {
        this.source = source;
        this.config = config;
    }

    // Drops the memo (call after a load or a new-game world selection).
    reset(): void {
        this.memo.clear();
    }

    traitsOf(personId: PersonId): PersonTraits {
        const cached = this.memo.get(personId);
        if (cached) {
            return cached;
        }
        const { worldSeed, people } = this.source();
        const own = baseTraits(worldSeed, personId);
        const record = people[personId];
        const parents = [record?.fatherId, record?.motherId].filter((id): id is PersonId => !!id && !!people[id]);
        let traits = own;
        if (parents.length > 0) {
            const h = this.config.heritability;
            traits = {} as PersonTraits;
            for (const trait of TRAIT_IDS) {
                const parentAverage = parents.reduce((sum, id) => sum + baseTraits(worldSeed, id)[trait], 0) / parents.length;
                traits[trait] = parentAverage * h + own[trait] * (1 - h);
            }
        }
        this.memo.set(personId, traits);
        return traits;
    }

    // The selection multiplier for an action's affinity tags: each tag reads its axis and scales the weight
    // within [1 − 0.4·|w|, 1 + 0.4·|w|] — a strong-affinity action roughly ±40% by temperament. Tags
    // multiply; unknown tags are inert (the validator rejects them in shipped data).
    affinityMultiplier(personId: PersonId, affinity: string[] | undefined): number {
        if (!affinity || affinity.length === 0) {
            return 1;
        }
        const traits = this.traitsOf(personId);
        let multiplier = 1;
        for (const tag of affinity) {
            const mapping = this.config.affinities[tag];
            if (!mapping) {
                continue;
            }
            const value = traits[mapping.axis]; // 0–100
            const centered = (value - 50) / 50; // −1 … 1
            multiplier *= 1 + 0.4 * mapping.weight * centered;
        }
        return Math.max(0.1, multiplier);
    }

    // Inspector prose (M3): the axes past their bands, as authored phrases ("quick-tempered, loves company").
    describe(personId: PersonId): string {
        const traits = this.traitsOf(personId);
        const phrases: string[] = [];
        for (const trait of TRAIT_IDS) {
            const spec = this.config.phrases[trait];
            if (traits[trait] >= 100 - spec.band) {
                phrases.push(spec.high);
            } else if (traits[trait] <= spec.band) {
                phrases.push(spec.low);
            }
        }
        return phrases.join(', ');
    }

    // Rare authored nudges (M1: "people are shaped, not rewritten") would land here as a capped overlay;
    // deliberately absent this iteration — the derivation stays pure.
}

// One consent shift shared by the evaluator (M2): the TARGET's temperament nudges acceptance.
export function traitConsentShift(traits: PersonTraits, config: TraitsConfig = TRAITS_CONFIG): number {
    return traits.sociability * config.consent.sociabilityWeight + traits.temper * config.consent.temperWeight;
}
