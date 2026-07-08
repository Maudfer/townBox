// Bounded fertility (task: non-exponential population). Per-person innate maxChildren caps births; the
// distribution mounds on 2–4; and both the coarse off-map sim and (via wantsMoreChildren) the event engine
// respect the cap.

import { sampleMaxChildren, maxChildrenForPerson, DEFAULT_CHILDREN_WILLINGNESS } from '../src/util/fertility';
import { SeededRandom } from '../src/util/random';
import { simulatePopulation, DEFAULT_SIMULATION_PARAMS } from '../src/app/game/Population';
import { childrenOf } from '../src/util/kinship';
import { PopulationState } from '../src/types/Genealogy';
import { Genders } from '../src/types/Social';
import { TICKS_PER_YEAR } from '../src/util/time';

describe('sampleMaxChildren distribution', () => {
    test('mounds on 2–4 (~70%), stays within 0..6', () => {
        const rng = new SeededRandom(12345);
        const counts = new Array(DEFAULT_CHILDREN_WILLINGNESS.length).fill(0);
        const N = 20000;
        for (let i = 0; i < N; i++) {
            const value = sampleMaxChildren(rng);
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(6);
            counts[value]++;
        }
        const share24 = (counts[2] + counts[3] + counts[4]) / N;
        expect(share24).toBeGreaterThan(0.63);
        expect(share24).toBeLessThan(0.77);
    });

    test('maxChildrenForPerson is deterministic per (worldSeed, personId)', () => {
        expect(maxChildrenForPerson(99, 'p42')).toBe(maxChildrenForPerson(99, 'p42'));
    });
});

describe('coarse off-map sim respects maxChildren', () => {
    function marriedCouple(womanMax: number): PopulationState {
        const marry = { startTick: -5 * TICKS_PER_YEAR, endTick: null };
        return {
            worldSeed: 7,
            people: {
                m: { id: 'm', firstName: 'M', familyName: 'F', gender: Genders.Male, birthTick: -32 * TICKS_PER_YEAR, deathTick: null, fatherId: null, motherId: null, partnerships: [{ partnerId: 'w', ...marry }] },
                w: { id: 'w', firstName: 'W', familyName: 'F', gender: Genders.Female, birthTick: -26 * TICKS_PER_YEAR, deathTick: null, fatherId: null, motherId: null, partnerships: [{ partnerId: 'm', ...marry }], maxChildren: womanMax },
            },
            drawSeed: 0, placedIds: [], nextSeq: 0, lastSimulatedYear: 0,
        };
    }

    test('maxChildren = 0 → the couple never has children', () => {
        const state = marriedCouple(0);
        // Simulate ~15 fertile years.
        simulatePopulation(state, 15 * TICKS_PER_YEAR, TICKS_PER_YEAR, DEFAULT_SIMULATION_PARAMS);
        expect(childrenOf(state.people, 'w').length).toBe(0);
    });

    test('maxChildren = 2 → births never exceed the cap', () => {
        const state = marriedCouple(2);
        simulatePopulation(state, 15 * TICKS_PER_YEAR, TICKS_PER_YEAR, DEFAULT_SIMULATION_PARAMS);
        expect(childrenOf(state.people, 'w').length).toBeLessThanOrEqual(2);
    });
});
