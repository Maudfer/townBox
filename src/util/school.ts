// Pure school-schedule math (task 058). The school day is a ShiftWindow (util/shifts), so on-session checks
// reuse the exact same weekday/cross-midnight math jobs use — one source of on-duty truth. `isSchoolDay` is
// the single extension point task 057 reserved: future calendar exceptions (holidays, vacations) compose
// HERE, so consumers (the Brain hook, progression counting in 063) never re-derive weekday logic.

import { ShiftWindow, isOnShiftAtTick } from 'util/shifts';
import { dayOfWeekOfDay, WEEKDAY_NAMES } from 'util/time';
import { SchoolConfig, SchoolFacts } from 'types/School';

// The schedule as a shift window (shared math with jobs).
export function schoolWindow(config: SchoolConfig): ShiftWindow {
    return { shiftStart: config.dayStartMinutes, shiftEnd: config.dayEndMinutes, daysOfWeek: config.daysOfWeek };
}

// Whether school is in session at this tick (weekday AND within the day window).
export function isSchoolInSession(config: SchoolConfig, tick: number): boolean {
    return isOnShiftAtTick(schoolWindow(config), tick);
}

// Whether an absolute day is a school day (weekday check only — the future holiday/vacation layer goes here).
export function isSchoolDay(config: SchoolConfig, absoluteDay: number): boolean {
    const name = WEEKDAY_NAMES[dayOfWeekOfDay(absoluteDay)];
    return name !== undefined && config.daysOfWeek.includes(name);
}

// Whether an age (in whole years) is inside the enrollment band.
export function isSchoolAge(config: SchoolConfig, ageYears: number): boolean {
    return ageYears >= config.minAgeYears && ageYears <= config.maxAgeYears;
}

export function schoolFactsFor(config: SchoolConfig, schoolKey: string): SchoolFacts {
    return {
        schoolKey,
        shiftStart: config.dayStartMinutes,
        shiftEnd: config.dayEndMinutes,
        daysOfWeek: config.daysOfWeek,
    };
}
