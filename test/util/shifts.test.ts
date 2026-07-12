import jobsConfig from 'json/jobs.json';
import { JobTable } from 'types/Business';
import { isOnShiftAt, isOnShiftAtTick, minutesUntilShiftStart } from 'util/shifts';
import { dayOfWeekOfTick, TICKS_PER_DAY } from 'util/time';

// Shift math (task 045): the one source of truth for "on duty now" — day-of-week gating, cross-midnight
// windows, and the authored-schedules backfill sanity.

const JOBS = jobsConfig as unknown as JobTable;
const MON = 0, FRI = 4, SAT = 5, SUN = 6;

describe('isOnShiftAt', () => {
    const dayShift = { shiftStart: 9 * 60, shiftEnd: 17 * 60, daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'] as const };

    test('plain daytime windows respect the working days', () => {
        expect(isOnShiftAt(dayShift, MON, 9 * 60)).toBe(true);
        expect(isOnShiftAt(dayShift, MON, 17 * 60)).toBe(false); // end is exclusive
        expect(isOnShiftAt(dayShift, MON, 8 * 60 + 59)).toBe(false);
        expect(isOnShiftAt(dayShift, SAT, 10 * 60)).toBe(false); // off day
    });

    test('an absent daysOfWeek list (legacy saves) means every day', () => {
        expect(isOnShiftAt({ shiftStart: 9 * 60, shiftEnd: 17 * 60 }, SUN, 10 * 60)).toBe(true);
    });

    test('a zero-length window (shiftStart === shiftEnd) is never on shift', () => {
        expect(isOnShiftAt({ shiftStart: 9 * 60, shiftEnd: 9 * 60 }, MON, 9 * 60)).toBe(false);
    });

    test('cross-midnight shifts belong to their START day', () => {
        // A Friday-only 22:00–06:00 night shift:
        const night = { shiftStart: 22 * 60, shiftEnd: 6 * 60, daysOfWeek: ['fri'] as const };
        expect(isOnShiftAt(night, FRI, 23 * 60)).toBe(true); // Friday evening
        expect(isOnShiftAt(night, SAT, 3 * 60)).toBe(true); // Saturday 03:00 = still Friday's shift
        expect(isOnShiftAt(night, SAT, 23 * 60)).toBe(false); // Saturday evening: no Saturday shift
        expect(isOnShiftAt(night, FRI, 3 * 60)).toBe(false); // Friday 03:00 would be THURSDAY's shift
        expect(isOnShiftAt(night, FRI, 12 * 60)).toBe(false); // midday gap
    });

    test('tick-granularity wrapper agrees with the calendar', () => {
        // Tick 0 is Monday 00:00; hour 10 on day 0 = Monday 10:00.
        expect(dayOfWeekOfTick(0)).toBe(MON);
        expect(isOnShiftAtTick(JOBS['checkout_clerk']!, 10)).toBe(true); // 8:00–16:00 mon–sat
        expect(isOnShiftAtTick(JOBS['checkout_clerk']!, 6 * TICKS_PER_DAY + 10)).toBe(false); // Sunday off
    });
});

describe('minutesUntilShiftStart', () => {
    test('finds the next start across off days', () => {
        const shift = { shiftStart: 9 * 60, shiftEnd: 17 * 60, daysOfWeek: ['mon'] as const };
        expect(minutesUntilShiftStart(shift, MON, 8 * 60)).toBe(60);
        // From Saturday 10:00, the next Monday 09:00 is 2 days − 1 hour away.
        expect(minutesUntilShiftStart(shift, SAT, 10 * 60)).toBe(2 * 24 * 60 - 60);
        expect(minutesUntilShiftStart({ shiftStart: 9 * 60, shiftEnd: 17 * 60, daysOfWeek: [] }, MON, 0)).toBe(9 * 60);
    });

    test('returns null for a job that never works any day of the week', () => {
        // A bogus daysOfWeek list (matches no real weekday name) means worksOnDay is false every day,
        // so the search exhausts a full week without finding a start.
        const neverWorks = { shiftStart: 9 * 60, shiftEnd: 17 * 60, daysOfWeek: ['nonexistent-day'] };
        expect(minutesUntilShiftStart(neverWorks, MON, 0)).toBeNull();
    });
});

describe('jobs.json backfill sanity (task 045)', () => {
    test('every job authors shifts, working days, and at least one work action of each kind', () => {
        for (const [id, job] of Object.entries(JOBS)) {
            expect({ id, shiftStart: typeof job.shiftStart }).toEqual({ id, shiftStart: 'number' });
            expect({ id, shiftEnd: typeof job.shiftEnd }).toEqual({ id, shiftEnd: 'number' });
            expect({ id, days: job.daysOfWeek.length > 0 }).toEqual({ id, days: true });
            expect({ id, cont: job.workActions.continuous.length >= 1 }).toEqual({ id, cont: true });
            expect({ id, disc: job.workActions.discrete.length >= 1 }).toEqual({ id, disc: true });
        }
    });

    test('the roster is varied: not everyone works 09:00–17:00 every day, and a night shift exists', () => {
        const starts = new Set(Object.values(JOBS).map(job => job.shiftStart));
        expect(starts.size).toBeGreaterThanOrEqual(8);
        expect(Object.values(JOBS).some(job => job.shiftEnd < job.shiftStart)).toBe(true); // cross-midnight
        expect(Object.values(JOBS).some(job => job.daysOfWeek.length < 7)).toBe(true); // real off days
    });
});
