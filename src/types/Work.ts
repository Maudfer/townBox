// Skill identifiers. These double as person skills (WorkLife) and job requirements (jobs.json
// `requiredSkills` reference these string values). Skills stay simple strings — no manifest of their own —
// per the procedural simulation framework design (docs/tasks/013).
export enum JobRequirements {
    ConstructionSkill = "ConstructionSkill",
    RetailSkill = "RetailSkill",
    LogisticsSkill = "LogisticsSkill",
    CleaningSkill = "CleaningSkill",
    ManagementSkill = "ManagementSkill",
    MedicalSkill = "MedicalSkill",
    TeachingSkill = "TeachingSkill",
    CookingSkill = "CookingSkill",
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