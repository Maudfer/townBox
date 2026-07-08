// Validators for the skill manifest (json/skills.json) and initialization config (json/skillInit.json) —
// tasks 059–062. Structural: shapes, the NAMING CONTRACT (no `Skill`-suffix ids anywhere; non-basic skills
// must be specific abilities, never broad fields of study; basics have no dependencies). Semantic: the
// dependency DAG compiles (no cycles / missing refs / bad thresholds — promoted from util/skillGraph), and
// the ORPHAN RULE (task 061): every non-basic skill must be consumed — referenced by a job requirement, an
// event grant, a dependency of a consumed skill, or explicitly tagged 'flavor' (initialization variety pool).

import { IssueCollector } from 'game/data/registry';
import { checkArray, checkBoolean, checkNumber, checkRecord, checkString, checkUnknownKeys, isRecord } from 'game/data/checks';
import { compileSkills } from 'util/skillGraph';
import { SkillManifest } from 'types/Skill';

const SKILL_KEYS = ['label', 'basic', 'dependencies', 'tags'];
const DEPENDENCY_KEYS = ['skill', 'minProficiency'];
const ID_PATTERN = /^[a-z][a-z0-9_]*$/;

// Broad fields of study a NON-basic skill must not be named after (the "specific abilities" contract).
// Extend deliberately as families grow; basics are exempt (they ARE fields of study by design).
const FIELD_OF_STUDY_DENYLIST = new Set([
    'engineering', 'medicine', 'finance', 'economics', 'law', 'science', 'retail', 'cleaning',
    'construction', 'logistics', 'hospitality', 'cooking', 'driving', 'mechanics', 'security', 'beauty',
    'management', 'teaching', 'fitness', 'accounting', 'nursing', 'carpentry',
]);

export function validateSkillsStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, '', data)) {
        return;
    }
    for (const [id, definition] of Object.entries(data)) {
        if (!ID_PATTERN.test(id)) {
            issues.add(id, 'skill ids must be snake_case');
        }
        if (/skill$/i.test(id)) {
            issues.add(id, 'legacy naming: skill ids must not end in "Skill"');
        }
        if (!checkRecord(issues, id, definition)) {
            continue;
        }
        checkUnknownKeys(issues, id, definition, SKILL_KEYS);
        checkString(issues, `${id}.label`, definition['label']);
        if ('basic' in definition) {
            checkBoolean(issues, `${id}.basic`, definition['basic']);
        }
        const basic = definition['basic'] === true;
        if (!basic && FIELD_OF_STUDY_DENYLIST.has(id)) {
            issues.add(id, 'non-basic skills must be specific abilities, not broad fields of study');
        }
        if ('dependencies' in definition && checkArray(issues, `${id}.dependencies`, definition['dependencies'])) {
            if (basic && (definition['dependencies'] as unknown[]).length > 0) {
                issues.add(`${id}.dependencies`, 'basic skills must have no dependencies');
            }
            (definition['dependencies'] as unknown[]).forEach((dependency, index) => {
                const path = `${id}.dependencies[${index}]`;
                if (!checkRecord(issues, path, dependency)) {
                    return;
                }
                checkUnknownKeys(issues, path, dependency, DEPENDENCY_KEYS);
                checkString(issues, `${path}.skill`, dependency['skill']);
                checkNumber(issues, `${path}.minProficiency`, dependency['minProficiency'], { min: 0.000001, max: 100 });
            });
        }
        if ('tags' in definition && checkArray(issues, `${id}.tags`, definition['tags'])) {
            (definition['tags'] as unknown[]).forEach((tag, index) => checkString(issues, `${id}.tags[${index}]`, tag));
        }
    }
}

export function validateSkillsSemantics(data: unknown, peers: Record<string, unknown>, issues: IssueCollector): void {
    if (!isRecord(data)) {
        return;
    }
    const manifest = data as SkillManifest;

    // The dependency graph must compile: missing refs, cycles, self/duplicate deps, bad thresholds.
    for (const error of compileSkills(manifest).errors) {
        issues.add('graph', error);
    }

    // Orphan rule (061): collect consumption — job requirements + event acquireSkill grants + transitive
    // dependencies of consumed skills; everything else non-basic must carry the 'flavor' tag.
    const consumed = new Set<string>();
    const jobs = (peers['jobs'] ?? {}) as Record<string, { requiredSkills?: string[] }>;
    for (const job of Object.values(jobs)) {
        for (const skill of job.requiredSkills ?? []) {
            consumed.add(skill);
        }
    }
    const events = (peers['events'] ?? {}) as Record<string, { effects?: { type?: string; value?: unknown }[] }>;
    for (const event of Object.values(events)) {
        for (const effect of event.effects ?? []) {
            if (effect.type === 'acquireSkill' && typeof effect.value === 'string') {
                consumed.add(effect.value);
            }
        }
    }
    const frontier = [...consumed];
    while (frontier.length > 0) {
        const id = frontier.pop()!;
        for (const dependency of manifest[id]?.dependencies ?? []) {
            if (!consumed.has(dependency.skill)) {
                consumed.add(dependency.skill);
                frontier.push(dependency.skill);
            }
        }
    }
    for (const [id, definition] of Object.entries(manifest)) {
        if (definition.basic || consumed.has(id)) {
            continue;
        }
        if (!(definition.tags ?? []).includes('flavor')) {
            issues.add(id, `orphan skill: not referenced by any job/event/dependency and not tagged 'flavor' (task 061 rule)`);
        }
    }
}

