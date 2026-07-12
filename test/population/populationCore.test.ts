import Population, {
    createFounders,
    DEFAULT_FOUNDER_PARAMS,
    FounderParams,
    generatePopulation,
    simulatePopulation,
} from 'game/population/Population';
import { PopulationParams } from 'types/Genealogy';
import { isAliveAt, ageAt } from 'util/kinship';

const TPY = 360;

const PARAMS: PopulationParams = {
    ticksPerYear: TPY,
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

// --- createFounders (task 055 Phase 0): the offline history generator's ONLY seed primitive — it breeds
// forward from these founders itself, so this pure function never runs the coarse descendant generation. ---
describe('createFounders', () => {
    test('the same seed yields an identical founder set', () => {
        const a = createFounders(11, 20);
        const b = createFounders(11, 20);
        expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    });

    test('different seeds yield different founder sets', () => {
        const a = createFounders(11, 20);
        const b = createFounders(12, 20);
        expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b));
    });

    test('creates floor(count/2) married couples, one male + one female each', () => {
        // An odd count leaves a remainder person uncreated (floor(5/2) = 2 couples = 4 people).
        const state = createFounders(5, 5);
        const everyone = Object.values(state.people);
        expect(everyone).toHaveLength(4);
        expect(state.nextSeq).toBe(4);

        const males = everyone.filter(p => p.gender === 'male');
        const females = everyone.filter(p => p.gender === 'female');
        expect(males).toHaveLength(2);
        expect(females).toHaveLength(2);
    });

    test('count <= 0 produces an empty, well-formed population', () => {
        const state = createFounders(1, 0);
        expect(Object.keys(state.people)).toHaveLength(0);
        expect(state.nextSeq).toBe(0);
        expect(state.worldSeed).toBe(1);
        expect(state.lastSimulatedYear).toBe(0);
        expect(state.placedIds).toEqual([]);

        // Negative counts clamp to zero rather than throwing.
        const negative = createFounders(1, -10);
        expect(Object.keys(negative.people)).toHaveLength(0);
    });

    test('founders are adults within the configured age band and already married', () => {
        const params: FounderParams = { ...DEFAULT_FOUNDER_PARAMS, minFounderAgeYears: 20, maxFounderAgeYears: 35, spouseMaxAgeGapYears: 12 };
        const state = createFounders(999, 60, params);
        const everyone = Object.values(state.people);

        for (const founder of everyone) {
            // Ages are derived against tick 0, the present epoch. Husbands are sampled directly within
            // [min, max]; wives are offset from the husband's age by up to spouseMaxAgeGapYears in either
            // direction, so their age band is wider by that gap on both ends.
            const age = ageAt(founder, 0, params.ticksPerYear);
            expect(age).toBeGreaterThanOrEqual(params.minFounderAgeYears - params.spouseMaxAgeGapYears);
            expect(age).toBeLessThanOrEqual(params.maxFounderAgeYears + params.spouseMaxAgeGapYears);
            expect(isAliveAt(founder, 0)).toBe(true);

            expect(founder.partnerships).toHaveLength(1);
            const partner = state.people[founder.partnerships[0]!.partnerId];
            expect(partner).toBeDefined();
            expect(founder.partnerships[0]!.endTick).toBeNull();
            // Partnerships are symmetric.
            const back = partner!.partnerships.find(p => p.partnerId === founder.id);
            expect(back).toBeDefined();
            expect(back!.startTick).toBe(founder.partnerships[0]!.startTick);
        }
    });

    test('records a usable drawSeed for subsequent household draws', () => {
        const state = createFounders(42, 10);
        expect(typeof state.drawSeed).toBe('number');
    });
});

describe('generatePopulation — population cap boundary', () => {
    test('never exceeds maxPopulation even when it is hit mid-generation', () => {
        // A tight cap reached partway through founder creation (odd cap so the break can land right after a
        // husband is created, before his wife) and again during descendant births — exercises the atCap()
        // guards throughout generatePopulation without crashing or overshooting.
        const tightParams: PopulationParams = { ...PARAMS, founderCouples: 20, generations: 2, maxPopulation: 7 };
        const state = generatePopulation(31, tightParams);

        expect(Object.keys(state.people)).toHaveLength(state.nextSeq);
        expect(state.nextSeq).toBeLessThanOrEqual(tightParams.maxPopulation);
        // The pool generated is still internally consistent (no dangling parent refs, etc. — mirrors the
        // broader invariants in test/population/population.test.ts).
        for (const person of Object.values(state.people)) {
            for (const parentId of [person.fatherId, person.motherId]) {
                if (parentId !== null) {
                    expect(state.people[parentId]).toBeDefined();
                }
            }
        }
    });
});

