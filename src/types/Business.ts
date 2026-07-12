import { JobPosition } from 'types/Work';
import { Curve } from 'util/curve';

// Engine A (generative blueprints) data model for the procedural simulation framework
// (docs/tasks/013-procedural-simulation-framework_DONE.md §4, §6). A blueprint describes *how to generate* a
// business of a given size; a BusinessInstance is the concrete result placed on a Workplace. Jobs are a flat
// reference table both this engine and (later) Engine B events read.

// A single job definition (src/json/jobs.json). `salary` is a flat number for now (a Curve over business
// size / city economy is a design-for extension). The strain/admiration fields are design-for: they are
// consumed by Engine B probability gradients in later phases and are optional today.
// How often a work action is proposed while on duty (task 045): the same pooling shape as the Action
// engine's pool children, so the Job Orchestrator (047) reuses that machinery.
export interface WorkActionSpec {
    action: string; // action id in actions.json
    chancePerTick?: number; // discrete proposals: 0..1 per tick on duty (defaults to 1 for continuous)
    maxPerTick?: number;
    cooldownTicks?: number;
}

// A rung on a job's career ladder (task 064). Declaration order = progression order; exactly one rank per
// job carries `entry: true` (validator-enforced). Requirements are PROFICIENCY thresholds against the
// SkillBook; `progresses` declares which skills working this rank develops and how fast (065 consumes).
// `entryTrainingGrant` is the EXPLICIT, TEMPORARY College/licensing shortcut (056/064): on a successful
// entry-level hire — and only then — the declared skills are granted atomically (dependency closure
// validated first); it exists so professions with non-basic requirements stay reachable for fresh
// 18-year-olds until a real education/certification/apprenticeship system replaces it. Never fold this
// into generic matching.
export interface JobRank {
    rankId: string;
    label: string;
    entry?: boolean;
    requires: { skill: string; minProficiency: number }[];
    progresses: { skill: string; multiplier: number }[]; // per completed work day, x WORK_DAILY_GAIN (065)
    entryTrainingGrant?: { grants: { skill: string; toProficiency: number }[] }; // entry rank only
    promotion?: { evaluateEveryWorkDays?: number; minWorkDaysInRank?: number }; // 065 consumes
    // Optional rank-specific work-action overrides (066 authors them; the Job Orchestrator consults them).
    workActions?: {
        continuous?: WorkActionSpec[];
        discrete?: WorkActionSpec[];
    };
}

export interface JobDefinition {
    title: string;
    salary: number;
    requiredSkills: string[]; // skill ids; must equal the entry rank's required skills (validator-enforced)
    // The career ladder (task 064). Non-empty; exactly one entry rank; declaration order = progression order.
    ranks: JobRank[];
    shiftStart: number; // minutes since midnight (task 045: authored explicitly, validator-required)
    shiftEnd: number; // minutes since midnight; < shiftStart crosses midnight
    daysOfWeek: string[]; // Weekday names ('mon'..'sun'), non-empty (task 045)
    // The job's work-Action repertoire (task 045): what a person on duty does, proposed by the Job
    // Orchestrator (047) under Brain arbitration (046). Continuous = the on-duty activity; discrete = the
    // flavorful one-shot pool ("Misplaced a document").
    workActions: {
        continuous: WorkActionSpec[];
        discrete: WorkActionSpec[];
    };
    physicalStrain?: number; // design-for (0..1)
    mentalStrain?: number; // design-for (0..1)
    socialAdmiration?: number; // design-for (0..1)
}

export type JobTable = Record<string, JobDefinition>;

// How many of a given job a business needs, as a curve over the business size.
export interface BusinessJobSpec {
    count: Curve;
}

// A business blueprint (src/json/businesses.json): the probabilistic/scaling recipe for a line of work.
export interface BusinessBlueprint {
    friendlyName: string; // display label for the line of work, e.g. "Super Market"
    category: string;
    // Placement/context tags this business type contains (task 069; json/placement.json vocabulary).
    tags?: string[]; // demand category it serves (json/demand.json), e.g. "groceries" — task 033
    size: { min: number; max: number }; // drawn uniformly at placement (distribution weighting is a future extension)
    jobs: Record<string, BusinessJobSpec>; // jobId -> position count curve
    materialsPerUnit?: Record<string, number>; // input material amounts to produce one unit of output (task 033)
    products?: Record<string, number>; // materials this business produces for *other* businesses (B2B supply
                                       // chain, task 035): material id -> units one employee outputs per month
    economics?: { priceMarkup?: number; fixedCostsPerMonth?: Curve }; // priceMarkup = price premium over the category base (task 033)
}

export type BusinessBlueprintTable = Record<string, BusinessBlueprint>;

// A concrete business generated for a placed Workplace. `positions` is the full establishment at this size;
// the Workplace tracks which are still open vs. filled (open/filled reconciliation across save/load is
// formalized with slot identity in phase 013d, when hiring becomes an event).
export interface BusinessInstance {
    blueprintKey: string;
    name: string; // generated business name (faker)
    lineOfWork: string; // blueprint.friendlyName
    size: number;
    positions: JobPosition[];
    lastPnl?: number; // last month's profit/loss (task 020); shown in the inspector
    profitStreak?: number; // consecutive profitable (+) or loss (−) months; drives growth (task 020)
    insolventMonths?: number; // consecutive months the balance has stayed below the debt floor; drives bankruptcy (task 021)
}
