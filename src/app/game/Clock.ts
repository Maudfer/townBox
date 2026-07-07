import { Timestamp } from 'types/Time';
import { timestampFromElapsed, absoluteTickFromElapsed, absoluteDayFromElapsed, TICKS_PER_YEAR } from 'util/time';

// The single source of truth for in-game time. It accumulates elapsed real time from the `update` event's
// timeDelta and derives every calendar/clock value from it (no other system re-derives time). Only `advance`
// mutates it; everything else reads. State is a single number (elapsedMs) so it serializes trivially.
//
// `getCurrentTick()` / `getTicksPerYear()` are the contract the genealogy consumes: since task 040 the tick
// is the absolute in-game HOUR index (24 per day), and ticks-per-year equals TICKS_PER_YEAR (8640 == the
// pool's `ticksPerYear`). Calendar-day values derive via getCurrentDay()/util/time dayOfTick().
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

    // Absolute in-game hour index — the canonical simulation/genealogy tick (task 040).
    getCurrentTick(): number {
        return absoluteTickFromElapsed(this.elapsedMs);
    }

    // Absolute in-game day index (calendar granularity, for day-cadence consumers).
    getCurrentDay(): number {
        return absoluteDayFromElapsed(this.elapsedMs);
    }

    // Hour-ticks per year; equals the genealogy `ticksPerYear`.
    getTicksPerYear(): number {
        return TICKS_PER_YEAR;
    }
}
