import { Timestamp } from 'types/Time';

// Pure in-game time math, independent of Phaser so it is unit-testable. The scale is fixed by design:
// one in-game day takes one real hour. The calendar is a simple, regular 30-day month / 12-month year
// (360 days/year) — this DAYS_PER_YEAR is reused verbatim as the genealogy `ticksPerYear`
// (src/json/population.json), so a ~80-year lifespan spans a sensible number of day-ticks.
export const MS_PER_IN_GAME_DAY = 3_600_000; // 1 real hour
export const MINUTES_PER_DAY = 24 * 60; // 1440
export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR; // 360

// Absolute day index (the genealogy tick) for an elapsed real-time duration since the game/save started.
export function absoluteDayFromElapsed(elapsedMs: number): number {
    return Math.floor(Math.max(0, elapsedMs) / MS_PER_IN_GAME_DAY);
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

// "Year 1, 01/01"-style date label for an absolute day index (a genealogy tick) — used by the event log
// (task 027) to date past events. Pure and unit-testable.
export function formatDay(absoluteDay: number): string {
    const day = Math.max(0, Math.floor(absoluteDay));
    const year = Math.floor(day / DAYS_PER_YEAR) + 1;
    const dayOfYear = day % DAYS_PER_YEAR;
    const month = Math.floor(dayOfYear / DAYS_PER_MONTH) + 1;
    const dayOfMonth = (dayOfYear % DAYS_PER_MONTH) + 1;
    const pad = (value: number): string => value.toString().padStart(2, '0');
    return `Year ${year}, ${pad(month)}/${pad(dayOfMonth)}`;
}
