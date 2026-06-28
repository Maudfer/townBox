import Building from 'game/Building';
import { JobPosition, JobRequirements, WorkInfo } from 'types/Work';

export default class WorkLife {
    private job: JobPosition | null;
    // The building the person is employed at (a Workplace, held as its Building base so WorkLife stays
    // decoupled from Workplace). It is the commute destination (task 006); set on hire, cleared on layoff.
    private workplace: Building | null;
    private skills: JobRequirements[];

    constructor() {
        this.job = null;
        this.workplace = null;
        // Skills start empty; materialized people are given a deterministic set at materialization
        // (City + util/skills.ts, task 014). Manually-created/test people have no skills until set.
        this.skills = [];
    }

    public getWorkplace(): Building | null {
        return this.workplace;
    }

    public setWorkplace(workplace: Building | null): void {
        this.workplace = workplace;
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

    // Clears employment (e.g. on layoff/retirement): the job and the employer reference go together.
    public clearJob(): void {
        this.job = null;
        this.workplace = null;
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
