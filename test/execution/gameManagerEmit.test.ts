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
