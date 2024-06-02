export enum JobRequirements {
    ConstructionSkill = "ConstructionSkill",
}

export type JobRequirement = JobRequirements;

export type JobPosition = {
    title: string;
    salary: number;
    requirements: JobRequirement[];
};

export type WorkInfo = {
    job: JobPosition | null;
    skills: JobRequirements[];
};