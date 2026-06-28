import EventEngine from '../src/app/game/EventEngine';
import { Genders, Gender } from '../src/types/Social';
import { GenPerson, PersonTable, PopulationState } from '../src/types/Genealogy';
import { EventManifest } from '../src/types/LifeEvent';

const TPY = 360;

function gen(id: string, gender: Gender, ageYears: number, overrides: Partial<GenPerson> = {}): GenPerson {
    return {
        id,
        firstName: id,
        familyName: 'Fam',
        gender,
        birthTick: -ageYears * TPY, // tick "now" is 0 in these tests
        deathTick: null,
        fatherId: null,
        motherId: null,
        partnerships: [],
        ...overrides,
    };
}

function makeState(people: GenPerson[], worldSeed = 7): PopulationState {
    const table: PersonTable = {};
    let seq = 0;
    for (const person of people) {
        table[person.id] = person;
        seq++;
    }
    return { worldSeed, people: table, drawSeed: 0, placedIds: people.map(p => p.id), nextSeq: seq, lastSimulatedYear: 0 };
}

function marryInState(state: PopulationState, aId: string, bId: string, startTick: number): void {
    state.people[aId]!.partnerships.push({ partnerId: bId, startTick, endTick: null });
    state.people[bId]!.partnerships.push({ partnerId: aId, startTick, endTick: null });
}

describe('EventEngine — probability extremes', () => {
    test('perYear 1 with a matching state is a certain daily event; the dead are skipped', () => {
        const manifest: EventManifest = {
            die: { roles: { subject: { where: { attr: 'alive', op: '==', value: true } } }, probability: { perYear: 1 }, effects: [{ type: 'setDeath' }] },
        };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 40), gen('b', Genders.Female, 40, { deathTick: -10 })]);

        const result = engine.simulateDay(state, ['a', 'b'], 0, TPY);

        expect(result.died).toEqual(['a']); // 'b' was already dead and skipped
        expect(state.people['a']!.deathTick).toBe(0);
    });

    test('perYear 0 never fires', () => {
        const manifest: EventManifest = {
            noop: { roles: { subject: { where: { attr: 'alive', op: '==', value: true } } }, probability: { perYear: 0 }, effects: [{ type: 'emit', signal: 'never' }] },
        };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 30)]);
        const result = engine.simulateDay(state, ['a'], 0, TPY);
        expect(result.signals).toEqual([]);
    });
});

describe('EventEngine — derived exclusivity at runtime', () => {
    test('death and marriage cannot both fire for the same person on the same day', () => {
        const manifest: EventManifest = {
            death: { roles: { subject: { where: { attr: 'alive', op: '==', value: true } } }, probability: { perYear: 1 }, effects: [{ type: 'setDeath' }] },
            marriage: {
                roles: {
                    subject: { where: { all: [{ attr: 'alive', op: '==', value: true }, { attr: 'marital', op: '==', value: 'single' }] } },
                    partner: { where: { all: [{ attr: 'alive', op: '==', value: true }, { attr: 'marital', op: '==', value: 'single' }] } },
                },
                probability: { perYear: 1 },
                effects: [{ type: 'marry', role: 'partner' }],
            },
        };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 40), gen('b', Genders.Female, 40)]);

        const result = engine.simulateDay(state, ['a', 'b'], 0, TPY);

        // death sorts before marriage and excludes it; nobody marries on the day they die.
        expect(result.died).toContain('a');
        expect(state.people['a']!.partnerships).toHaveLength(0);
    });
});

describe('EventEngine — marriage', () => {
    test('two eligible singles form a symmetric ongoing partnership', () => {
        const manifest: EventManifest = {
            marriage: {
                roles: {
                    subject: { where: { all: [{ attr: 'alive', op: '==', value: true }, { attr: 'marital', op: '==', value: 'single' }] } },
                    partner: { where: { all: [{ attr: 'alive', op: '==', value: true }, { attr: 'marital', op: '==', value: 'single' }] } },
                },
                probability: { perYear: 1 },
                effects: [{ type: 'marry', role: 'partner' }],
            },
        };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 30), gen('b', Genders.Female, 30)]);

        engine.simulateDay(state, ['a', 'b'], 100, TPY);

        const a = state.people['a']!;
        const b = state.people['b']!;
        expect(a.partnerships).toHaveLength(1);
        expect(b.partnerships).toHaveLength(1);
        expect(a.partnerships[0]!.partnerId).toBe('b');
        expect(b.partnerships[0]!.partnerId).toBe('a');
        expect(a.partnerships[0]!.startTick).toBe(100);
        expect(a.partnerships[0]!.endTick).toBeNull();
    });
});

