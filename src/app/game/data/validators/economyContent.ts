// Validators for the Engine A / economy content family: jobs, businesses, materials, demand.
// The semantic cross-checks port test/contentConsistency.test.ts (tasks 034 + 033b) into the registry so the
// same referential integrity that gated CI now also gates game boot. (Skills moved to their own manifest and
// validator family — validators/skills.ts, task 059; jobs cross-check against that manifest here.)

import { IssueCollector } from 'game/data/registry';
import { checkArray, checkNumber, checkRecord, checkString, checkUnknownKeys } from 'game/data/checks';
import { validateCurve } from 'game/data/substrate';
import { BusinessBlueprintTable, JobTable } from 'types/Business';
import { DemandTable } from 'types/Demand';
import { MINUTES_PER_DAY } from 'util/time';

const JOB_KEYS = ['title', 'salary', 'requiredSkills', 'shiftStart', 'shiftEnd', 'daysOfWeek', 'workActions', 'physicalStrain', 'mentalStrain', 'socialAdmiration'];
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export function validateJobsStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, '', data)) {
        return;
    }
    for (const [id, job] of Object.entries(data)) {
        if (!checkRecord(issues, id, job)) {
            continue;
        }
        checkUnknownKeys(issues, id, job, JOB_KEYS);
        checkString(issues, `${id}.title`, job['title']);
        checkNumber(issues, `${id}.salary`, job['salary'], { min: 1 });
        if (checkArray(issues, `${id}.requiredSkills`, job['requiredSkills'])) {
            (job['requiredSkills'] as unknown[]).forEach((skill, index) => checkString(issues, `${id}.requiredSkills[${index}]`, skill));
        }
        // Shift schedules are authored explicitly since task 045 (no more silent 09:00–17:00 defaults).
        // shiftEnd < shiftStart is legal: the shift crosses midnight and belongs to its start day.
        for (const field of ['shiftStart', 'shiftEnd']) {
            checkNumber(issues, `${id}.${field}`, job[field], { min: 0, max: MINUTES_PER_DAY - 1, integer: true });
        }
        if (checkArray(issues, `${id}.daysOfWeek`, job['daysOfWeek'])) {
            const days = job['daysOfWeek'] as unknown[];
            if (days.length === 0) {
                issues.add(`${id}.daysOfWeek`, 'a job needs at least one working day');
            }
            days.forEach((day, index) => {
                if (typeof day !== 'string' || !WEEKDAYS.includes(day)) {
                    issues.add(`${id}.daysOfWeek[${index}]`, `expected one of [${WEEKDAYS.join(', ')}]`);
                }
            });
            if (new Set(days).size !== days.length) {
                issues.add(`${id}.daysOfWeek`, 'duplicate weekday');
            }
        }
        if (checkRecord(issues, `${id}.workActions`, job['workActions'])) {
            const workActions = job['workActions'] as Record<string, unknown>;
            checkUnknownKeys(issues, `${id}.workActions`, workActions, ['continuous', 'discrete']);
            for (const kind of ['continuous', 'discrete']) {
                if (!checkArray(issues, `${id}.workActions.${kind}`, workActions[kind])) {
                    continue;
                }
                const specs = workActions[kind] as unknown[];
                if (specs.length === 0) {
                    issues.add(`${id}.workActions.${kind}`, `a job needs at least one ${kind} work action (task 045)`);
                }
                specs.forEach((spec, index) => {
                    const path = `${id}.workActions.${kind}[${index}]`;
                    if (!checkRecord(issues, path, spec)) {
                        return;
                    }
                    checkUnknownKeys(issues, path, spec, ['action', 'chancePerTick', 'maxPerTick', 'cooldownTicks']);
                    checkString(issues, `${path}.action`, spec['action']);
                    if ('chancePerTick' in spec) {
                        checkNumber(issues, `${path}.chancePerTick`, spec['chancePerTick'], { min: 0, max: 1 });
                    }
                    for (const bound of ['maxPerTick', 'cooldownTicks']) {
                        if (bound in spec) {
                            checkNumber(issues, `${path}.${bound}`, spec[bound], { min: 1, integer: true });
                        }
                    }
                });
            }
        }
        for (const field of ['physicalStrain', 'mentalStrain', 'socialAdmiration']) {
            if (field in job) {
                checkNumber(issues, `${id}.${field}`, job[field], { min: 0, max: 1 });
            }
        }
    }
}

