import Building from 'game/world/Building';
import { JobPosition, WorkInfo } from 'types/Work';

// A person's employment: the job and the employer building. Skills no longer live here — proficiency-bearing
// records moved to the central SkillBook (game/SkillBook.ts, tasks 059–062), keyed by pool personId so they
// survive de/re-materialization and work off-map.
export default class WorkLife {
    private job: JobPosition | null;
    // The building the person is employed at (a Workplace, held as its Building base so WorkLife stays
    // decoupled from Workplace). It is the commute destination (task 006); set on hire, cleared on layoff.
    private workplace: Building | null;

    constructor() {
        this.job = null;
        this.workplace = null;
    }

    public getWorkplace(): Building | null {
        return this.workplace;
    }

    public setWorkplace(workplace: Building | null): void {
        this.workplace = workplace;
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

    getInfo(): WorkInfo {
        return {
            job: this.job,
        }
    }
}
