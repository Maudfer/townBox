import { selectHousehold } from '../src/app/game/HouseholdDraw';
import { generatePopulation } from '../src/app/game/Population';
import { SeededRandom } from '../src/util/random';
import { isAliveAt, ageAt, relationshipLabel } from '../src/util/kinship';
import { GenPerson, PersonTable, PopulationState, PopulationParams } from '../src/types/Genealogy';
import { DrawParams, HouseholdArrangements } from '../src/types/Household';
import { Genders, Gender } from '../src/types/Social';

const TICKS_PER_YEAR = 360;
const NOW = 0;
const CAPACITY = 8;

function person(id: string, gender: Gender, ageYears: number, extra: Partial<GenPerson> = {}): GenPerson {
    return {
        id,
        firstName: id,
        familyName: 'Fix',
        gender,
        birthTick: NOW - ageYears * TICKS_PER_YEAR,
        deathTick: null,
        fatherId: null,
        motherId: null,
        partnerships: [],
        ...extra,
    };
}

function makeState(people: GenPerson[], drawSeed = 1): PopulationState {
    const table: PersonTable = {};
    for (const p of people) {
        table[p.id] = p;
    }
    return { worldSeed: 0, people: table, drawSeed, placedIds: [], nextSeq: people.length };
}

function weights(only: HouseholdArrangements): DrawParams {
    const base: Record<HouseholdArrangements, number> = {
        [HouseholdArrangements.Nuclear]: 0,
        [HouseholdArrangements.Single]: 0,
        [HouseholdArrangements.Multigen]: 0,
        [HouseholdArrangements.Siblings]: 0,
        [HouseholdArrangements.Guardianship]: 0,
        [HouseholdArrangements.Roommates]: 0,
    };
    base[only] = 1;
    return { adultAgeYears: 18, maxRoommates: 3, arrangementWeights: base };
}

describe('selectHousehold — crafted scenarios', () => {
    test('guardianship: an orphaned minor placed with an adult sibling', () => {
        const dad = person('dad', Genders.Male, 60, { deathTick: NOW - 500 });
        const mom = person('mom', Genders.Female, 58, { deathTick: NOW - 400 });
        const orphan = person('orphan', Genders.Male, 8, { fatherId: 'dad', motherId: 'mom' });
        const bigSib = person('bigSib', Genders.Female, 27, { fatherId: 'dad', motherId: 'mom' });
        const state = makeState([dad, mom, orphan, bigSib]);

        const selection = selectHousehold(state, new SeededRandom(5), NOW, CAPACITY, TICKS_PER_YEAR, weights(HouseholdArrangements.Guardianship));

        expect(selection.arrangement).toBe(HouseholdArrangements.Guardianship);
        expect(selection.memberIds.sort()).toEqual(['bigSib', 'orphan']);
        expect(ageAt(orphan, NOW, TICKS_PER_YEAR)).toBeLessThan(18);
        // The deceased parents are never drawn.
        expect(selection.memberIds).not.toContain('dad');
        expect(selection.memberIds).not.toContain('mom');
    });

    test('roommates: unrelated adults co-reside with no kinship tie', () => {
        const people = [
            person('a', Genders.Male, 25),
            person('b', Genders.Female, 31),
            person('c', Genders.Male, 28),
            person('d', Genders.Female, 40),
        ];
        const state = makeState(people);

        const selection = selectHousehold(state, new SeededRandom(3), NOW, CAPACITY, TICKS_PER_YEAR, weights(HouseholdArrangements.Roommates));

        expect(selection.arrangement).toBe(HouseholdArrangements.Roommates);
        expect(selection.memberIds.length).toBeGreaterThanOrEqual(2);
        for (const a of selection.memberIds) {
            for (const b of selection.memberIds) {
                if (a !== b) {
                    expect(relationshipLabel(state.people, a, b)).toBeNull();
                }
            }
        }
    });

    test('nuclear: a couple with their minor children', () => {
        const dad = person('dad', Genders.Male, 38, { partnerships: [{ partnerId: 'mom', startTick: NOW - 15 * TICKS_PER_YEAR, endTick: null }] });
        const mom = person('mom', Genders.Female, 36, { partnerships: [{ partnerId: 'dad', startTick: NOW - 15 * TICKS_PER_YEAR, endTick: null }] });
        const kid = person('kid', Genders.Female, 6, { fatherId: 'dad', motherId: 'mom' });
        const adultKid = person('adultKid', Genders.Male, 20, { fatherId: 'dad', motherId: 'mom' });
        const state = makeState([dad, mom, kid, adultKid]);

        const selection = selectHousehold(state, new SeededRandom(1), NOW, CAPACITY, TICKS_PER_YEAR, weights(HouseholdArrangements.Nuclear));

        expect(selection.arrangement).toBe(HouseholdArrangements.Nuclear);
        expect(selection.memberIds).toEqual(expect.arrayContaining(['kid']));
        // Adult children are not pulled into the parents' nuclear household.
        expect(selection.memberIds).not.toContain('adultKid');
    });
});