export function validateJobsSemantics(data: unknown, peers: Record<string, unknown>, issues: IssueCollector): void {
    const jobs = data as JobTable;
    const skills = (peers['skills'] ?? {}) as Record<string, unknown>;
    const actions = (peers['actions'] ?? {}) as Record<string, { type?: string }>;
    for (const [id, job] of Object.entries(jobs)) {
        // Work-action declarations (task 045) must reference real actions of the matching kind.
        for (const kind of ['continuous', 'discrete'] as const) {
            (job.workActions?.[kind] ?? []).forEach((spec, index) => {
                const path = `${id}.workActions.${kind}[${index}].action`;
                const target = actions[spec.action];
                if (!target) {
                    issues.add(path, `references unknown action "${spec.action}"`);
                } else if (target.type !== kind) {
                    issues.add(path, `"${spec.action}" is not a ${kind} action`);
                }
            });
        }
        job.requiredSkills.forEach((skill, index) => {
            const path = `${id}.requiredSkills[${index}]`;
            if (!(skill in skills)) {
                issues.add(path, `unknown skill "${skill}" (not in skills.json)`);
            }
        });
        if (job.requiredSkills.length === 0) {
            issues.add(`${id}.requiredSkills`, 'a job needs at least one required skill');
        }
    }
}

const BLUEPRINT_KEYS = ['friendlyName', 'category', 'size', 'jobs', 'materialsPerUnit', 'products', 'economics'];

export function validateBusinessesStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, '', data)) {
        return;
    }
    for (const [id, blueprint] of Object.entries(data)) {
        if (!checkRecord(issues, id, blueprint)) {
            continue;
        }
        checkUnknownKeys(issues, id, blueprint, BLUEPRINT_KEYS);
        checkString(issues, `${id}.friendlyName`, blueprint['friendlyName']);
        checkString(issues, `${id}.category`, blueprint['category']);
        if (checkRecord(issues, `${id}.size`, blueprint['size'])) {
            const size = blueprint['size'] as Record<string, unknown>;
            checkUnknownKeys(issues, `${id}.size`, size, ['min', 'max']);
            const minOk = checkNumber(issues, `${id}.size.min`, size['min'], { min: 1, integer: true });
            const maxOk = checkNumber(issues, `${id}.size.max`, size['max'], { min: 1, integer: true });
            if (minOk && maxOk && (size['min'] as number) > (size['max'] as number)) {
                issues.add(`${id}.size`, `min (${size['min']}) must be <= max (${size['max']})`);
            }
        }
        if (checkRecord(issues, `${id}.jobs`, blueprint['jobs'])) {
            const jobs = blueprint['jobs'] as Record<string, unknown>;
            if (Object.keys(jobs).length === 0) {
                issues.add(`${id}.jobs`, 'a blueprint needs at least one job');
            }
            for (const [jobId, spec] of Object.entries(jobs)) {
                const path = `${id}.jobs.${jobId}`;
                if (!checkRecord(issues, path, spec)) {
                    continue;
                }
                checkUnknownKeys(issues, path, spec, ['count']);
                validateCurve(issues, `${path}.count`, spec['count']);
            }
        }
        for (const field of ['materialsPerUnit', 'products']) {
            if (!(field in blueprint)) {
                continue;
            }
            if (checkRecord(issues, `${id}.${field}`, blueprint[field])) {
                for (const [material, amount] of Object.entries(blueprint[field] as Record<string, unknown>)) {
                    checkNumber(issues, `${id}.${field}.${material}`, amount, { min: 0 });
                }
            }
        }
        if ('economics' in blueprint && checkRecord(issues, `${id}.economics`, blueprint['economics'])) {
            const economics = blueprint['economics'] as Record<string, unknown>;
            checkUnknownKeys(issues, `${id}.economics`, economics, ['priceMarkup', 'fixedCostsPerMonth']);
            if ('priceMarkup' in economics) {
                checkNumber(issues, `${id}.economics.priceMarkup`, economics['priceMarkup'], { min: 0 });
            }
            if ('fixedCostsPerMonth' in economics) {
                validateCurve(issues, `${id}.economics.fixedCostsPerMonth`, economics['fixedCostsPerMonth']);
            }
        }
    }
}

