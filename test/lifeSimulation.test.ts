import { generatePopulation, simulatePopulation, annualMortality, DEFAULT_SIMULATION_PARAMS } from '../src/app/game/Population';
import { isAliveAt } from '../src/util/kinship';
import { GenPerson, PersonTable, PopulationState, PopulationParams, SimulationParams } from '../src/types/Genealogy';
import { Genders, Gender } from '../src/types/Social';

const TPY = 360;

const GEN_PARAMS: PopulationParams = {
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

function person(id: string, gender: Gender, birthTick: number, extra: Partial<GenPerson> = {}): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender, birthTick, deathTick: null, fatherId: null, motherId: null, partnerships: [], ...extra };
}

function makeState(people: GenPerson[], worldSeed = 7): PopulationState {
    const table: PersonTable = {};
    for (const p of people) {
        table[p.id] = p;
    }
    return { worldSeed, people: table, drawSeed: 1, placedIds: [], nextSeq: people.length, lastSimulatedYear: 0 };
}

describe('annualMortality', () => {
    test('rises with age and is certain at the cap', () => {
        expect(annualMortality(20, DEFAULT_SIMULATION_PARAMS)).toBeLessThan(annualMortality(70, DEFAULT_SIMULATION_PARAMS));
        expect(annualMortality(DEFAULT_SIMULATION_PARAMS.maxAgeYears, DEFAULT_SIMULATION_PARAMS)).toBe(1);
        expect(annualMortality(30, DEFAULT_SIMULATION_PARAMS)).toBeLessThanOrEqual(DEFAULT_SIMULATION_PARAMS.maxMortality);
    });
});

describe('simulatePopulation', () => {
    test('is deterministic for the same world seed and tick', () => {
        const a = generatePopulation(2024, GEN_PARAMS);
        const b = generatePopulation(2024, GEN_PARAMS);
        simulatePopulation(a, 10 * TPY, TPY);
        simulatePopulation(b, 10 * TPY, TPY);
        expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    });

    test('the very old die for certain', () => {
        // Two people: one at the age cap, one young.
        const ancient = person('ancient', Genders.Male, -200 * TPY); // age 200 at tick 0
        const young = person('young', Genders.Female, -20 * TPY);
        const state = makeState([ancient, young]);

        const result = simulatePopulation(state, 1 * TPY, TPY);

        expect(result.died).toContain('ancient');
        expect(isAliveAt(state.people['ancient']!, 1 * TPY)).toBe(false);
        expect(isAliveAt(state.people['young']!, 1 * TPY)).toBe(true);
    });

    test('a married fertile couple can produce children with both parents alive', () => {
        const startMarriage = -5 * TPY;
        const dad = person('dad', Genders.Male, -30 * TPY, { partnerships: [{ partnerId: 'mom', startTick: startMarriage, endTick: null }] });
        const mom = person('mom', Genders.Female, -28 * TPY, { partnerships: [{ partnerId: 'dad', startTick: startMarriage, endTick: null }] });
        const state = makeState([dad, mom], 123);

        // High birth probability, no mortality, over several years to guarantee a birth.
        const params: SimulationParams = { ...DEFAULT_SIMULATION_PARAMS, mortalityBase: 0, maxMortality: 0, annualBirthProbability: 1 };
        const result = simulatePopulation(state, 5 * TPY, TPY, params);

        expect(result.born.length).toBeGreaterThan(0);
        for (const childId of result.born) {
            const child = state.people[childId]!;
            expect(child.fatherId).toBe('dad');
            expect(child.motherId).toBe('mom');
            // Born while both parents were alive.
            expect(isAliveAt(state.people['dad']!, child.birthTick)).toBe(true);
            expect(isAliveAt(state.people['mom']!, child.birthTick)).toBe(true);
        }
    });

    test('does not re-simulate an already-applied year', () => {
        const state = makeState([person('a', Genders.Male, -40 * TPY)]);
        simulatePopulation(state, 10 * TPY, TPY);
        expect(state.lastSimulatedYear).toBe(10);

        // Calling again at the same tick advances nothing.
        const again = simulatePopulation(state, 10 * TPY, TPY);
        expect(again.died).toHaveLength(0);
        expect(again.born).toHaveLength(0);
        expect(state.lastSimulatedYear).toBe(10);
    });

    test('over many years a generated population accrues deaths', () => {
        const state = generatePopulation(55, GEN_PARAMS);
        const deceasedBefore = Object.values(state.people).filter(p => p.deathTick !== null).length;
        simulatePopulation(state, 40 * TPY, TPY);
        const deceasedAfter = Object.values(state.people).filter(p => p.deathTick !== null).length;
        expect(deceasedAfter).toBeGreaterThan(deceasedBefore);
    });
});