describe('selectHousehold — immigrant fallback', () => {
    test('generates a fresh family when the pool is empty', () => {
        const state = makeState([]);
        const selection = selectHousehold(state, new SeededRandom(9), NOW, CAPACITY, TICKS_PER_YEAR);

        expect(selection.memberIds.length).toBeGreaterThanOrEqual(1);
        for (const id of selection.memberIds) {
            expect(state.people[id]).toBeDefined();
            expect(isAliveAt(state.people[id]!, NOW)).toBe(true);
        }
        expect(state.placedIds).toEqual(expect.arrayContaining(selection.memberIds));
        expect(state.nextSeq).toBeGreaterThan(0);
    });

    test('generates immigrants when every pool member is already placed', () => {
        const state = makeState([person('a', Genders.Male, 30)]);
        state.placedIds = ['a'];
        const selection = selectHousehold(state, new SeededRandom(2), NOW, CAPACITY, TICKS_PER_YEAR);

        expect(selection.memberIds).not.toContain('a');
        expect(selection.memberIds.every(id => id !== 'a')).toBe(true);
    });
});

describe('selectHousehold — determinism & no double placement', () => {
    test('identical state + RNG yields an identical selection', () => {
        const build = () => makeState([
            person('a', Genders.Male, 30),
            person('b', Genders.Female, 28, { partnerships: [{ partnerId: 'a', startTick: NOW - 5 * TICKS_PER_YEAR, endTick: null }] }),
        ]);
        const s1 = build();
        const s2 = build();
        const r1 = selectHousehold(s1, new SeededRandom(42), NOW, CAPACITY, TICKS_PER_YEAR);
        const r2 = selectHousehold(s2, new SeededRandom(42), NOW, CAPACITY, TICKS_PER_YEAR);
        expect(r1).toEqual(r2);
    });

    test('drawing repeatedly over a generated pool never reuses or picks the dead', () => {
        const params: PopulationParams = {
            ticksPerYear: TICKS_PER_YEAR,
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
        const state = generatePopulation(98765, params);
        const rng = new SeededRandom(state.drawSeed);

        const seen = new Set<string>();
        for (let i = 0; i < 40; i++) {
            const selection = selectHousehold(state, rng, NOW, CAPACITY, TICKS_PER_YEAR);
            expect(selection.memberIds.length).toBeGreaterThan(0);
            expect(selection.memberIds.length).toBeLessThanOrEqual(CAPACITY);
            for (const id of selection.memberIds) {
                expect(seen.has(id)).toBe(false); // never drawn twice
                seen.add(id);
                expect(isAliveAt(state.people[id]!, NOW)).toBe(true); // never the dead
            }
        }
        // Everyone drawn is recorded as placed.
        expect(state.placedIds).toEqual(expect.arrayContaining([...seen]));
    });
});
