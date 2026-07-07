// Skill identifiers are plain skill ids from the skill manifest (json/skills.json, task 059) — the closed
// 16-member `JobRequirements` enum is retired (tasks 059–062). jobs.json `requiredSkills` reference manifest
// ids; the data validators enforce the cross-file integrity the enum used to provide, and proficiency-bearing
// records live in the central SkillBook (game/SkillBook.ts), not on WorkLife.
export type JobRequirement = string;

// Shift times are minutes since midnight (0..1439), so they compare directly against the clock's
// time-of-day. Since task 045 every job AUTHORS its shift explicitly (the validator requires it); these
// defaults only backstop legacy saves whose serialized positions predate the schema.
export const DEFAULT_SHIFT_START = 9 * 60; // 09:00
export const DEFAULT_SHIFT_END = 17 * 60; // 17:00

// Day-of-week names as authored in jobs.json (task 045); indexes align with util/time WEEKDAY_NAMES
// (0 = Monday). A shift with shiftEnd < shiftStart crosses midnight and belongs to its START day.
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export type JobPosition = {
    title: string;
    salary: number;
    requirements: JobRequirement[];
    shiftStart: number; // minutes since midnight
    shiftEnd: number; // minutes since midnight; < shiftStart means the shift crosses midnight
    daysOfWeek?: Weekday[]; // absent (legacy saves) = every day
};

export type WorkInfo = {
    job: JobPosition | null;
};
