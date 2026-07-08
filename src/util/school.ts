// Pure school-schedule math (task 058). The school day is a ShiftWindow (util/shifts), so on-session checks
// reuse the exact same weekday/cross-midnight math jobs use — one source of on-duty truth. `isSchoolDay` is
// the single extension point task 057 reserved: future calendar exceptions (holidays, vacations) compose
// HERE, so consumers (the Brain hook, progression counting in 063) never re-derive weekday logic.

import { ShiftWindow, isOnShiftAtTick } from 'util/shifts';
import { dayOfWeekOfDay, dayOfTick, WEEKDAY_NAMES, TICKS_PER_YEAR } from 'util/time';
import { SchoolConfig, SchoolFacts } from 'types/School';

// School-sourced progression on BASIC skills caps at 60 (tasks 062/063): perfect attendance from the 7th to
// the 18th birthday lands every basic skill at exactly 60.0. The band above 60 is career/talent territory
// (see types/Skill.ts) — other provenances may push past it; school never does.
export const SCHOOL_BASIC_CAP = 60;

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

// The number of school days (weekday-schedule days) in [fromDay, toDayExclusive). Pure calendar math —
// the person-specific counts differ slightly by birth weekday because 360-day years drift against the week.
export function countSchoolDays(config: SchoolConfig, fromDay: number, toDayExclusive: number): number {
    let count = 0;
    for (let day = fromDay; day < toDayExclusive; day++) {
        if (isSchoolDay(config, day)) {
            count++;
        }
    }
    return count;
}

// Every school day between a person's 7th and 18th birthdays (their whole school career), from their actual
// calendar — the denominator of the exact-60-at-18 contract (task 063).
export function totalEligibleSchoolDays(config: SchoolConfig, birthTick: number): number {
    const startDay = dayOfTick(birthTick + config.minAgeYears * TICKS_PER_YEAR);
    const endDay = dayOfTick(birthTick + (config.maxAgeYears + 1) * TICKS_PER_YEAR);
    return countSchoolDays(config, startDay, endDay);
}

// Per-completed-school-day proficiency gain for every basic skill: perfect attendance 7→18 reaches exactly
// SCHOOL_BASIC_CAP regardless of weekday alignment. (The 52-weeks reference figure ≈0.020979/day is a sanity
// anchor only; the person-specific count is authoritative.)
export function schoolDailyGain(config: SchoolConfig, birthTick: number): number {
    const total = totalEligibleSchoolDays(config, birthTick);
    return total > 0 ? SCHOOL_BASIC_CAP / total : 0;
}

export function schoolFactsFor(config: SchoolConfig, schoolKey: string): SchoolFacts {
    return {
        schoolKey,
        shiftStart: config.dayStartMinutes,
        shiftEnd: config.dayEndMinutes,
        daysOfWeek: config.daysOfWeek,
    };
}
