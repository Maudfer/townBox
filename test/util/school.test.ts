import { SchoolConfig } from 'types/School';
import {
    SCHOOL_BASIC_CAP,
    schoolWindow,
    isSchoolInSession,
    isSchoolDay,
    isSchoolAge,
    countSchoolDays,
    totalEligibleSchoolDays,
    schoolDailyGain,
    schoolFactsFor,
} from 'util/school';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from 'util/time';

// Pure school-schedule math (task 058): reuses util/shifts for on-duty checks, so day/time math is the same
// one source of truth jobs use.

function config(overrides: Partial<SchoolConfig> = {}): SchoolConfig {
    return {
        dayStartMinutes: 8 * 60,
        dayEndMinutes: 14 * 60,
        daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'],
        minAgeYears: 7,
        maxAgeYears: 17,
        capacity: { mode: 'const', value: 30 },
        ...overrides,
    };
}

describe('schoolWindow', () => {
    test('mirrors the config as a ShiftWindow', () => {
        const cfg = config();
        expect(schoolWindow(cfg)).toEqual({ shiftStart: 8 * 60, shiftEnd: 14 * 60, daysOfWeek: cfg.daysOfWeek });
    });
});

describe('isSchoolInSession', () => {
    const cfg = config();

    test('true on a weekday within the day window', () => {
        // Tick 0 is Monday 00:00 (util/time convention); add 9 hours to land inside the 08:00-14:00 window.
        expect(isSchoolInSession(cfg, 9)).toBe(true);
    });

    test('false outside the day window', () => {
        expect(isSchoolInSession(cfg, 20)).toBe(false); // 20:00, after hours
    });

    test('false on a weekend even at a normally-in-session hour', () => {
        const saturday = 5 * TICKS_PER_DAY + 9; // Saturday 09:00
        expect(isSchoolInSession(cfg, saturday)).toBe(false);
    });
});

describe('isSchoolDay / isSchoolAge', () => {
    test('weekdays configured in daysOfWeek are school days; weekends are not', () => {
        const cfg = config();
        expect(isSchoolDay(cfg, 0)).toBe(true); // day 0 = Monday
        expect(isSchoolDay(cfg, 5)).toBe(false); // day 5 = Saturday
        expect(isSchoolDay(cfg, 6)).toBe(false); // day 6 = Sunday
    });

    test('isSchoolAge is inclusive at both bounds', () => {
        const cfg = config();
        expect(isSchoolAge(cfg, 6)).toBe(false);
        expect(isSchoolAge(cfg, 7)).toBe(true);
        expect(isSchoolAge(cfg, 17)).toBe(true);
        expect(isSchoolAge(cfg, 18)).toBe(false);
    });
});

describe('countSchoolDays', () => {
    test('counts exactly the weekday-schedule days in [from, to)', () => {
        const cfg = config();
        // Days 0..6 = one full week (Mon..Sun); 5 weekdays.
        expect(countSchoolDays(cfg, 0, 7)).toBe(5);
        // Two full weeks.
        expect(countSchoolDays(cfg, 0, 14)).toBe(10);
    });

    test('an empty range counts zero', () => {
        expect(countSchoolDays(config(), 3, 3)).toBe(0);
    });
});

describe('totalEligibleSchoolDays / schoolDailyGain', () => {
    test('perfect attendance from 7th to 18th birthday lands exactly SCHOOL_BASIC_CAP at 18', () => {
        const cfg = config();
        // Born at tick 0 for a clean birthday-aligned career.
        const birthTick = 0;
        const total = totalEligibleSchoolDays(cfg, birthTick);
        expect(total).toBeGreaterThan(0);
        const gain = schoolDailyGain(cfg, birthTick);
        expect(gain * total).toBeCloseTo(SCHOOL_BASIC_CAP, 6);
    });

    test('a config with zero eligible days yields zero gain (no division by zero)', () => {
        // maxAgeYears < minAgeYears collapses the eligible window to nothing.
        const cfg = config({ minAgeYears: 10, maxAgeYears: 9 });
        expect(totalEligibleSchoolDays(cfg, 0)).toBe(0);
        expect(schoolDailyGain(cfg, 0)).toBe(0);
    });

    test('gain is nearly identical regardless of the person\'s birth weekday', () => {
        const cfg = config();
        // A person born mid-week vs. one born on a Monday should both land close to the same per-day gain
        // (the person-specific count differs slightly by weekday alignment against the 360-day year).
        const gainMonday = schoolDailyGain(cfg, 0);
        const gainMidweek = schoolDailyGain(cfg, 3 * TICKS_PER_DAY);
        expect(gainMonday).toBeCloseTo(0.0212, 3);
        expect(gainMidweek).toBeCloseTo(0.0212, 3);
    });
});

describe('schoolFactsFor', () => {
    test('carries the schedule window plus the school key', () => {
        const cfg = config();
        expect(schoolFactsFor(cfg, 'school@10-10')).toEqual({
            schoolKey: 'school@10-10',
            shiftStart: 8 * 60,
            shiftEnd: 14 * 60,
            daysOfWeek: cfg.daysOfWeek,
        });
    });
});

// Sanity anchor: TICKS_PER_YEAR is used internally by totalEligibleSchoolDays; confirm the import resolves to
// the same constant the rest of the calendar system uses (guards against a silent divergent redefinition).
test('TICKS_PER_YEAR is the canonical calendar constant', () => {
    expect(TICKS_PER_YEAR).toBe(8640);
});
