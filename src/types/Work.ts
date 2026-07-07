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
    // Added in task 034 to staff the expanded business roster (033b).
    HospitalitySkill = "HospitalitySkill",
    FinanceSkill = "FinanceSkill",
    EngineeringSkill = "EngineeringSkill",
    SecuritySkill = "SecuritySkill",
    DrivingSkill = "DrivingSkill",
    BeautySkill = "BeautySkill",
    MechanicalSkill = "MechanicalSkill",
    FitnessSkill = "FitnessSkill",
}

export type JobRequirement = JobRequirements;

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
    skills: JobRequirements[];
};

// How many skills a person is given, by life stage. Adults carry a small specialised set; minors (below the
// working age) carry few/none and acquire more later (education events, task 032).
export interface SkillCountRange {
    minSkills: number;
    maxSkills: number;
}

// Tunable inputs to deterministic skill assignment (src/json/skills.json). `weights` is keyed by
// JobRequirements value → relative likelihood of that skill being drawn. See util/skills.ts.
export interface SkillAssignmentParams {
    workingAgeYears: number;
    adult: SkillCountRange;
    minor: SkillCountRange;
    weights: Record<string, number>;
}