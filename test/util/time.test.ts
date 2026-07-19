import Clock from 'game/Clock';
import { DEFAULT_POPULATION_PARAMS } from 'game/population/Population';
import {
    MS_PER_IN_GAME_DAY,
    MS_PER_TICK,
    DAYS_PER_YEAR,
    DAYS_PER_MONTH,
    MONTHS_PER_YEAR,
    DAYS_PER_WEEK,
    WEEKDAY_NAMES,
    WEEKEND_DAYS,
    TICKS_PER_DAY,
    TICKS_PER_YEAR,
    timestampFromElapsed,
    absoluteDayFromElapsed,
    absoluteTickFromElapsed,
    dayOfTick,
    hourOfTick,
    dayOfWeekOfDay,
    dayOfWeekOfTick,
    isWeekendDay,
    isWeekendTick,
    formatTimestamp,
    formatTick,
    formatDuration,
    nextTimeScale,
    effectiveFrameDelta,
    MAX_FRAME_DELTA_MS,
    NEW_GAME_START_TICK,
} from 'util/time';

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

    test('the epoch reads as Year 1, 01/01 00:00 (a Monday)', () => {
        const ts = timestampFromElapsed(0);
        expect(ts).toEqual({ year: 1, month: 1, day: 1, hour: 0, minute: 0, absoluteDay: 0, dayOfWeek: 0 });
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

describe('weekdays & weekends (task 057)', () => {
    test('the week constants hold together (day 0 = Monday, weekend = Sat/Sun)', () => {
        expect(DAYS_PER_WEEK).toBe(7);
        expect(WEEKDAY_NAMES).toHaveLength(7);
        expect(WEEKDAY_NAMES[0]).toBe('mon');
        expect(WEEKEND_DAYS).toEqual([5, 6]);
        expect(WEEKDAY_NAMES[5]).toBe('sat');
        expect(WEEKDAY_NAMES[6]).toBe('sun');
    });

    test('isWeekendDay flags exactly Saturday and Sunday', () => {
        expect([0, 1, 2, 3, 4].map(isWeekendDay)).toEqual([false, false, false, false, false]);
        expect(isWeekendDay(5)).toBe(true);
        expect(isWeekendDay(6)).toBe(true);
    });

    test('weekdays roll over across years and drift against the 360-day calendar', () => {
        // Day 0 = Monday. 360 % 7 = 3, so each new year starts three weekdays later than the last.
        expect(dayOfWeekOfDay(0)).toBe(0); // Year 1, 01/01 -> mon
        expect(dayOfWeekOfDay(6)).toBe(6); // first sunday
        expect(dayOfWeekOfDay(7)).toBe(0); // next monday
        expect(dayOfWeekOfDay(DAYS_PER_YEAR)).toBe(3); // Year 2, 01/01 -> thu
        expect(dayOfWeekOfDay(2 * DAYS_PER_YEAR)).toBe(6); // Year 3, 01/01 -> sun
        expect(dayOfWeekOfDay(3 * DAYS_PER_YEAR)).toBe(2); // Year 4, 01/01 -> wed
        // A full 7-year super-cycle returns to the same weekday (7 * 360 is a multiple of 7).
        expect(dayOfWeekOfDay(7 * DAYS_PER_YEAR)).toBe(0);
    });

    test('negative (bootstrap) ticks continue the same weekly cycle through tick 0', () => {
        // Day -1 must be the day before Monday: Sunday.
        expect(dayOfWeekOfDay(-1)).toBe(6);
        expect(dayOfWeekOfDay(-7)).toBe(0);
        expect(dayOfWeekOfTick(-1)).toBe(6); // last hour of day -1
        expect(dayOfWeekOfTick(-TICKS_PER_DAY)).toBe(6); // first hour of day -1
        expect(dayOfWeekOfTick(-TICKS_PER_DAY - 1)).toBe(5); // last hour of day -2 (a Saturday)
        expect(isWeekendTick(-1)).toBe(true);
        expect(isWeekendTick(-TICKS_PER_DAY * 2 - 1)).toBe(false); // day -3 -> friday
    });

    test('isWeekendTick agrees with dayOfWeekOfTick across a two-week hourly sweep', () => {
        for (let tick = -7 * TICKS_PER_DAY; tick < 7 * TICKS_PER_DAY; tick++) {
            expect(isWeekendTick(tick)).toBe(isWeekendDay(dayOfWeekOfTick(tick)));
        }
    });

    test('Timestamp.dayOfWeek agrees with the tick math for the same elapsed time', () => {
        for (let day = 0; day < 15; day++) {
            const elapsed = day * MS_PER_IN_GAME_DAY + HOUR_MS / 3; // mid-day offset
            const ts = timestampFromElapsed(elapsed);
            expect(ts.dayOfWeek).toBe(dayOfWeekOfTick(absoluteTickFromElapsed(elapsed)));
            expect(ts.dayOfWeek).toBe(dayOfWeekOfDay(ts.absoluteDay));
        }
    });

    test('coarse strides classify every covered day consistently with the pure math', () => {
        // Stepping by e.g. 7-tick strides must never disagree with per-tick classification.
        const stride = 7;
        for (let tick = 0; tick < 4 * 7 * TICKS_PER_DAY; tick += stride) {
            expect(isWeekendTick(tick)).toBe(WEEKEND_DAYS.includes(dayOfWeekOfDay(dayOfTick(tick))));
        }
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

    test('exposes day-of-week and weekend state derived from the current tick (task 057)', () => {
        const clock = new Clock();
        expect(clock.getDayOfWeek()).toBe(0); // epoch is a Monday
        expect(clock.isWeekend()).toBe(false);

        clock.setElapsedMs(5 * MS_PER_IN_GAME_DAY); // day 5 -> saturday
        expect(clock.getDayOfWeek()).toBe(5);
        expect(clock.isWeekend()).toBe(true);

        clock.setElapsedMs(6 * MS_PER_IN_GAME_DAY); // day 6 -> sunday
        expect(clock.isWeekend()).toBe(true);

        clock.setElapsedMs(7 * MS_PER_IN_GAME_DAY); // day 7 -> monday again
        expect(clock.getDayOfWeek()).toBe(0);
        expect(clock.isWeekend()).toBe(false);
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

describe('formatDuration — human runtime readout', () => {
    const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;

    test('drops leading zero units left to right but always keeps seconds', () => {
        expect(formatDuration(4 * M)).toBe('4 min 0 s');       // the requested example
        expect(formatDuration(0)).toBe('0 s');
        expect(formatDuration(400)).toBe('0 s');               // sub-second rounds down to 0 s
        expect(formatDuration(43 * S)).toBe('43 s');
        expect(formatDuration(90 * M)).toBe('1 h 30 min 0 s'); // hours shown → lower units kept incl. zeros
    });

    test('keeps every lower unit once a higher one is shown (interior zeros stay)', () => {
        expect(formatDuration(2 * D + 5 * M + 3 * S)).toBe('2 d 0 h 5 min 3 s'); // zero hours retained
        expect(formatDuration(D + H + M + S)).toBe('1 d 1 h 1 min 1 s');
        expect(formatDuration(3 * H)).toBe('3 h 0 min 0 s');
    });

    test('rounds to whole seconds and never emits negatives', () => {
        expect(formatDuration(1500)).toBe('2 s'); // 1.5 s rounds to 2
        expect(formatDuration(-5000)).toBe('0 s');
    });
});

describe('first-class time control (W10 / proposal simulation-aliveness-3; formerly the 117 throttle)', () => {
    test('new games open at 09:00 (V11 / aliveness-4 M7): NEW_GAME_START_TICK is hour 9 of day 0', () => {
        expect(hourOfTick(NEW_GAME_START_TICK)).toBe(9);
        expect(dayOfTick(NEW_GAME_START_TICK)).toBe(0);
    });

    test('the shipped ladder cycles 1× → 10× → 50× → 1×; out-of-band values (incl. pause) reset to 1×', () => {
        // The ladder was revised to 1/10/50 by V11 (aliveness-4 M8) — 50× is the distortion-free fast-forward.
        expect(nextTimeScale(1)).toBe(10);
        expect(nextTimeScale(10)).toBe(50);
        expect(nextTimeScale(50)).toBe(1);
        expect(nextTimeScale(0)).toBe(1);
        expect(nextTimeScale(7)).toBe(1);
    });

    test('effectiveFrameDelta: the one authoritative transform — scaled, hitch-capped, pause-zeroed', () => {
        expect(effectiveFrameDelta(16, 1)).toBe(16);
        expect(effectiveFrameDelta(16, 10)).toBe(160);
        expect(effectiveFrameDelta(16, 50)).toBe(800);
        // A 5-second hang becomes lost wall time, never a sim leap: the cap applies BEFORE the scale.
        expect(effectiveFrameDelta(5000, 1)).toBe(MAX_FRAME_DELTA_MS);
        expect(effectiveFrameDelta(5000, 50)).toBe(MAX_FRAME_DELTA_MS * 50);
        // Pause and degenerate frames read as no time passed — for EVERY consumer, coherently.
        expect(effectiveFrameDelta(16, 0)).toBe(0);
        expect(effectiveFrameDelta(-5, 1)).toBe(0);
        expect(effectiveFrameDelta(Number.NaN, 1)).toBe(0);
    });

    test('speed invariance: equal SIM time through different frame schedules yields identical elapsed time', () => {
        // 500 frames of 16ms at 1× ≡ 50 frames at 10× ≡ 10 frames at 50× (the shipped ladder).
        const total = (frames: number, deltaMs: number, scale: number): number => {
            let elapsed = 0;
            for (let frame = 0; frame < frames; frame++) {
                elapsed += effectiveFrameDelta(deltaMs, scale);
            }
            return elapsed;
        };
        const at1 = total(500, 16, 1);
        expect(total(50, 16, 10)).toBe(at1);
        expect(total(10, 16, 50)).toBe(at1);
    });
});
