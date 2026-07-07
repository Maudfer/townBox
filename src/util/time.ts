import { Timestamp } from 'types/Time';

// Pure in-game time math, independent of Phaser so it is unit-testable. The scale is fixed by design:
// one in-game day takes one real hour. The calendar is a simple, regular 30-day month / 12-month year
// (360 days/year).
//
// The canonical simulation tick is the **in-game hour** (task 040): 24 ticks per day, 8640 per year.
// TICKS_PER_YEAR is reused verbatim as the genealogy `ticksPerYear` (src/json/population.json), so birth/
// death ticks, event-log ticks, and recency windows all live on one axis. Day-level values still exist
// (calendar, HUD, monthly economy) and derive from ticks via dayOfTick().
export const MS_PER_IN_GAME_DAY = 3_600_000; // 1 real hour
export const MINUTES_PER_DAY = 24 * 60; // 1440
export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR; // 360

export const TICKS_PER_DAY = 24; // 1 tick = 1 in-game hour
export const TICKS_PER_MONTH = DAYS_PER_MONTH * TICKS_PER_DAY; // 720
export const TICKS_PER_YEAR = DAYS_PER_YEAR * TICKS_PER_DAY; // 8640
export const MS_PER_TICK = MS_PER_IN_GAME_DAY / TICKS_PER_DAY; // 150_000 (2.5 real minutes)

// Absolute hour-tick index (the canonical simulation/genealogy tick) since the Year 1 epoch.
export function absoluteTickFromElapsed(elapsedMs: number): number {
    return Math.floor(Math.max(0, elapsedMs) / MS_PER_TICK);
}

// Absolute day index since the Year 1 epoch (calendar/HUD granularity).
export function absoluteDayFromElapsed(elapsedMs: number): number {
    return Math.floor(Math.max(0, elapsedMs) / MS_PER_IN_GAME_DAY);
}

// The day a tick falls on. Floor semantics hold for negative ticks too (pre-game bootstrap history lives
// at negative ticks): tick −1 is the last hour of day −1, not day 0.
export function dayOfTick(tick: number): number {
    return Math.floor(tick / TICKS_PER_DAY);
}

// The hour-of-day (0..23) a tick falls on; correct for negative ticks.
export function hourOfTick(tick: number): number {
    return ((tick % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY;
}

// Converts elapsed real milliseconds (since the Year 1 epoch) into a full in-game timestamp.
export function timestampFromElapsed(elapsedMs: number): Timestamp {
    const elapsed = Math.max(0, elapsedMs);
    const absoluteDay = Math.floor(elapsed / MS_PER_IN_GAME_DAY);

    const msIntoDay = elapsed - absoluteDay * MS_PER_IN_GAME_DAY;
    const minuteOfDay = Math.floor((msIntoDay / MS_PER_IN_GAME_DAY) * MINUTES_PER_DAY);
    const hour = Math.floor(minuteOfDay / 60);
    const minute = minuteOfDay % 60;

    const year = Math.floor(absoluteDay / DAYS_PER_YEAR) + 1; // Year 1 onward
    const dayOfYear = absoluteDay % DAYS_PER_YEAR;
    const month = Math.floor(dayOfYear / DAYS_PER_MONTH) + 1;
    const day = (dayOfYear % DAYS_PER_MONTH) + 1;

    return { year, month, day, hour, minute, absoluteDay };
}

// "Year 1, 01/01 09:00"-style label for the HUD. Zero-pads the calendar fields.
export function formatTimestamp(timestamp: Timestamp): string {
    const pad = (value: number): string => value.toString().padStart(2, '0');
    return `Year ${timestamp.year}, ${pad(timestamp.month)}/${pad(timestamp.day)} ${pad(timestamp.hour)}:${pad(timestamp.minute)}`;
}

// "Year 1, 01/01"-style date label for an absolute day index — used to date past happenings.
export function formatDay(absoluteDay: number): string {
    const day = Math.max(0, Math.floor(absoluteDay));
    const year = Math.floor(day / DAYS_PER_YEAR) + 1;
    const dayOfYear = day % DAYS_PER_YEAR;
    const month = Math.floor(dayOfYear / DAYS_PER_MONTH) + 1;
    const dayOfMonth = (dayOfYear % DAYS_PER_MONTH) + 1;
    const pad = (value: number): string => value.toString().padStart(2, '0');
    return `Year ${year}, ${pad(month)}/${pad(dayOfMonth)}`;
}

// "Year 1, 01/01 14:00"-style label for an hour tick — used by the event log and feed (which date entries
// by tick). Pre-epoch ticks (bootstrap history) clamp to the epoch, matching formatDay's behaviour.
export function formatTick(tick: number): string {
    const clamped = Math.max(0, Math.floor(tick));
    const pad = (value: number): string => value.toString().padStart(2, '0');
    return `${formatDay(dayOfTick(clamped))} ${pad(hourOfTick(clamped))}:00`;
}
