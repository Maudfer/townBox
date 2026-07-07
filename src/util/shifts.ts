// Shift math (task 045) — the ONE source of truth for "is this person on duty now". Consumed by the commute
// scheduler (City.handleCommute), Brain's shift hooks (046), and the Job Orchestrator (047).
//
// Conventions:
//  - Shift times are minutes since midnight. `shiftEnd < shiftStart` means the shift CROSSES MIDNIGHT.
//  - A cross-midnight shift belongs to its START day: a Friday 22:00–06:00 shift is on duty early Saturday
//    morning because FRIDAY is a working day.
//  - `daysOfWeek` uses 'mon'..'sun' names (util/time WEEKDAY_NAMES, day 0 = Monday); an absent list (legacy
//    saves) means every day.

import { MINUTES_PER_DAY, DAYS_PER_WEEK, WEEKDAY_NAMES, dayOfWeekOfTick, hourOfTick } from 'util/time';

// Accepts both runtime JobPositions (typed Weekday[]) and raw JobDefinitions (string[] from JSON).
export interface ShiftWindow {
    shiftStart: number;
    shiftEnd: number;
    daysOfWeek?: readonly string[] | undefined;
}

function worksOnDay(shift: ShiftWindow, dayOfWeek: number): boolean {
    if (!shift.daysOfWeek || shift.daysOfWeek.length === 0) {
        return true;
    }
    const name = WEEKDAY_NAMES[dayOfWeek]!;
    return shift.daysOfWeek.includes(name);
}

// Whether the shift is active at a given day-of-week + minute-of-day (the commute scheduler's granularity).
export function isOnShiftAt(shift: ShiftWindow, dayOfWeek: number, minuteOfDay: number): boolean {
    if (shift.shiftStart === shift.shiftEnd) {
        return false; // zero-length window
    }
    if (shift.shiftStart < shift.shiftEnd) {
        return minuteOfDay >= shift.shiftStart && minuteOfDay < shift.shiftEnd && worksOnDay(shift, dayOfWeek);
    }
    // Cross-midnight: the evening leg belongs to today; the morning leg belongs to YESTERDAY's shift.
    if (minuteOfDay >= shift.shiftStart) {
        return worksOnDay(shift, dayOfWeek);
    }
    if (minuteOfDay < shift.shiftEnd) {
        const yesterday = (dayOfWeek + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK;
        return worksOnDay(shift, yesterday);
    }
    return false;
}

// Tick-granularity convenience (hour resolution) for the simulation layer (hooks/orchestrator).
export function isOnShiftAtTick(shift: ShiftWindow, tick: number): boolean {
    return isOnShiftAt(shift, dayOfWeekOfTick(tick), hourOfTick(tick) * 60);
}

// Minutes until the next shift start from the given moment, or null if the job never works. Used by the
// prepare/commute window logic (046).
export function minutesUntilShiftStart(shift: ShiftWindow, dayOfWeek: number, minuteOfDay: number): number | null {
    for (let dayOffset = 0; dayOffset <= DAYS_PER_WEEK; dayOffset++) {
        const day = (dayOfWeek + dayOffset) % DAYS_PER_WEEK;
        if (!worksOnDay(shift, day)) {
            continue;
        }
        const start = dayOffset * MINUTES_PER_DAY + shift.shiftStart;
        const now = minuteOfDay;
        if (start >= now) {
            return start - now;
        }
    }
    return null;
}
