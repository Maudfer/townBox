import EventEngine from '../src/app/game/EventEngine';
import { Genders, Gender } from '../src/types/Social';
import { GenPerson, PersonTable, PopulationState } from '../src/types/Genealogy';
import { EventManifest, MoneyLedger } from '../src/types/LifeEvent';

const TPY = 360;

function gen(id: string, gender: Gender, ageYears: number): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender, birthTick: -ageYears * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function makeState(people: GenPerson[]): PopulationState {
    const table: PersonTable = {};
    people.forEach(p => { table[p.id] = p; });
    return { worldSeed: 7, people: table, drawSeed: 0, placedIds: people.map(p => p.id), nextSeq: people.length, lastSimulatedYear: 0 };
}

function fakeLedger(initial: Record<string, number> = {}): MoneyLedger & { balances: Record<string, number> } {
    const balances = { ...initial };
    return {
        balances,
        getPersonBalance: (id: string) => balances[id] ?? 0,
        adjustPerson: (id: string, delta: number) => { balances[id] = (balances[id] ?? 0) + delta; },
    };
}

describe('economy in the event engine (task 017)', () => {
    test('adjustMoney credits the subject through the ledger', () => {
        const manifest: EventManifest = {
            payday: {
                roles: { subject: { where: { attr: 'alive', op: '==', value: true } } },
                probability: { perYear: 1000 },
                effects: [{ type: 'adjustMoney', target: 'subject', amount: { mode: 'const', value: 500 } }],
            },
        };
        const engine = new EventEngine(manifest);
        const ledger = fakeLedger({ a: 100 });
        const state = makeState([gen('a', Genders.Male, 30)]);

        engine.simulateDay(state, ['a'], 0, TPY, { ledger });

        expect(ledger.balances['a']).toBe(600);
    });

    test('the money attribute gates eligibility (only the wealthy qualify)', () => {
        const manifest: EventManifest = {
            buy_yacht: {
                roles: { subject: { where: { all: [
                    { attr: 'alive', op: '==', value: true },
                    { attr: 'money', op: '>=', value: 1000 },
                ] } } },
                probability: { perYear: 1000 },
                effects: [{ type: 'emit', signal: 'boughtYacht', target: 'subject' }],
            },
        };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('rich', Genders.Male, 40), gen('poor', Genders.Female, 40)]);
        const ledger = fakeLedger({ rich: 5000, poor: 50 });

        const result = engine.simulateDay(state, ['rich', 'poor'], 0, TPY, { ledger });

        const buyers = result.signals.filter(s => s.signal === 'boughtYacht').map(s => s.personId);
        expect(buyers).toEqual(['rich']);
    });

    test('without a ledger, money is 0 and adjustMoney is a no-op (no crash)', () => {
        const manifest: EventManifest = {
            payday: {
                roles: { subject: { where: { attr: 'alive', op: '==', value: true } } },
                probability: { perYear: 1000 },
                effects: [{ type: 'adjustMoney', target: 'subject', amount: { mode: 'const', value: 500 } }],
            },
        };
        const engine = new EventEngine(manifest);
        const state = makeState([gen('a', Genders.Male, 30)]);
        expect(() => engine.simulateDay(state, ['a'], 0, TPY)).not.toThrow();
    });
});
