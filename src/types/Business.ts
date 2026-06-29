import { Curve } from 'util/curve';
import { JobPosition } from 'types/Work';

// Engine A (generative blueprints) data model for the procedural simulation framework
// (docs/tasks/013-procedural-simulation-framework_DONE.md §4, §6). A blueprint describes *how to generate* a
// business of a given size; a BusinessInstance is the concrete result placed on a Workplace. Jobs are a flat
// reference table both this engine and (later) Engine B events read.

// A single job definition (src/json/jobs.json). `salary` is a flat number for now (a Curve over business
// size / city economy is a design-for extension). The strain/admiration fields are design-for: they are
// consumed by Engine B probability gradients in later phases and are optional today.
export interface JobDefinition {
    title: string;
    salary: number;
    requiredSkills: string[]; // skill ids; align with the JobRequirements enum (types/Work.ts)
    shiftStart?: number; // minutes since midnight; defaults to DEFAULT_SHIFT_START
    shiftEnd?: number; // minutes since midnight; defaults to DEFAULT_SHIFT_END
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
    size: { min: number; max: number }; // drawn uniformly at placement (distribution weighting is a future extension)
    jobs: Record<string, BusinessJobSpec>; // jobId -> position count curve
    materialsPerMonth?: Record<string, { qty: Curve }>; // design-for (consumed once the economy lands)
    products?: Record<string, unknown>; // deferred per the design; slot reserved
    economics?: { priceMarkup?: number; fixedCostsPerMonth?: Curve }; // design-for
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
}
