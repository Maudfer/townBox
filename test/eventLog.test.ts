import EventEngine from '../src/app/game/EventEngine';
import { EventManifest, EventLogEntry } from '../src/types/LifeEvent';
import { PopulationState, GenPerson } from '../src/types/Genealogy';
import { Genders, Gender } from '../src/types/Social';

// The append-only event log (task 040): every commit gets a globally monotonic seq, a tick, roles, a trigger
// source, and a causation id; emitted signals chain to the committing entry.

const TPY = 8640;

const CERTAIN_MANIFEST: EventManifest = {
    // perYear >= 1 clamps to certainty, so this fires for every living agent every tick.
    daily_ping: {
        label: 'Pinged',
        roles: { subject: { where: { attr: 'alive', op: '==', value: true } } },
        triggers: { probabilistic: { perYear: 200000 } },
        effects: [{ type: 'emit', signal: 'pinged', target: 'subject' }],
    },
} as unknown as EventManifest;

function gen(id: string, gender: Gender, ageYears: number, tickNow: number): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender, birthTick: tickNow - ageYears * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function state(tickNow: number, seed = 42): PopulationState {
    return {
        worldSeed: seed,
        people: {
            a: gen('a', Genders.Female, 30, tickNow),
            b: gen('b', Genders.Male, 40, tickNow),
        },
        drawSeed: 1,
        placedIds: [],
        nextSeq: 100,
        lastSimulatedYear: 0,
    };
}

describe('event log (task 040)', () => {
    test('commits append log entries with monotonic seq, tick, roles, and trigger source', () => {
        const engine = new EventEngine(CERTAIN_MANIFEST);
        const pool = state(1000);
        engine.simulateTick(pool, ['a', 'b'], 1000, TPY, {});
        engine.simulateTick(pool, ['a', 'b'], 1001, TPY, {});

        const logA = engine.getPersonLog('a');
        const logB = engine.getPersonLog('b');
        expect(logA).toHaveLength(2);
        expect(logB).toHaveLength(2);

        // Agents run in sorted order, so within a tick 'a' commits before 'b'.
        expect(logA[0]).toMatchObject({ seq: 0, tick: 1000, kind: 'event', defId: 'daily_ping', triggerSource: 'probability', causationId: null });
        expect((logA[0] as EventLogEntry).roles).toEqual({ subject: 'a' });
        expect(logB[0]!.seq).toBe(1);
        expect(logA[1]!.seq).toBe(2);
        expect(logB[1]!.seq).toBe(3);
        expect(engine.getNextLogSeq()).toBe(4);
    });

    test('the aggregate history stays a faithful derived index of the log', () => {
        const engine = new EventEngine(CERTAIN_MANIFEST);
        const pool = state(1000);
        engine.simulateTick(pool, ['a'], 1000, TPY, {});
        engine.simulateTick(pool, ['a'], 1001, TPY, {});
        expect(engine.getHistory()['a']!['daily_ping']).toEqual({ count: 2, lastTick: 1001 });
        expect(engine.getPersonLog('a').filter(entry => entry.defId === 'daily_ping')).toHaveLength(2);
    });

    test('signals carry the emitting event id and the committing entry seq as causation', () => {
        const engine = new EventEngine(CERTAIN_MANIFEST);
        const result = engine.simulateTick(state(1000), ['a'], 1000, TPY, {});
        expect(result.signals).toHaveLength(1);
        expect(result.signals[0]).toMatchObject({ signal: 'pinged', personId: 'a', tick: 1000, eventId: 'daily_ping' });
        expect(result.signals[0]!.causationId).toBe(engine.getPersonLog('a')[0]!.seq);
    });

    test('same seed + same pool → identical logs (determinism)', () => {
        const run = () => {
            const engine = new EventEngine(CERTAIN_MANIFEST);
            const pool = state(500, 7);
            for (let tick = 500; tick < 510; tick++) {
                engine.simulateTick(pool, ['a', 'b'], tick, TPY, {});
            }
            return engine.getLog();
        };
        expect(run()).toEqual(run());
    });

    test('loadLog round-trips and continues the seq without collisions', () => {
        const first = new EventEngine(CERTAIN_MANIFEST);
        const pool = state(1000);
        first.simulateTick(pool, ['a', 'b'], 1000, TPY, {});

        const second = new EventEngine(CERTAIN_MANIFEST);
        second.loadHistory(JSON.parse(JSON.stringify(first.getHistory())));
        second.loadLog(JSON.parse(JSON.stringify(first.getLog())), first.getNextLogSeq());
        second.simulateTick(pool, ['a'], 1001, TPY, {});

        const seqs = Object.values(second.getLog()).flat().map(entry => entry.seq).sort((x, y) => x - y);
        expect(new Set(seqs).size).toBe(seqs.length); // unique
        expect(Math.max(...seqs)).toBe(2);

        // Defensive path: deriving nextSeq from the stored log when the explicit counter is absent.
        const third = new EventEngine(CERTAIN_MANIFEST);
        third.loadLog(JSON.parse(JSON.stringify(second.getLog())));
        expect(third.getNextLogSeq()).toBe(3);
    });
});
