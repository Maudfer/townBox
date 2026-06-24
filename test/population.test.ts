import { generatePopulation } from '../src/app/game/Population';
import { isAliveAt, ageAt, parentsOf, siblingsOf } from '../src/util/kinship';
import { GenPerson, PopulationParams } from '../src/types/Genealogy';

const PARAMS: PopulationParams = {
    ticksPerYear: 360,
    founderCouples: 40,
    generations: 3,
    childDistribution: [0.05, 0.15, 0.3, 0.3, 0.15, 0.05],
    pairingProbability: 0.82,
    immigrantSpouseProbability: 0.5,
    spouseMaxAgeGapYears: 12,
    parentMinAgeYears: 20,
    parentMaxAgeYears: 42,
    generationGapYears: 31,
    lifespanMeanYears: 78,
    lifespanSpreadYears: 16,
    maxPopulation: 5000,
};

const PRESENT_TICK = 0;

describe('generatePopulation determinism', () => {
    test('the same seed yields an identical population', () => {
        const a = generatePopulation(12345, PARAMS);
        const b = generatePopulation(12345, PARAMS);
        expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    });

    test('different seeds yield different populations', () => {
        const a = generatePopulation(1, PARAMS);
        const b = generatePopulation(2, PARAMS);
        expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b));
    });

    test('records the seed and a draw seed for later household draws', () => {
        const state = generatePopulation(777, PARAMS);
        expect(state.worldSeed).toBe(777);
        expect(typeof state.drawSeed).toBe('number');
    });
});

describe('population invariants', () => {
    const state = generatePopulation(424242, PARAMS);
    const pool = state.people;
    const everyone = Object.values(pool);

    test('produces a non-empty pool within the cap', () => {
        expect(everyone.length).toBeGreaterThan(PARAMS.founderCouples * 2);
        expect(everyone.length).toBeLessThanOrEqual(PARAMS.maxPopulation);
    });

    test('every referenced parent exists and predates the child (acyclic by birth order)', () => {
        for (const person of everyone) {
            for (const parentId of [person.fatherId, person.motherId]) {
                if (parentId === null) {
                    continue;
                }
                const parent = pool[parentId];
                expect(parent).toBeDefined();
                expect(parent!.birthTick).toBeLessThan(person.birthTick);
            }
        }
    });

    test('every child is born while both parents are alive', () => {
        for (const person of everyone) {
            const parents = parentsOf(pool, person.id).map(id => pool[id]!);
            for (const parent of parents) {
                expect(isAliveAt(parent, person.birthTick)).toBe(true);
            }
        }
    });

    test('partnerships are symmetric with matching ticks', () => {
        for (const person of everyone) {
            for (const partnership of person.partnerships) {
                const partner = pool[partnership.partnerId];
                expect(partner).toBeDefined();
                const back = partner!.partnerships.find(p => p.partnerId === person.id);
                expect(back).toBeDefined();
                expect(back!.startTick).toBe(partnership.startTick);
                expect(back!.endTick).toBe(partnership.endTick);
            }
        }
    });

    test('contains both living people and deceased ancestors', () => {
        const living = everyone.filter(p => isAliveAt(p, PRESENT_TICK));
        const deceased = everyone.filter(p => p.deathTick !== null);
        expect(living.length).toBeGreaterThan(0);
        expect(deceased.length).toBeGreaterThan(0);
    });

    test('living people have plausible ages', () => {
        const living = everyone.filter(p => isAliveAt(p, PRESENT_TICK));
        for (const person of living) {
            const age = ageAt(person, PRESENT_TICK, PARAMS.ticksPerYear);
            expect(age).toBeGreaterThanOrEqual(0);
            expect(age).toBeLessThanOrEqual(130);
        }
    });

    test('derived kinship works over the generated graph', () => {
        const withParents = everyone.find((p: GenPerson) => parentsOf(pool, p.id).length === 2);
        expect(withParents).toBeDefined();
        // Siblings (if any) must share a parent and exclude self.
        for (const siblingId of siblingsOf(pool, withParents!.id)) {
            expect(siblingId).not.toBe(withParents!.id);
            const sibling = pool[siblingId]!;
            const sharesParent =
                (sibling.fatherId !== null && sibling.fatherId === withParents!.fatherId) ||
                (sibling.motherId !== null && sibling.motherId === withParents!.motherId);
            expect(sharesParent).toBe(true);
        }
    });
});