describe('simulatePopulation — degenerate ticksPerYear', () => {
    test('is a no-op when ticksPerYear is zero or negative (avoids a division by zero)', () => {
        const state = generatePopulation(8, PARAMS);
        const before = JSON.stringify(state);

        const resultZero = simulatePopulation(state, 100, 0);
        expect(resultZero).toEqual({ died: [], born: [] });
        expect(JSON.stringify(state)).toBe(before);

        const resultNegative = simulatePopulation(state, 100, -5);
        expect(resultNegative).toEqual({ died: [], born: [] });
        expect(JSON.stringify(state)).toBe(before);
    });
});

// --- Population: the live wrapper around generatePopulation/simulatePopulation/selectHousehold, holding
// the state that gets serialized into a save (game/save/SaveManager.ts). ---
describe('Population (class wrapper)', () => {
    test('constructs an empty, well-formed state by default', () => {
        const population = new Population();
        expect(population.isEmpty()).toBe(true);
        expect(population.size()).toBe(0);
        expect(population.getPeople()).toEqual({});
        expect(population.getPerson('nobody')).toBeNull();
    });

    test('generate() populates state identically to the pure generatePopulation function', () => {
        const population = new Population();
        population.generate(555, PARAMS);

        const expected = generatePopulation(555, PARAMS);
        expect(population.getState()).toEqual(expected);
        expect(population.isEmpty()).toBe(false);
        expect(population.size()).toBe(Object.keys(expected.people).length);
    });

    test('getPerson resolves a living pool member by id', () => {
        const population = new Population();
        population.generate(555, PARAMS);
        const anyId = Object.keys(population.getPeople())[0]!;
        expect(population.getPerson(anyId)).toEqual(population.getPeople()[anyId]);
    });

    test('loadState replaces the held state wholesale', () => {
        const population = new Population();
        const state = generatePopulation(2, PARAMS);
        population.loadState(state);
        expect(population.getState()).toBe(state);
        expect(population.size()).toBe(Object.keys(state.people).length);
    });

    test('drawHousehold draws a household and persists the advanced draw RNG state', () => {
        const population = new Population();
        population.generate(321, PARAMS);
        const seedBefore = population.getState().drawSeed;

        const selection = population.drawHousehold(0, 4, TPY);

        expect(selection.memberIds.length).toBeGreaterThan(0);
        expect(selection.memberIds.length).toBeLessThanOrEqual(4);
        // The draw RNG advanced and was written back, so a reload resumes the same sequence (not repeats it).
        expect(population.getState().drawSeed).not.toBe(seedBefore);
        // Selected members are recorded placed so a subsequent draw never reuses them.
        expect(population.getState().placedIds).toEqual(expect.arrayContaining(selection.memberIds));
    });

    test('successive drawHousehold calls never reuse a member', () => {
        const population = new Population();
        population.generate(321, PARAMS);

        const seen = new Set<string>();
        for (let i = 0; i < 10; i++) {
            const selection = population.drawHousehold(0, 4, TPY);
            for (const id of selection.memberIds) {
                expect(seen.has(id)).toBe(false);
                seen.add(id);
            }
        }
    });

    test('simulate advances mortality/births and returns what changed', () => {
        const population = new Population();
        population.generate(321, PARAMS);
        const deceasedBefore = Object.values(population.getPeople()).filter(p => p.deathTick !== null).length;

        const result = population.simulate(40 * TPY, TPY);

        const deceasedAfter = Object.values(population.getPeople()).filter(p => p.deathTick !== null).length;
        expect(deceasedAfter + result.died.length).toBeGreaterThanOrEqual(deceasedBefore);
        expect(population.getState().lastSimulatedYear).toBeGreaterThan(0);
    });

    test('simulate matches the pure simulatePopulation function given the same state', () => {
        const a = new Population();
        a.generate(654, PARAMS);
        const bState = generatePopulation(654, PARAMS);

        const resultA = a.simulate(15 * TPY, TPY);
        const resultB = simulatePopulation(bState, 15 * TPY, TPY);

        expect(resultA).toEqual(resultB);
        expect(a.getState()).toEqual(bState);
    });
});
