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

const JOB_KEYS = ['title', 'salary', 'requiredSkills', 'ranks', 'shiftStart', 'shiftEnd', 'daysOfWeek', 'workActions', 'physicalStrain', 'mentalStrain', 'socialAdmiration'];
const RANK_KEYS = ['rankId', 'label', 'entry', 'requires', 'progresses', 'entryTrainingGrant', 'promotion', 'workActions'];
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
        if (checkArray(issues, `${id}.ranks`, job['ranks'])) {
            const ranks = job['ranks'] as unknown[];
            if (ranks.length === 0) {
                issues.add(`${id}.ranks`, 'a job needs at least one rank (task 064)');
            }
            const rankIds = new Set<string>();
            let entryCount = 0;
            ranks.forEach((rank, index) => {
                const path = `${id}.ranks[${index}]`;
                if (!checkRecord(issues, path, rank)) {
                    return;
                }
                checkUnknownKeys(issues, path, rank, RANK_KEYS);
                if (checkString(issues, `${path}.rankId`, rank['rankId'])) {
                    if (rankIds.has(rank['rankId'] as string)) {
                        issues.add(`${path}.rankId`, `duplicate rank id '${String(rank['rankId'])}'`);
                    }
                    rankIds.add(rank['rankId'] as string);
                }
                checkString(issues, `${path}.label`, rank['label']);
                if (rank['entry'] === true) {
                    entryCount++;
                }
                if ('entryTrainingGrant' in rank && rank['entry'] !== true) {
                    issues.add(`${path}.entryTrainingGrant`, 'training grants are allowed on the ENTRY rank only (task 064)');
                }
                if (checkArray(issues, `${path}.requires`, rank['requires'])) {
                    (rank['requires'] as unknown[]).forEach((requirement, reqIndex) => {
                        const reqPath = `${path}.requires[${reqIndex}]`;
                        if (!checkRecord(issues, reqPath, requirement)) {
                            return;
                        }
                        checkUnknownKeys(issues, reqPath, requirement, ['skill', 'minProficiency']);
                        checkString(issues, `${reqPath}.skill`, requirement['skill']);
                        checkNumber(issues, `${reqPath}.minProficiency`, requirement['minProficiency'], { min: 0.000001, max: 100 });
                    });
                }
                if (checkArray(issues, `${path}.progresses`, rank['progresses'])) {
                    (rank['progresses'] as unknown[]).forEach((progress, progIndex) => {
                        const progPath = `${path}.progresses[${progIndex}]`;
                        if (!checkRecord(issues, progPath, progress)) {
                            return;
                        }
                        checkUnknownKeys(issues, progPath, progress, ['skill', 'multiplier']);
                        checkString(issues, `${progPath}.skill`, progress['skill']);
                        checkNumber(issues, `${progPath}.multiplier`, progress['multiplier'], { min: 0.000001, max: 1 });
                    });
                }
                if ('entryTrainingGrant' in rank && checkRecord(issues, `${path}.entryTrainingGrant`, rank['entryTrainingGrant'])) {
                    const grantSpec = rank['entryTrainingGrant'] as Record<string, unknown>;
                    checkUnknownKeys(issues, `${path}.entryTrainingGrant`, grantSpec, ['grants']);
                    if (checkArray(issues, `${path}.entryTrainingGrant.grants`, grantSpec['grants'])) {
                        (grantSpec['grants'] as unknown[]).forEach((grant, grantIndex) => {
                            const grantPath = `${path}.entryTrainingGrant.grants[${grantIndex}]`;
                            if (!checkRecord(issues, grantPath, grant)) {
                                return;
                            }
                            checkUnknownKeys(issues, grantPath, grant, ['skill', 'toProficiency']);
                            checkString(issues, `${grantPath}.skill`, grant['skill']);
                            checkNumber(issues, `${grantPath}.toProficiency`, grant['toProficiency'], { min: 0.000001, max: 100 });
                        });
                    }
                }
                if ('workActions' in rank && checkRecord(issues, `${path}.workActions`, rank['workActions'])) {
                    const overrides = rank['workActions'] as Record<string, unknown>;
                    checkUnknownKeys(issues, `${path}.workActions`, overrides, ['continuous', 'discrete']);
                    for (const kind of ['continuous', 'discrete']) {
                        if (!(kind in overrides) || !checkArray(issues, `${path}.workActions.${kind}`, overrides[kind])) {
                            continue;
                        }
                        (overrides[kind] as unknown[]).forEach((spec, specIndex) => {
                            const specPath = `${path}.workActions.${kind}[${specIndex}]`;
                            if (!checkRecord(issues, specPath, spec)) {
                                return;
                            }
                            checkUnknownKeys(issues, specPath, spec, ['action', 'chancePerTick', 'maxPerTick', 'cooldownTicks']);
                            checkString(issues, `${specPath}.action`, spec['action']);
                            if ('chancePerTick' in spec) {
                                checkNumber(issues, `${specPath}.chancePerTick`, spec['chancePerTick'], { min: 0, max: 1 });
                            }
                        });
                    }
                }
                if ('promotion' in rank && checkRecord(issues, `${path}.promotion`, rank['promotion'])) {
                    const promotion = rank['promotion'] as Record<string, unknown>;
                    checkUnknownKeys(issues, `${path}.promotion`, promotion, ['evaluateEveryWorkDays', 'minWorkDaysInRank']);
                    for (const bound of ['evaluateEveryWorkDays', 'minWorkDaysInRank']) {
                        if (bound in promotion) {
                            checkNumber(issues, `${path}.promotion.${bound}`, promotion[bound], { min: 1, integer: true });
                        }
                    }
                }
            });
            if (entryCount !== 1) {
                issues.add(`${id}.ranks`, `exactly one rank must carry entry: true (found ${entryCount})`);
            }
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

        // Rank semantics (task 064): skill refs exist; requiredSkills mirrors the entry rank; the training
        // grant's dependency closure is complete; and the KEYSTONE reachability rule - the entry rank must
        // be satisfiable by a fresh 18-year-old (every basic at the school baseline 60) plus its own grant.
        const entry = (job.ranks ?? []).find(rank => rank.entry);
        for (const [rankIndex, rank] of (job.ranks ?? []).entries()) {
            const rankPath = `${id}.ranks[${rankIndex}]`;
            for (const requirement of rank.requires) {
                if (!(requirement.skill in skills)) {
                    issues.add(`${rankPath}.requires`, `unknown skill "${requirement.skill}"`);
                }
            }
            for (const progress of rank.progresses) {
                if (!(progress.skill in skills)) {
                    issues.add(`${rankPath}.progresses`, `unknown skill "${progress.skill}"`);
                }
            }
            for (const grant of rank.entryTrainingGrant?.grants ?? []) {
                if (!(grant.skill in skills)) {
                    issues.add(`${rankPath}.entryTrainingGrant`, `unknown skill "${grant.skill}"`);
                }
            }
        }
        // Self-climbing ladder rule (task 066): every skill a non-entry rank requires must be a school basic,
        // covered by the entry grant at the required floor, or PROGRESSED by an earlier rank — otherwise the
        // ladder silently stalls (nobody can ever qualify for the rung).
        {
            const entryFloor = new Map(((job.ranks ?? []).find(rank => rank.entry)?.entryTrainingGrant?.grants ?? []).map(grant => [grant.skill, grant.toProficiency]));
            const skillDefs = skills as Record<string, { basic?: boolean }>;
            const progressedBefore = new Set<string>();
            for (const [rankIndex, rank] of (job.ranks ?? []).entries()) {
                if (!rank.entry) {
                    for (const requirement of rank.requires) {
                        const basic = skillDefs[requirement.skill]?.basic === true && requirement.minProficiency <= 60;
                        const granted = (entryFloor.get(requirement.skill) ?? 0) >= requirement.minProficiency;
                        if (requirement.skill in skillDefs && !basic && !granted && !progressedBefore.has(requirement.skill)) {
                            issues.add(`${id}.ranks[${rankIndex}]`, `requirement "${requirement.skill}" is not progressed by any earlier rank (self-climbing ladder rule, task 066)`);
                        }
                    }
                }
                for (const progress of rank.progresses) {
                    progressedBefore.add(progress.skill);
                }
            }
        }
        // Rank work-action overrides must reference real actions of the matching kind (like the job-level
        // repertoire).
        for (const [rankIndex, rank] of (job.ranks ?? []).entries()) {
            for (const kind of ['continuous', 'discrete'] as const) {
                (rank.workActions?.[kind] ?? []).forEach((spec, specIndex) => {
                    const specPath = `${id}.ranks[${rankIndex}].workActions.${kind}[${specIndex}].action`;
                    const target = actions[spec.action];
                    if (!target) {
                        issues.add(specPath, `references unknown action "${spec.action}"`);
                    } else if (target.type !== kind) {
                        issues.add(specPath, `"${spec.action}" is not a ${kind} action`);
                    }
                });
            }
        }
        if (entry) {
            const entrySkills = new Set(entry.requires.map(requirement => requirement.skill));
            const declared = new Set(job.requiredSkills);
            if (entrySkills.size !== declared.size || ![...entrySkills].every(skill => declared.has(skill))) {
                issues.add(`${id}.requiredSkills`, "must equal the entry rank's required skills (one source of truth)");
            }
            const grantFloor = new Map((entry.entryTrainingGrant?.grants ?? []).map(grant => [grant.skill, grant.toProficiency]));
            const skillDef = (skillId: string): { basic?: boolean; dependencies?: { skill: string; minProficiency: number }[] } | undefined =>
                (skills as Record<string, { basic?: boolean; dependencies?: { skill: string; minProficiency: number }[] }>)[skillId];
            // Reachability: each entry requirement is grant-covered, or a basic within the school baseline.
            for (const requirement of entry.requires) {
                const definition = skillDef(requirement.skill);
                const grantCovers = (grantFloor.get(requirement.skill) ?? 0) >= requirement.minProficiency;
                const basicCovers = definition?.basic === true && requirement.minProficiency <= 60;
                if (definition && !grantCovers && !basicCovers) {
                    issues.add(`${id}.ranks`, `entry requirement "${requirement.skill}" is unreachable for a fresh graduate: not covered by the training grant and not a basic within the school baseline (task 064)`);
                }
            }
            // Grant closure completeness: every dependency of a granted skill is a basic within the school
            // baseline or itself granted at/above the threshold.
            for (const grant of entry.entryTrainingGrant?.grants ?? []) {
                for (const dependency of skillDef(grant.skill)?.dependencies ?? []) {
                    const depDef = skillDef(dependency.skill);
                    const grantCovers = (grantFloor.get(dependency.skill) ?? 0) >= dependency.minProficiency;
                    const basicCovers = depDef?.basic === true && dependency.minProficiency <= 60;
                    if (!grantCovers && !basicCovers) {
                        issues.add(`${id}.ranks`, `training grant for "${grant.skill}" has an unsatisfied dependency "${dependency.skill}" (not granted, not a school basic) - the closure must be complete (task 064)`);
                    }
                }
            }
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
