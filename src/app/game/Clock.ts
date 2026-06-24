import { Timestamp } from 'types/Time';
import { timestampFromElapsed, absoluteDayFromElapsed, DAYS_PER_YEAR } from 'util/time';

// The single source of truth for in-game time. It accumulates elapsed real time from the `update` event's
// timeDelta and derives every calendar/clock value from it (no other system re-derives time). Only `advance`
// mutates it; everything else reads. State is a single number (elapsedMs) so it serializes trivially.
//
// `getCurrentTick()` / `getTicksPerYear()` are the contract the genealogy consumes: the tick is the absolute
// in-game day index, and ticks-per-year equals the calendar's DAYS_PER_YEAR (== the pool's `ticksPerYear`).
export default class Clock {
    private elapsedMs: number;

    constructor(elapsedMs: number = 0) {
        this.elapsedMs = Math.max(0, elapsedMs);
    }

    // The only mutator. Ignores non-positive deltas (paused/first frame).
    advance(deltaMs: number): void {
        if (deltaMs > 0) {
            this.elapsedMs += deltaMs;
        }
    }

    getElapsedMs(): number {
        return this.elapsedMs;
    }

    setElapsedMs(elapsedMs: number): void {
        this.elapsedMs = Math.max(0, elapsedMs);
    }

    getTimestamp(): Timestamp {
        return timestampFromElapsed(this.elapsedMs);
    }

    // Absolute in-game day index — the canonical genealogy tick.
    getCurrentTick(): number {
        return absoluteDayFromElapsed(this.elapsedMs);
    }

    // Day-ticks per year; equals the genealogy `ticksPerYear`.
    getTicksPerYear(): number {
        return DAYS_PER_YEAR;
    }
}
