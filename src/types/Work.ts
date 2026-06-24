export enum JobRequirements {
    ConstructionSkill = "ConstructionSkill",
}

export type JobRequirement = JobRequirements;

// Shift times are minutes since midnight (0..1439), so they compare directly against the clock's
// time-of-day. Commute scheduling (006) will react to these; this task only adds the data + defaults.
export const DEFAULT_SHIFT_START = 9 * 60; // 09:00
export const DEFAULT_SHIFT_END = 17 * 60; // 17:00

export type JobPosition = {
    title: string;
    salary: number;
    requirements: JobRequirement[];
    shiftStart: number; // minutes since midnight
    shiftEnd: number; // minutes since midnight
};

export type WorkInfo = {
    job: JobPosition | null;
    skills: JobRequirements[];
};