export function validateBusinessesSemantics(data: unknown, peers: Record<string, unknown>, issues: IssueCollector): void {
    const blueprints = data as BusinessBlueprintTable;
    const jobs = (peers['jobs'] ?? {}) as JobTable;
    const demand = (peers['demand'] ?? {}) as DemandTable;
    const materials = (peers['materials'] ?? {}) as Record<string, unknown>;

    const consumed = new Set<string>();
    for (const blueprint of Object.values(blueprints)) {
        for (const material of Object.keys(blueprint.materialsPerUnit ?? {})) {
            consumed.add(material);
        }
    }

    for (const [id, blueprint] of Object.entries(blueprints)) {
        for (const jobId of Object.keys(blueprint.jobs)) {
            if (!(jobId in jobs)) {
                issues.add(`${id}.jobs.${jobId}`, 'references a job not defined in jobs.json');
            }
        }
        if (!(blueprint.category in demand)) {
            issues.add(`${id}.category`, `unknown demand category "${blueprint.category}"`);
        }
        for (const material of Object.keys(blueprint.materialsPerUnit ?? {})) {
            if (!(material in materials)) {
                issues.add(`${id}.materialsPerUnit.${material}`, 'references a material not defined in materials.json');
            }
        }
        for (const material of Object.keys(blueprint.products ?? {})) {
            if (!(material in materials)) {
                issues.add(`${id}.products.${material}`, 'references a material not defined in materials.json');
            } else if (!consumed.has(material)) {
                // Orphan production: a producer making something no blueprint buys earns nothing (task 035).
                issues.add(`${id}.products.${material}`, 'produced material is consumed by no blueprint');
            }
        }
    }
}

export function validateMaterialsStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, '', data)) {
        return;
    }
    for (const [id, material] of Object.entries(data)) {
        if (!checkRecord(issues, id, material)) {
            continue;
        }
        checkUnknownKeys(issues, id, material, ['label', 'basePrice']);
        checkString(issues, `${id}.label`, material['label']);
        checkNumber(issues, `${id}.basePrice`, material['basePrice'], { min: 0 });
    }
}

export function validateDemandStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, '', data)) {
        return;
    }
    for (const [category, spec] of Object.entries(data)) {
        if (!checkRecord(issues, category, spec)) {
            continue;
        }
        checkUnknownKeys(issues, category, spec, ['perCapita', 'throughputPerEmployee', 'pricePerUnit']);
        checkNumber(issues, `${category}.perCapita`, spec['perCapita'], { min: 0 });
        checkNumber(issues, `${category}.throughputPerEmployee`, spec['throughputPerEmployee'], { min: 0 });
        checkNumber(issues, `${category}.pricePerUnit`, spec['pricePerUnit'], { min: 0 });
    }
}

export function validateDemandSemantics(data: unknown, peers: Record<string, unknown>, issues: IssueCollector): void {
    const demand = data as DemandTable;
    const blueprints = (peers['businesses'] ?? {}) as BusinessBlueprintTable;
    for (const category of Object.keys(demand)) {
        const served = Object.values(blueprints).some(blueprint => blueprint.category === category);
        if (!served) {
            issues.add(category, 'demand category is served by no business blueprint');
        }
    }
}
