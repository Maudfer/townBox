// The event bus payload contract (pause bug, 2026-07-20): emit() must pass a FALSY-but-valid payload
// (0, false, '') through to handlers untouched. The old `if (!payload) payload = {}` clobbered them — the
// Pause button emits `setTimeScale(0)`, so `0` became `{}` and setTimeScale({}) fell back to 1× (time never
// paused). GameManager can't load in the node env (its import chain pulls in Phaser, which references
// `window`), so we stub `phaser` — emit()/emitSingle() never touch it — and call the methods off the
// prototype with a fake `this` (they only read `this.eventListeners`).
jest.mock('phaser', () => ({
    __esModule: true,
    default: { AUTO: 0, Scale: { RESIZE: 0, CENTER_BOTH: 0 }, Game: class {}, Scene: class {}, Math: { RND: { pick: (a: unknown[]) => a[0] } } },
    AUTO: 0, Scale: { RESIZE: 0, CENTER_BOTH: 0 }, Game: class {}, Scene: class {}, Math: { RND: { pick: (a: unknown[]) => a[0] } },
}));

import GameManager from 'game/GameManager';
import Clock from 'game/Clock';
import { MS_PER_TICK } from 'util/time';

type FakeBus = { eventListeners: Record<string, { callback: (p: unknown) => unknown; context: unknown }[]> };

async function emit(payload: unknown): Promise<unknown[]> {
    const received: unknown[] = [];
    const self: FakeBus = { eventListeners: { evt: [{ callback: p => { received.push(p); }, context: null }] } };
    await (GameManager.prototype.emit as unknown as (this: FakeBus, e: string, p?: unknown) => Promise<unknown[]>)
        .call(self, 'evt', payload);
    return received;
}

async function emitSingle(payload: unknown): Promise<unknown> {
    let received: unknown;
    const self: FakeBus = { eventListeners: { evt: [{ callback: p => { received = p; return p; }, context: null }] } };
    await (GameManager.prototype.emitSingle as unknown as (this: FakeBus, e: string, p?: unknown) => Promise<unknown>)
        .call(self, 'evt', payload);
    return received;
}

describe('GameManager.emit — falsy payloads reach handlers (pause bug)', () => {
    test('a 0 payload passes through untouched (setTimeScale(0) / Pause)', async () => {
        expect(await emit(0)).toEqual([0]);
    });

    test('false and empty-string payloads pass through', async () => {
        expect(await emit(false)).toEqual([false]);
        expect(await emit('')).toEqual(['']);
    });

    test('a genuinely absent (undefined/null) payload still defaults to {}', async () => {
        expect(await emit(undefined)).toEqual([{}]);
        expect(await emit(null)).toEqual([{}]);
    });

    test('emitSingle has the same contract: 0 reaches the handler', async () => {
        expect(await emitSingle(0)).toBe(0);
        expect(await emitSingle(undefined)).toEqual({});
    });
});

// advanceTime must step over EVERY crossed in-game minute (stuck-people-at-50x bug): a single large frame
// delta (a hitch at 50×) used to jump the clock past minutes whose commute-departure pump never fired.
describe('GameManager.advanceTime — no crossed minute is skipped', () => {
    type FakeClockOwner = {
        clock: Clock; timePaused: boolean;
        lastDayEmitted: number; lastTickEmitted: number; lastMinuteEmitted: number;
        effectiveTimeDelta: (d: number) => number;
        emit: (name: string, payload?: { timestamp: { hour: number; minute: number } }) => void;
        emitTimeCadence: () => void;
    };

    // Drives advanceTime once with the given effective delta and returns the emitted timeChanged minutes.
    function timeChangedMinutes(deltaMs: number): number[] {
        const emits: number[] = [];
        const self: FakeClockOwner = {
            clock: new Clock(0), timePaused: false,
            lastDayEmitted: -1, lastTickEmitted: -1, lastMinuteEmitted: -1,
            effectiveTimeDelta: d => d, // pass-through: deltaMs IS the advance
            emit: (name, payload) => { if (name === 'timeChanged' && payload) { emits.push(payload.timestamp.hour * 60 + payload.timestamp.minute); } },
            emitTimeCadence: GameManager.prototype['emitTimeCadence' as keyof GameManager] as unknown as () => void,
        };
        (GameManager.prototype['advanceTime' as keyof GameManager] as unknown as (this: FakeClockOwner, p: { timeDelta: number }) => void)
            .call(self, { timeDelta: deltaMs });
        return emits;
    }

    test('a 3-in-game-minute frame delta emits timeChanged for each of the 3 minutes', () => {
        const minuteMs = MS_PER_TICK / 60;
        const minutes = timeChangedMinutes(minuteMs * 3 + 5); // just over 3 in-game minutes in one frame
        expect(new Set(minutes).size).toBe(3); // 3 distinct minutes, none skipped
        expect(minutes).toEqual([1, 2, 3]);
    });

    test('a sub-minute frame delta emits at most one minute (no behaviour change at 1×)', () => {
        const minuteMs = MS_PER_TICK / 60;
        expect(timeChangedMinutes(minuteMs * 0.4).length).toBeLessThanOrEqual(1);
    });
});