describe('EventEngine — same-day dependency chain (had_sex -> pregnancy)', () => {
    const manifest: EventManifest = {
        had_sex: { roles: { subject: { where: { attr: 'alive', op: '==', value: true } } }, probability: { perYear: 1000 }, effects: [] },
        pregnancy: {
            roles: {
                subject: { where: { all: [
                    { attr: 'alive', op: '==', value: true },
                    { attr: 'gender', op: '==', value: 'female' },
                    { hasEvent: 'had_sex', withinDays: 280 },
                    { not: { hasEvent: 'pregnancy', withinDays: 300 } },
                ] } },
                father: { bind: 'partnerOf:subject' },
            },
            probability: { perYear: 1000 },
            effects: [{ type: 'birth', mother: 'subject', father: 'father' }],
        },
    };

    test('had_sex recorded this day satisfies pregnancy the same day and a child is born', () => {
        const engine = new EventEngine(manifest);
        const state = makeState([gen('w', Genders.Female, 30), gen('m', Genders.Male, 32)]);
        marryInState(state, 'w', 'm', -1000);

        const result = engine.simulateDay(state, ['w', 'm'], 0, TPY);

        expect(result.born).toHaveLength(1);
        expect(result.born[0]!.motherId).toBe('w');
        expect(result.born[0]!.fatherId).toBe('m');
        const childId = result.born[0]!.id;
        expect(state.people[childId]).toBeDefined();
        expect(state.people[childId]!.motherId).toBe('w');
    });

    test('a recent pregnancy in history blocks a new one (cooldown via not hasEvent withinDays)', () => {
        const engine = new EventEngine(manifest);
        engine.loadHistory({ w: { pregnancy: { count: 1, lastTick: -100 }, had_sex: { count: 1, lastTick: -1 } } });
        const state = makeState([gen('w', Genders.Female, 30), gen('m', Genders.Male, 32)]);
        marryInState(state, 'w', 'm', -1000);

        const result = engine.simulateDay(state, ['w', 'm'], 0, TPY); // pregnancy 100 days ago < 300 cooldown
        expect(result.born).toHaveLength(0);
    });
});

describe('EventEngine — history + determinism', () => {
    test('history records and round-trips through load', () => {
        const manifest: EventManifest = {
            had_sex: { roles: { subject: { where: { attr: 'alive', op: '==', value: true } } }, probability: { perYear: 1000 }, effects: [] },
        };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 30)]);
        engine.simulateDay(state, ['a'], 5, TPY);

        expect(engine.hasEvent('a', 'had_sex', 5)).toBe(true);

        const restored = new EventEngine(manifest);
        restored.loadHistory(engine.getHistory());
        expect(restored.hasEvent('a', 'had_sex', 5)).toBe(true);
        expect(restored.hasEvent('a', 'had_sex', 5, { withinDays: 1 })).toBe(true);
    });

    test('a day is reproducible for the same seed + state', () => {
        const manifest: EventManifest = {
            marriage: {
                roles: {
                    subject: { where: { all: [{ attr: 'alive', op: '==', value: true }, { attr: 'marital', op: '==', value: 'single' }] } },
                    partner: { where: { all: [{ attr: 'alive', op: '==', value: true }, { attr: 'marital', op: '==', value: 'single' }] } },
                },
                probability: { perYear: 0.5 },
                effects: [{ type: 'marry', role: 'partner' }],
            },
        };
        const people = [gen('a', Genders.Male, 30), gen('b', Genders.Female, 28), gen('c', Genders.Male, 35), gen('d', Genders.Female, 33)];

        const stateA = makeState(people.map(p => ({ ...p, partnerships: [] })));
        const stateB = makeState(people.map(p => ({ ...p, partnerships: [] })));
        const resultA = new EventEngine(manifest).simulateDay(stateA, ['a', 'b', 'c', 'd'], 42, TPY);
        const resultB = new EventEngine(manifest).simulateDay(stateB, ['a', 'b', 'c', 'd'], 42, TPY);

        expect(resultA).toEqual(resultB);
        expect(JSON.stringify(stateA.people)).toBe(JSON.stringify(stateB.people));
    });
});

describe('EventEngine — seeded manifest smoke', () => {
    test('runs a day over a small materialized cohort without throwing and returns a DayResult', () => {
        const engine = new EventEngine();
        const state = makeState([gen('a', Genders.Male, 45), gen('b', Genders.Female, 42), gen('c', Genders.Male, 120)]);
        marryInState(state, 'a', 'b', -3000);

        const result = engine.simulateDay(state, ['a', 'b', 'c'], 50 * TPY, TPY);

        expect(Array.isArray(result.died)).toBe(true);
        expect(Array.isArray(result.born)).toBe(true);
        expect(Array.isArray(result.signals)).toBe(true);
        // The 120-year-old is over the mortality curve's tail; death is effectively certain.
        expect(result.died).toContain('c');
    });
});