// --- skillInit.json (task 062) --------------------------------------------------------------------------

const INIT_KEYS = ['adultBasicProficiency', 'milestones', 'assortment'];
const ASSORTMENT_KEYS = ['bands', 'minProficiency', 'maxProficiency', 'jobCoreWeight', 'flavorWeight'];

export function validateSkillInitStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, '', data)) {
        return;
    }
    checkUnknownKeys(issues, '', data, INIT_KEYS);
    checkNumber(issues, 'adultBasicProficiency', data['adultBasicProficiency'], { min: 1, max: 100 });
    if (checkArray(issues, 'milestones', data['milestones'])) {
        (data['milestones'] as unknown[]).forEach((milestone, index) => {
            const path = `milestones[${index}]`;
            if (!checkRecord(issues, path, milestone)) {
                return;
            }
            checkUnknownKeys(issues, path, milestone, ['ageYears', 'grants']);
            checkNumber(issues, `${path}.ageYears`, milestone['ageYears'], { min: 1, integer: true });
            if (checkArray(issues, `${path}.grants`, milestone['grants'])) {
                (milestone['grants'] as unknown[]).forEach((grant, grantIndex) => {
                    const grantPath = `${path}.grants[${grantIndex}]`;
                    if (!checkRecord(issues, grantPath, grant)) {
                        return;
                    }
                    checkUnknownKeys(issues, grantPath, grant, ['skill', 'toAtLeast']);
                    checkString(issues, `${grantPath}.skill`, grant['skill']);
                    checkNumber(issues, `${grantPath}.toAtLeast`, grant['toAtLeast'], { min: 0.000001, max: 100 });
                });
            }
        });
    }
    if (checkRecord(issues, 'assortment', data['assortment'])) {
        const assortment = data['assortment'] as Record<string, unknown>;
        checkUnknownKeys(issues, 'assortment', assortment, ASSORTMENT_KEYS);
        if (checkArray(issues, 'assortment.bands', assortment['bands'])) {
            (assortment['bands'] as unknown[]).forEach((band, index) => {
                const path = `assortment.bands[${index}]`;
                if (!checkRecord(issues, path, band)) {
                    return;
                }
                checkUnknownKeys(issues, path, band, ['minAgeYears', 'minSkills', 'maxSkills']);
                checkNumber(issues, `${path}.minAgeYears`, band['minAgeYears'], { min: 1, integer: true });
                const minOk = checkNumber(issues, `${path}.minSkills`, band['minSkills'], { min: 0, integer: true });
                const maxOk = checkNumber(issues, `${path}.maxSkills`, band['maxSkills'], { min: 0, integer: true });
                if (minOk && maxOk && (band['maxSkills'] as number) < (band['minSkills'] as number)) {
                    issues.add(`${path}.maxSkills`, 'must be >= minSkills');
                }
            });
        }
        const minOk = checkNumber(issues, 'assortment.minProficiency', assortment['minProficiency'], { min: 1, max: 100 });
        const maxOk = checkNumber(issues, 'assortment.maxProficiency', assortment['maxProficiency'], { min: 1, max: 100 });
        if (minOk && maxOk && (assortment['maxProficiency'] as number) < (assortment['minProficiency'] as number)) {
            issues.add('assortment.maxProficiency', 'must be >= minProficiency');
        }
        checkNumber(issues, 'assortment.jobCoreWeight', assortment['jobCoreWeight'], { min: 0.000001 });
        checkNumber(issues, 'assortment.flavorWeight', assortment['flavorWeight'], { min: 0.000001 });
    }
}

export function validateSkillInitSemantics(data: unknown, peers: Record<string, unknown>, issues: IssueCollector): void {
    if (!isRecord(data)) {
        return;
    }
    const skills = (peers['skills'] ?? {}) as SkillManifest;
    const milestones = Array.isArray(data['milestones']) ? data['milestones'] as { ageYears?: number; grants?: { skill?: string }[] }[] : [];
    for (const [index, milestone] of milestones.entries()) {
        for (const [grantIndex, grant] of (milestone.grants ?? []).entries()) {
            const path = `milestones[${index}].grants[${grantIndex}].skill`;
            const skill = grant.skill ?? '';
            const definition = skills[skill];
            if (!definition) {
                issues.add(path, `unknown skill "${skill}"`);
            } else if (!definition.basic) {
                // The early-childhood ladder grants FOUNDATIONAL capabilities only (task 062).
                issues.add(path, `milestones may only grant basic skills, "${skill}" is not basic`);
            } else if ((definition.dependencies ?? []).length > 0) {
                issues.add(path, `milestone skill "${skill}" must be dependency-free`);
            }
        }
    }
}
