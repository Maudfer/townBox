// The perf-suite operation-count meter (util/perfMeter). It is ambient (a module-level active meter) and opt-in,
// so the contract to pin is: count() is a no-op until beginMeter, accumulates while active, and goes inert
// again after endMeter — the property that lets production/generation pay nothing for the instrumentation.

import { beginMeter, endMeter, count } from 'util/perfMeter';

describe('perfMeter', () => {
    afterEach(() => endMeter()); // never leak an active meter into another test

    it('count() is a no-op when no meter is active', () => {
        expect(() => count('anything', 5)).not.toThrow();
    });

    it('accumulates counts (default n = 1) into the active meter', () => {
        const meter = beginMeter();
        count('a');
        count('a');
        count('b', 3);
        count('c', 0);
        expect(meter.tally).toEqual({ a: 2, b: 3, c: 0 });
    });

    it('beginMeter starts a fresh tally each time', () => {
        const first = beginMeter();
        count('a');
        const second = beginMeter();
        count('a');
        expect(first.tally).toEqual({ a: 1 });
        expect(second.tally).toEqual({ a: 1 });
    });

    it('endMeter makes count() inert again (no tally growth after)', () => {
        const meter = beginMeter();
        count('a');
        endMeter();
        count('a'); // ignored — no active meter
        expect(meter.tally).toEqual({ a: 1 });
    });
});
