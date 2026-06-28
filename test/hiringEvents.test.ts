import EventEngine from '../src/app/game/EventEngine';
import { Genders, Gender } from '../src/types/Social';
import { GenPerson, PersonTable, PopulationState } from '../src/types/Genealogy';
import { EventManifest, JobMarket } from '../src/types/LifeEvent';

const TPY = 360;

function gen(id: string, gender: Gender, ageYears: number): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender, birthTick: -ageYears * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function makeState(people: GenPerson[]): PopulationState {
    const table: PersonTable = {};
    people.forEach(p => { table[p.id] = p; });
    return { worldSeed: 7, people: table, drawSeed: 0, placedIds: people.map(p => p.id), nextSeq: people.length, lastSimulatedYear: 0 };
}

// A fake employment market: `employed` is the source of truth; `hireResult` lets a test simulate a failed
// acquisition (the same-day slot race).
function fakeMarket(hireResult = true): JobMarket & { employed: Set<string> } {
    const employed = new Set<string>();
    return {
        employed,
        isEmployed: (id: string) => employed.has(id),
        canHire: (id: string) => !employed.has(id),
        hire: (id: string) => { if (hireResult) { employed.add(id); } return hireResult; },
        fire: (id: string) => { employed.delete(id); },
    };
}

const HIRING: EventManifest = {
    get_job: {
        roles: { subject: { where: { all: [
            { attr: 'alive', op: '==', value: true },
            { attr: 'age', op: '>=', value: 18 },
            { attr: 'employed', op: '==', value: false },
            { attr: 'canBeHired', op: '==', value: true },
        ] } } },
        probability: { perYear: 1000 },
        effects: [
            { type: 'acquireSlot', resource: 'job', target: 'subject' },
            { type: 'emit', signal: 'hired', target: 'subject' },
        ],
    },
    layoff: {
        roles: { subject: { where: { all: [
            { attr: 'alive', op: '==', value: true },
            { attr: 'employed', op: '==', value: true },
            { not: { hasEvent: 'get_job', withinDays: 30 } },
        ] } } },
        probability: { perYear: 1000 },
        effects: [
            { type: 'releaseSlot', resource: 'job', target: 'subject' },
            { type: 'emit', signal: 'laidOff', target: 'subject' },
        ],
    },
};

describe('hiring events (get_job / layoff via the JobMarket)', () => {
    test('an eligible unemployed adult is hired through the market', () => {
        const engine = new EventEngine(HIRING);
        const market = fakeMarket();
        const state = makeState([gen('a', Genders.Male, 30)]);

        const result = engine.simulateDay(state, ['a'], 0, TPY, market);

        expect(market.employed.has('a')).toBe(true);
        expect(result.signals.map(s => s.signal)).toContain('hired');
        expect(engine.hasEvent('a', 'get_job', 0)).toBe(true);
        // The hire cooldown blocks a same-day layoff.
        expect(result.signals.map(s => s.signal)).not.toContain('laidOff');
        expect(engine.hasEvent('a', 'layoff', 0)).toBe(false);
    });

    test('without a market nobody can be hired (canBeHired is false)', () => {
        const engine = new EventEngine(HIRING);
        const state = makeState([gen('a', Genders.Male, 30)]);
        const result = engine.simulateDay(state, ['a'], 0, TPY); // no market
        expect(result.signals).toEqual([]);
        expect(engine.hasEvent('a', 'get_job', 0)).toBe(false);
    });

    test('a failed acquisition aborts get_job (no hire, no history, no signal)', () => {
        const engine = new EventEngine(HIRING);
        const market = fakeMarket(false); // canHire true, but hire fails (slot taken this tick)
        const state = makeState([gen('a', Genders.Male, 30)]);

        const result = engine.simulateDay(state, ['a'], 0, TPY, market);

        expect(market.employed.has('a')).toBe(false);
        expect(result.signals).toEqual([]);
        expect(engine.hasEvent('a', 'get_job', 0)).toBe(false);
    });

    test('an employed person past the hire cooldown can be laid off', () => {
        const engine = new EventEngine(HIRING);
        engine.loadHistory({ a: { get_job: { count: 1, lastTick: -60 } } }); // hired 60 days ago (> 30)
        const market = fakeMarket();
        market.employed.add('a');
        const state = makeState([gen('a', Genders.Male, 30)]);

        const result = engine.simulateDay(state, ['a'], 0, TPY, market);

        expect(market.employed.has('a')).toBe(false);
        expect(result.signals.map(s => s.signal)).toContain('laidOff');
    });
});
