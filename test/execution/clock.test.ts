import Clock from 'game/Clock';
import { MS_PER_TICK, MS_PER_IN_GAME_DAY, TICKS_PER_YEAR, dayOfWeekOfTick, isWeekendDay } from 'util/time';

// Clock (game/Clock.ts) is the single source of in-game time: it accumulates elapsed real ms and derives
// every calendar/tick value from it. It is pure (no Phaser), so every branch is exercisable headlessly.

describe('Clock construction & the advance mutator', () => {
    test('defaults to elapsed 0', () => {
        const clock = new Clock();
        expect(clock.getElapsedMs()).toBe(0);
        expect(clock.getCurrentTick()).toBe(0);
        expect(clock.getCurrentDay()).toBe(0);
    });

    test('an explicit starting elapsedMs is honored', () => {
        const clock = new Clock(5 * MS_PER_TICK);
        expect(clock.getElapsedMs()).toBe(5 * MS_PER_TICK);
        expect(clock.getCurrentTick()).toBe(5);
    });

    test('a negative starting elapsedMs clamps to 0', () => {
        const clock = new Clock(-1000);
        expect(clock.getElapsedMs()).toBe(0);
    });

    test('advance accumulates positive deltas', () => {
        const clock = new Clock();
        clock.advance(1000);
        clock.advance(2000);
        expect(clock.getElapsedMs()).toBe(3000);
    });

    test('advance ignores zero and negative deltas (paused/first-frame safety)', () => {
        const clock = new Clock();
        clock.advance(1000);
        clock.advance(0);
        clock.advance(-500);
        expect(clock.getElapsedMs()).toBe(1000); // unchanged by the non-positive deltas
    });

    test('setElapsedMs overwrites the clock and clamps negatives to 0', () => {
        const clock = new Clock();
        clock.advance(1000);
        clock.setElapsedMs(50_000);
        expect(clock.getElapsedMs()).toBe(50_000);

        clock.setElapsedMs(-10);
        expect(clock.getElapsedMs()).toBe(0);
    });
});

describe('Clock derived calendar values', () => {
    test('getCurrentTick is the absolute in-game hour index, floor-derived from elapsed ms', () => {
        const clock = new Clock();
        clock.setElapsedMs(3 * MS_PER_TICK + 1); // just past the 3rd tick boundary
        expect(clock.getCurrentTick()).toBe(3);
    });

    test('getCurrentDay is the absolute in-game day index', () => {
        const clock = new Clock();
        clock.setElapsedMs(2 * MS_PER_IN_GAME_DAY + 500);
        expect(clock.getCurrentDay()).toBe(2);
    });

    test('getTicksPerYear equals the canonical TICKS_PER_YEAR constant (8640)', () => {
        const clock = new Clock();
        expect(clock.getTicksPerYear()).toBe(TICKS_PER_YEAR);
        expect(clock.getTicksPerYear()).toBe(8640);
    });

    test('getTimestamp derives a full Timestamp matching util/time', () => {
        const clock = new Clock();
        clock.setElapsedMs(40 * MS_PER_IN_GAME_DAY); // 40 days in: year 1, day-of-year 40
        const ts = clock.getTimestamp();
        expect(ts.year).toBe(1);
        expect(ts.absoluteDay).toBe(40);
        // day 40 (0-indexed) -> month 2, day 11 under a 30-day month.
        expect(ts.month).toBe(2);
        expect(ts.day).toBe(11);
    });

    test('getDayOfWeek matches util/time dayOfWeekOfTick for the current tick (day 0 = Monday)', () => {
        const clock = new Clock();
        expect(clock.getDayOfWeek()).toBe(dayOfWeekOfTick(0));
        expect(clock.getDayOfWeek()).toBe(0); // tick 0 is a Monday

        // Advance to day 5 (Saturday, day-of-week 5).
        clock.setElapsedMs(5 * MS_PER_IN_GAME_DAY);
        expect(clock.getDayOfWeek()).toBe(5);
    });

    test('isWeekend is true on Saturday/Sunday and false on weekdays, matching util/time', () => {
        const clock = new Clock();
        // Day 0 (Monday) through day 6 (Sunday): only the last two are weekend.
        for (let day = 0; day < 7; day++) {
            clock.setElapsedMs(day * MS_PER_IN_GAME_DAY);
            expect(clock.isWeekend()).toBe(isWeekendDay(day));
        }
        expect(clock.isWeekend()).toBe(true); // day 6 (Sunday) from the loop's last iteration
    });
});
