import { evaluateCurve } from 'util/curve';
import { JobPosition, JobRequirements, DEFAULT_SHIFT_START, DEFAULT_SHIFT_END } from 'types/Work';
import { BusinessBlueprint, BusinessInstance, JobDefinition, JobTable } from 'types/Business';

// Engine A — generative business blueprints (docs/tasks/013 §4). generateBusiness is a pure function of its
// inputs: given a blueprint, the job reference table, a (pre-generated) name and a size, it expands each
// job's position-count curve at that size into concrete JobPositions. Same inputs ⇒ identical instance, so
// it is unit-testable without a scene and reproducible across save/load.

function toJobPosition(def: JobDefinition): JobPosition {
    return {
        title: def.title,
        salary: def.salary,
        // Skill ids are the JobRequirements enum's string values; jobs.json keeps them aligned.
        requirements: def.requiredSkills as JobRequirements[],
        shiftStart: def.shiftStart ?? DEFAULT_SHIFT_START,
        shiftEnd: def.shiftEnd ?? DEFAULT_SHIFT_END,
    };
}

export function generateBusiness(
    blueprintKey: string,
    blueprint: BusinessBlueprint,
    jobs: JobTable,
    name: string,
    size: number
): BusinessInstance {
    const positions: JobPosition[] = [];

    // Insertion order of the blueprint's jobs is deterministic, so the expanded positions are stable.
    for (const [jobId, spec] of Object.entries(blueprint.jobs)) {
        const def = jobs[jobId];
        if (!def) {
            // A blueprint referencing an unknown job is a data error; skip it rather than crash. Validation
            // tooling (a future compiler pass, mirroring the event compiler) can surface these at load.
            continue;
        }
        const count = Math.max(0, Math.round(evaluateCurve(spec.count, size)));
        for (let i = 0; i < count; i++) {
            positions.push(toJobPosition(def));
        }
    }

    return {
        blueprintKey,
        name,
        lineOfWork: blueprint.friendlyName,
        size,
        positions,
    };
}
