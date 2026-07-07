import {
    MS_PER_IN_GAME_DAY,
    MS_PER_TICK,
    DAYS_PER_YEAR,
    DAYS_PER_MONTH,
    MONTHS_PER_YEAR,
    TICKS_PER_DAY,
    TICKS_PER_YEAR,
    timestampFromElapsed,
    absoluteDayFromElapsed,
    absoluteTickFromElapsed,
    dayOfTick,
    hourOfTick,
    formatTimestamp,
    formatTick,
} from '../src/util/time';
import Clock from '../src/app/game/Clock';
import { DEFAULT_POPULATION_PARAMS } from '../src/app/game/Population';

const HOUR_MS = 3_600_000;

describe('hour ticks (task 040)', () => {
    test('the tick constants hold together', () => {
        expect(TICKS_PER_DAY).toBe(24);
        expect(TICKS_PER_YEAR).toBe(DAYS_PER_YEAR * 24);
        expect(MS_PER_TICK * TICKS_PER_DAY).toBe(MS_PER_IN_GAME_DAY);
    });

    test('absoluteTickFromElapsed advances 24 ticks per in-game day', () => {
        expect(absoluteTickFromElapsed(0)).toBe(0);
        expect(absoluteTickFromElapsed(MS_PER_TICK - 1)).toBe(0);
        expect(absoluteTickFromElapsed(MS_PER_TICK)).toBe(1);
        expect(absoluteTickFromElapsed(MS_PER_IN_GAME_DAY)).toBe(24);
        expect(absoluteTickFromElapsed(2.5 * MS_PER_IN_GAME_DAY)).toBe(60);
    });

    test('dayOfTick/hourOfTick use floor semantics, correct for negative (bootstrap) ticks', () => {
        expect(dayOfTick(0)).toBe(0);
        expect(dayOfTick(23)).toBe(0);
        expect(dayOfTick(24)).toBe(1);
        expect(hourOfTick(25)).toBe(1);
        // tick −1 is the last hour of day −1, not day 0.
        expect(dayOfTick(-1)).toBe(-1);
        expect(hourOfTick(-1)).toBe(23);
        expect(dayOfTick(-24)).toBe(-1);
        expect(hourOfTick(-24)).toBe(0);
    });

    test('formatTick renders the calendar date plus the hour', () => {
        expect(formatTick(0)).toBe('Year 1, 01/01 00:00');
        expect(formatTick(14)).toBe('Year 1, 01/01 14:00');
        expect(formatTick(TICKS_PER_DAY + 9)).toBe('Year 1, 01/02 09:00');
        // Pre-epoch (bootstrap) ticks clamp to the epoch, like formatDay does for days.
        expect(formatTick(-500)).toBe('Year 1, 01/01 00:00');
    });
});

describe('time math', () => {
    test('one real hour equals one in-game day', () => {
        expect(MS_PER_IN_GAME_DAY).toBe(HOUR_MS);
        expect(absoluteDayFromElapsed(HOUR_MS)).toBe(1);
        expect(absoluteDayFromElapsed(HOUR_MS - 1)).toBe(0);
    });

    test('the epoch reads as Year 1, 01/01 00:00', () => {
        const ts = timestampFromElapsed(0);
        expect(ts).toEqual({ year: 1, month: 1, day: 1, hour: 0, minute: 0, absoluteDay: 0 });
    });

    test('time-of-day is derived within a day (half a day = noon)', () => {
        const ts = timestampFromElapsed(HOUR_MS / 2);
        expect(ts.hour).toBe(12);
        expect(ts.minute).toBe(0);
        expect(ts.absoluteDay).toBe(0);
    });

    test('day, month and year roll over on the 360-day calendar', () => {
        expect(DAYS_PER_YEAR).toBe(360);
        expect(DAYS_PER_MONTH).toBe(30);
        expect(MONTHS_PER_YEAR).toBe(12);

        // Day index 30 (the 31st day) -> month 2, day 1.
        const monthRollover = timestampFromElapsed(30 * HOUR_MS);
        expect(monthRollover.month).toBe(2);
        expect(monthRollover.day).toBe(1);
        expect(monthRollover.year).toBe(1);

        // One full year in -> Year 2, 01/01.
        const yearRollover = timestampFromElapsed(DAYS_PER_YEAR * HOUR_MS);
        expect(yearRollover).toMatchObject({ year: 2, month: 1, day: 1 });
        expect(yearRollover.absoluteDay).toBe(360);
    });

    test('formatTimestamp zero-pads the calendar fields', () => {
        expect(formatTimestamp(timestampFromElapsed(0))).toBe('Year 1, 01/01 00:00');
    });
});

describe('Clock', () => {
    test('advances elapsed time and ignores non-positive deltas', () => {
        const clock = new Clock();
        clock.advance(HOUR_MS);
        clock.advance(-5);
        clock.advance(0);
        expect(clock.getElapsedMs()).toBe(HOUR_MS);
        // One real hour = one in-game day = 24 hour-ticks (task 040).
        expect(clock.getCurrentTick()).toBe(24);
    });

    test('state restores from elapsedMs (save/load)', () => {
        const clock = new Clock();
        clock.setElapsedMs(5 * HOUR_MS + HOUR_MS / 4);
        expect(clock.getTimestamp().absoluteDay).toBe(5);
        expect(clock.getTimestamp().hour).toBe(6);
    });

    test('the genealogy tick contract: ticksPerYear matches the pool and ages derive correctly', () => {
        const clock = new Clock();
        // Equality is what keeps generated birthTicks and clock-derived ages consistent.
        expect(clock.getTicksPerYear()).toBe(DEFAULT_POPULATION_PARAMS.ticksPerYear);

        // Advance to 100 in-game years; someone born at tick 0 should read as age 100.
        clock.setElapsedMs(100 * DAYS_PER_YEAR * HOUR_MS);
        const tick = clock.getCurrentTick();
        const ticksPerYear = clock.getTicksPerYear();
        expect(tick).toBe(100 * DAYS_PER_YEAR * 24);
        expect(Math.floor((tick - 0) / ticksPerYear)).toBe(100);
    });
});
