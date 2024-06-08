import { JobPosition, JobRequirements, WorkInfo } from 'types/Work';

export default class WorkLife {
    private job: JobPosition | null;
    private skills: JobRequirements[];

    constructor() {
        this.job = null;
        this.skills = [];

        this.skills.push(JobRequirements.ConstructionSkill);
    }

    public getSkills(): JobRequirements[] {
        return this.skills;
    }

    public getJob(): JobPosition | null {
        return this.job;
    }

    public setJob(job: JobPosition): void {
        this.job = job;
    }

    getInfo(): WorkInfo {
        return {
            job: this.job,
            skills: this.skills,
        }
    }
}
