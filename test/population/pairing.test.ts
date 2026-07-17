import { pairUnpartneredAdults } from 'game/population/Population';
import { Genders } from 'types/Social';
import { GenPerson, PersonId, PopulationState } from 'types/Genealogy';
import { spouseAt } from 'util/kinship';
import { SeededRandom } from 'util/random';

// pairUnpartneredAdults (task 119): the OFFLINE-GENERATOR-ONLY off-map courtship that keeps the deep-sim
// population from collapsing. The romance arc (090) gates pregnancy on a real spouse edge that only forms via
// Brain social actions (too sparse off-map), so the generator marries a bounded, deterministic fraction of
// compatible unpartnered adults each step. These tests pin the eligibility rules + determinism directly.

const TPY = 8640;

function makePerson(id: PersonId, gender: GenPerson['gender'], ageYears: number, tick = 0): GenPerson {
    return {
        id,
        firstName: id,
        familyName: 'Test',
        gender,
        birthTick: tick - Math.round(ageYears * TPY),
        deathTick: null,
        fatherId: null,
        motherId: null,
        partnerships: [],
    };
}

function stateOf(people: GenPerson[]): PopulationState {
    const table: Record<PersonId, GenPerson> = {};
    for (const p of people) {
        table[p.id] = p;
    }
    return { worldSeed: 1, people: table, drawSeed: 1, placedIds: [], nextSeq: people.length, lastSimulatedYear: 0 };
}

// A rate high enough that perStep ≈ 1, so every eligible woman attempts to pair (removes hazard-roll noise).
const CERTAIN_RATE = 5000;

describe('pairUnpartneredAdults', () => {
    test('rate <= 0 is a no-op (returns 0, forms no partnership)', () => {
        const state = stateOf([makePerson('w', Genders.Female, 25), makePerson('m', Genders.Male, 27)]);
        const rng = new SeededRandom(1);
        expect(pairUnpartneredAdults(state, ['w', 'm'], 0, TPY, rng, 0, TPY)).toBe(0);
        expect(state.people['w']!.partnerships).toHaveLength(0);
    });

    test('marries a compatible unpartnered man and woman (both sides get the edge)', () => {
        const state = stateOf([makePerson('w', Genders.Female, 25), makePerson('m', Genders.Male, 27)]);
        const rng = new SeededRandom(7);
        const married = pairUnpartneredAdults(state, ['w', 'm'], 0, TPY, rng, CERTAIN_RATE, TPY);
        expect(married).toBe(1);
        expect(spouseAt(state.people, 'w', 0)).toBe('m');
        expect(spouseAt(state.people, 'm', 0)).toBe('w');
    });

    test('picks the nearest-age eligible man', () => {
        const state = stateOf([
            makePerson('w', Genders.Female, 30),
            makePerson('close', Genders.Male, 31), // gap 1
            makePerson('far', Genders.Male, 40), // gap 10
        ]);
        const rng = new SeededRandom(3);
        pairUnpartneredAdults(state, ['w', 'close', 'far'], 0, TPY, rng, CERTAIN_RATE, TPY);
        expect(spouseAt(state.people, 'w', 0)).toBe('close');
    });

    test('never pairs blood siblings (shared parent)', () => {
        const w = makePerson('w', Genders.Female, 25);
        const brother = makePerson('b', Genders.Male, 27);
        w.fatherId = 'dad';
        brother.fatherId = 'dad';
        const state = stateOf([w, brother]);
        const rng = new SeededRandom(9);
        expect(pairUnpartneredAdults(state, ['w', 'b'], 0, TPY, rng, CERTAIN_RATE, TPY)).toBe(0);
    });

    test('excludes people outside the [18,45] adult band', () => {
        const state = stateOf([
            makePerson('teen', Genders.Female, 16),
            makePerson('elder', Genders.Female, 50),
            makePerson('m', Genders.Male, 30),
        ]);
        const rng = new SeededRandom(2);
        expect(pairUnpartneredAdults(state, ['teen', 'elder', 'm'], 0, TPY, rng, CERTAIN_RATE, TPY)).toBe(0);
    });

    test('excludes pairs whose age gap exceeds the maximum', () => {
        const state = stateOf([makePerson('w', Genders.Female, 20), makePerson('m', Genders.Male, 44)]); // gap 24
        const rng = new SeededRandom(4);
        expect(pairUnpartneredAdults(state, ['w', 'm'], 0, TPY, rng, CERTAIN_RATE, TPY)).toBe(0);
    });

    test('skips already-partnered adults', () => {
        const w = makePerson('w', Genders.Female, 25);
        const m = makePerson('m', Genders.Male, 27);
        const spouse = makePerson('spouse', Genders.Male, 28);
        w.partnerships.push({ partnerId: 'spouse', startTick: -100, endTick: null });
        spouse.partnerships.push({ partnerId: 'w', startTick: -100, endTick: null });
        const state = stateOf([w, m, spouse]);
        const rng = new SeededRandom(5);
        // Only w is already married; m is single but has no other eligible woman, so nothing forms.
        expect(pairUnpartneredAdults(state, ['w', 'm', 'spouse'], 0, TPY, rng, CERTAIN_RATE, TPY)).toBe(0);
    });

    test('is deterministic given the same seed', () => {
        // Two identical runs on identically-seeded RNG produce the same pairing outcome.
        const build = (): PopulationState => stateOf([
            makePerson('w1', Genders.Female, 25),
            makePerson('w2', Genders.Female, 33),
            makePerson('m1', Genders.Male, 26),
            makePerson('m2', Genders.Male, 34),
        ]);
        const ids = ['w1', 'w2', 'm1', 'm2'];
        const s1 = build();
        const s2 = build();
        const n1 = pairUnpartneredAdults(s1, ids, 0, TPY, new SeededRandom(42), CERTAIN_RATE, TPY);
        const n2 = pairUnpartneredAdults(s2, ids, 0, TPY, new SeededRandom(42), CERTAIN_RATE, TPY);
        expect(n1).toBe(n2);
        expect(spouseAt(s1.people, 'w1', 0)).toBe(spouseAt(s2.people, 'w1', 0));
    });
});
