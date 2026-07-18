import EventEngine from 'game/events/EventEngine';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { EventManifest, EventLogEntry } from 'types/LifeEvent';
import { Genders, Gender } from 'types/Social';

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

// The live-era log view (LP-1 / proposal simulation-aliveness-2 P0-1): hydrated pre-game entries are a
// hydration-time view — the save serializes ONLY entries at/above each person's live floor, and a load
// re-installs the past from the asset. Serializing 100k-entry hydrated pasts overflowed JSON.stringify.
describe('live-era log view (LP-1)', () => {
    const preGame = (seq: number, tick: number) => ({
        tick, kind: 'action' as const, defId: 'sleep', instanceId: null, lifecycle: 'performed' as const,
        params: {}, parentInstanceId: null, triggerSource: 'brain' as const, causationId: null, seq,
    });

    test('getLiveLog excludes installed pre-game entries but keeps live commits', () => {
        const engine = new EventEngine(CERTAIN_MANIFEST);
        engine.installPersonLog('a', [preGame(5000, -300), preGame(5001, -299), preGame(5002, 0)]);
        const pool = state(1000);
        engine.simulateTick(pool, ['a', 'b'], 1000, TPY, {});

        // The full log holds past + live; the live view holds only live (boundary tick-0 asset entries
        // are excluded by SEQ, not tick — they re-install on load, so no duplication either way).
        expect(engine.getPersonLog('a').length).toBe(4);
        const live = engine.getLiveLog();
        expect(live['a']!.length).toBe(1);
        expect(live['a']![0]!.seq).toBeGreaterThan(5002);
        // 'b' has no floor: serialized in full.
        expect(live['b']!.length).toBe(1);
    });

    test('a second install for the same person is a no-op (re-hydration idempotence)', () => {
        const engine = new EventEngine(CERTAIN_MANIFEST);
        engine.installPersonLog('a', [preGame(5000, -300)]);
        engine.installPersonLog('a', [preGame(5000, -300)]);
        expect(engine.getPersonLog('a').length).toBe(1);
    });

    test('load resets the floors so post-load re-hydration restores the full log without duplication', () => {
        const engine = new EventEngine(CERTAIN_MANIFEST);
        engine.installPersonLog('a', [preGame(5000, -300), preGame(5001, -299)]);
        const pool = state(1000);
        engine.simulateTick(pool, ['a', 'b'], 1000, TPY, {});

        // Save: live view only. Load into a fresh engine (what SaveManager does), then re-hydrate.
        const saved = JSON.parse(JSON.stringify(engine.getLiveLog()));
        const loaded = new EventEngine(CERTAIN_MANIFEST);
        loaded.loadLog(saved, engine.getNextLogSeq());
        expect(loaded.getPersonLog('a').length).toBe(1);
        loaded.installPersonLog('a', [preGame(5000, -300), preGame(5001, -299)]);

        const restored = loaded.getPersonLog('a');
        expect(restored.length).toBe(3);
        expect(restored.map(entry => entry.seq)).toEqual([5000, 5001, restored[2]!.seq]);
        // And the restored engine's live view is unchanged — floors re-established by the install.
        expect(loaded.getLiveLog()['a']!.length).toBe(1);
    });
});

// The intra-tick cadence (LP-11 / proposal simulation-aliveness-2 M1): commits resolve at the flip but
// materialize across the hour — minute-stamped deterministically, spread evenly with ±20% jitter,
// causation chains sharing their root's minute, per-person monotonic.
describe('minute stamping (LP-11)', () => {
    const entryBase = { kind: 'action' as const, defId: 'stretch', instanceId: null, lifecycle: 'performed' as const, params: {}, parentInstanceId: null, triggerSource: 'brain' as const };

    test('a burst of same-tick entries spreads across the hour, deterministically and monotonically', () => {
        const run = () => {
            const engine = new EventEngine(CERTAIN_MANIFEST);
            const log = engine.getLifeLog();
            for (let i = 0; i < 4; i++) {
                log.append('a', { ...entryBase, tick: 100, causationId: null });
            }
            log.stampMinutes(100, 42);
            return engine.getPersonLog('a').map(entry => entry.minute!);
        };
        const minutes = run();
        expect(minutes).toHaveLength(4);
        for (const minute of minutes) {
            expect(minute).toBeGreaterThanOrEqual(0);
            expect(minute).toBeLessThan(60);
        }
        // Monotonic per person, and genuinely SPREAD (4 slots of 15min each, ±3min jitter -> a range
        // far wider than the all-at-:00 world).
        for (let i = 1; i < minutes.length; i++) {
            expect(minutes[i]!).toBeGreaterThanOrEqual(minutes[i - 1]!);
        }
        expect(minutes[3]! - minutes[0]!).toBeGreaterThanOrEqual(30);
        expect(run()).toEqual(minutes); // deterministic
    });

    test('a causation chain shares its root minute (the gift and its counterpart land together)', () => {
        const engine = new EventEngine(CERTAIN_MANIFEST);
        const log = engine.getLifeLog();
        const rootSeq = log.append('a', { ...entryBase, tick: 100, causationId: null });
        log.append('b', { ...entryBase, tick: 100, causationId: rootSeq });
        log.stampMinutes(100, 42);
        const giver = engine.getPersonLog('a')[0]!;
        const receiver = engine.getPersonLog('b')[0]!;
        expect(giver.minute).toBeDefined();
        expect(receiver.minute).toBe(giver.minute);
    });

    test('the shared tick spine stamps every commit (runTick integration)', () => {
        const engine = new EventEngine(CERTAIN_MANIFEST);
        const pool = state(1000);
        engine.simulateTick(pool, ['a', 'b'], 1000, TPY, {});
        engine.getLifeLog().stampMinutes(1000, pool.worldSeed);
        for (const entry of [...engine.getPersonLog('a'), ...engine.getPersonLog('b')]) {
            expect(entry.minute).toBeDefined();
        }
    });
});
