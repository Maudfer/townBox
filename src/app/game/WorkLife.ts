import { JobPosition, JobRequirements, WorkInfo } from 'types/Work';

export default class WorkLife {
    private job: JobPosition | null;
    private skills: JobRequirements[];

    constructor() {
        this.job = null;
        // Skills start empty; materialized people are given a deterministic set at materialization
        // (City + util/skills.ts, task 014). Manually-created/test people have no skills until set.
        this.skills = [];
    }

    public getSkills(): JobRequirements[] {
        return this.skills;
    }

    // Adds a skill if not already present. The hook education events (task 032) use to grant skills over time.
    public addSkill(skill: JobRequirements): void {
        if (!this.skills.includes(skill)) {
            this.skills.push(skill);
        }
    }

    public getJob(): JobPosition | null {
        return this.job;
    }

    public setJob(job: JobPosition): void {
        this.job = job;
    }

    public setSkills(skills: JobRequirements[]): void {
        this.skills = skills;
    }

    getInfo(): WorkInfo {
        return {
            job: this.job,
            skills: this.skills,
        }
    }
}
