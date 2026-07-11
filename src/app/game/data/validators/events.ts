// Validators for the life-event manifest (src/json/events.json). Structure: every event's roles, probability,
// and effects match the runtime's expectations (types/LifeEvent.ts + EventEngine.applyEffect) — including the
// classes of error that were silently inert before task 039 (a typo'd effect kind fell through applyEffect's
// switch and "succeeded"). Semantics: compiler warnings promoted to errors, skills/signals/attributes resolved
// against their owning vocabularies.

import { IssueCollector } from 'game/data/registry';
import { checkArray, checkEnum, checkNumber, checkRecord, checkString, checkUnknownKeys, isScalar } from 'game/data/checks';
import { validateCurve, validatePredicate } from 'game/data/substrate';
import { compileEvents, DEFAULT_BASE_ATTRIBUTES } from 'game/events/EventCompiler';
import { EventManifest } from 'types/LifeEvent';
import { KNOWN_SIGNALS } from 'util/notifications';

const EVENT_KEYS = ['roles', 'triggers', 'effects', 'parameters', 'limit', 'label', 'category'];
const ROLE_KEYS = ['where', 'bind'];
const BIND_RELATIONS = ['partnerOf']; // EventEngine.resolveBind's vocabulary

// Per-effect-kind field rules ('type' and 'target' are always allowed; target must name a declared role).
const EFFECT_RULES: Record<string, { required: readonly string[]; optional: readonly string[] }> = {
    setDeath: { required: [], optional: [] },
    marry: { required: ['role'], optional: [] },
    divorce: { required: [], optional: [] },
    birth: { required: ['mother', 'father'], optional: [] },
    setAttr: { required: ['attr', 'value'], optional: [] },
    acquireSlot: { required: ['resource'], optional: [] },
    releaseSlot: { required: ['resource'], optional: [] },
    adjustMoney: { required: ['amount'], optional: [] },
    acquireSkill: { required: ['value'], optional: ['proficiency'] },
    emit: { required: ['signal'], optional: [] },
};

export function validateEventsStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, '', data)) {
        return;
    }
    const eventIds = new Set(Object.keys(data));
    for (const [id, event] of Object.entries(data)) {
        if (!checkRecord(issues, id, event)) {
            continue;
        }
        checkUnknownKeys(issues, id, event, EVENT_KEYS);
        const roleNames = validateRoles(issues, id, event['roles']);
        validateTriggers(issues, id, event['triggers'], roleNames, eventIds);
        if ('parameters' in event && checkRecord(issues, `${id}.parameters`, event['parameters'])) {
            // The typed payload spec (067). REQUIRED params are incompatible with probabilistic triggers
            // (probabilistic commits have no caller to supply a payload).
            const triggers = event['triggers'] as Record<string, unknown> | undefined;
            for (const [paramName, spec] of Object.entries(event['parameters'] as Record<string, unknown>)) {
                const specPath = `${id}.parameters.${paramName}`;
                if (!checkRecord(issues, specPath, spec)) {
                    continue;
                }
                checkUnknownKeys(issues, specPath, spec, ['type', 'required']);
                checkEnum(issues, `${specPath}.type`, spec['type'], ['string', 'number', 'boolean']);
                if (spec['required'] === true && triggers && 'probabilistic' in triggers) {
                    issues.add(specPath, 'a REQUIRED parameter cannot coexist with a probabilistic trigger (no caller supplies it)');
                }
            }
        }
        if ('limit' in event) {
            validateLimit(issues, id, event['limit']);
        }
        validateEffects(issues, id, event['effects'], roleNames);
        if ('label' in event) {
            checkString(issues, `${id}.label`, event['label']);
        }
        if ('category' in event) {
            checkString(issues, `${id}.category`, event['category']);
        }
    }
}

// Returns the declared role names (for reference checks) — always includes the implicit subject.
function validateRoles(issues: IssueCollector, id: string, roles: unknown): Set<string> {
    const names = new Set<string>(['subject']);
    if (!checkRecord(issues, `${id}.roles`, roles)) {
        return names;
    }
    for (const name of Object.keys(roles)) {
        names.add(name);
    }
    for (const [name, spec] of Object.entries(roles)) {
        const path = `${id}.roles.${name}`;
        if (!checkRecord(issues, path, spec)) {
            continue;
        }
        checkUnknownKeys(issues, path, spec, ROLE_KEYS);
        if (!('where' in spec) && !('bind' in spec)) {
            // Only the ticked subject may be unconditioned; any other role must be searched or bound.
            if (name !== 'subject') {
                issues.add(path, 'a non-subject role must declare "where" (candidate search) or "bind" (relation)');
            }
            continue;
        }
        if ('where' in spec) {
            validatePredicate(issues, `${path}.where`, spec['where'], (role, refPath) => {
                if (!names.has(role)) {
                    issues.add(refPath, `references undeclared role "${role}"`);
                }
            });
        }
        if ('bind' in spec && checkString(issues, `${path}.bind`, spec['bind'])) {
            const [relation, base, ...rest] = (spec['bind'] as string).split(':');
            if (rest.length > 0 || !relation || !base || !BIND_RELATIONS.includes(relation)) {
                issues.add(`${path}.bind`, `expected "<relation>:<role>" with relation one of [${BIND_RELATIONS.join(', ')}]`);
            } else if (!names.has(base)) {
                issues.add(`${path}.bind`, `binds through undeclared role "${base}"`);
            }
        }
    }
    return names;
}

// Every event must declare at least one trigger type (task 042): an event nothing can cause is dead data.
function validateTriggers(issues: IssueCollector, id: string, triggers: unknown, roleNames: Set<string>, eventIds: Set<string>): void {
    const path = `${id}.triggers`;
    if (!checkRecord(issues, path, triggers)) {
        return;
    }
    checkUnknownKeys(issues, path, triggers, ['probabilistic', 'manual', 'automated']);
    if (!('probabilistic' in triggers) && !('manual' in triggers) && !('automated' in triggers)) {
        issues.add(path, 'an event must declare at least one trigger type (probabilistic, manual, or automated)');
        return;
    }
    if ('probabilistic' in triggers) {
        validateProbability(issues, `${path}.probabilistic`, triggers['probabilistic'], roleNames);
    }
    if ('manual' in triggers && checkRecord(issues, `${path}.manual`, triggers['manual'])) {
        const manual = triggers['manual'] as Record<string, unknown>;
        checkUnknownKeys(issues, `${path}.manual`, manual, ['requiredBindings']);
        if ('requiredBindings' in manual && checkArray(issues, `${path}.manual.requiredBindings`, manual['requiredBindings'])) {
            (manual['requiredBindings'] as unknown[]).forEach((role, index) => {
                const rolePath = `${path}.manual.requiredBindings[${index}]`;
                if (checkString(issues, rolePath, role) && !roleNames.has(role as string)) {
                    issues.add(rolePath, `references undeclared role "${role}"`);
                }
            });
        }
    }
    if ('automated' in triggers && checkRecord(issues, `${path}.automated`, triggers['automated'])) {
        const automated = triggers['automated'] as Record<string, unknown>;
        checkUnknownKeys(issues, `${path}.automated`, automated, ['rules']);
        if (checkArray(issues, `${path}.automated.rules`, automated['rules'])) {
            const rules = automated['rules'] as unknown[];
            if (rules.length === 0) {
                issues.add(`${path}.automated.rules`, 'an automated trigger needs at least one rule');
            }
            rules.forEach((rule, index) => {
                const rulePath = `${path}.automated.rules[${index}]`;
                if (!checkRecord(issues, rulePath, rule)) {
                    return;
                }
                if ('everyDayOfWeek' in rule) {
                    // Day-of-week arrives with the job calendar (task 045); reject rather than silently drop.
                    issues.add(rulePath, 'everyDayOfWeek rules are not supported until the day-of-week calendar lands (task 045)');
                    return;
                }
                if ('afterEvent' in rule) {
                    checkUnknownKeys(issues, rulePath, rule, ['afterEvent', 'delayTicks']);
                    if (checkString(issues, `${rulePath}.afterEvent`, rule['afterEvent']) && !eventIds.has(rule['afterEvent'] as string)) {
                        issues.add(`${rulePath}.afterEvent`, `references unknown event "${rule['afterEvent']}"`);
                    }
                    checkNumber(issues, `${rulePath}.delayTicks`, rule['delayTicks'], { min: 1, integer: true });
                    return;
                }
                if ('atHour' in rule) {
                    checkUnknownKeys(issues, rulePath, rule, ['atHour']);
                    checkNumber(issues, `${rulePath}.atHour`, rule['atHour'], { min: 0, max: 23, integer: true });
                    return;
                }
                issues.add(rulePath, `unrecognized schedule rule (keys: ${Object.keys(rule).join(', ') || 'none'})`);
            });
        }
    }
}

// Occurrence limits (task 042). perJob/perRelationship are reserved scopes — rejected with a pointer until
// the systems that key them exist.
function validateLimit(issues: IssueCollector, id: string, limit: unknown): void {
    const path = `${id}.limit`;
    if (!checkRecord(issues, path, limit)) {
        return;
    }
    if ('once' in limit) {
        checkUnknownKeys(issues, path, limit, ['once']);
        const once = limit['once'];
        if (once === 'perJob' || once === 'perRelationship') {
            issues.add(`${path}.once`, `"${once}" is reserved until jobs/relationships carry the keying context (tasks 045+)`);
        } else if (once !== 'ever' && once !== 'perDay') {
            issues.add(`${path}.once`, `expected one of [ever, perDay], got ${JSON.stringify(once)}`);
        }
        return;
    }
    if ('withinTicks' in limit) {
        checkUnknownKeys(issues, path, limit, ['withinTicks']);
        checkNumber(issues, `${path}.withinTicks`, limit['withinTicks'], { min: 1, integer: true });
        return;
    }
    issues.add(path, 'expected { once: ... } or { withinTicks: n }');
}

function validateProbability(issues: IssueCollector, id: string, probability: unknown, roleNames: Set<string>): void {
    const path = id;
    if (!checkRecord(issues, path, probability)) {
        return;
    }
    checkUnknownKeys(issues, path, probability, ['perYear', 'factors']);
    checkNumber(issues, `${path}.perYear`, probability['perYear'], { min: 0 });
    if (!('factors' in probability)) {
        return;
    }
    if (!checkArray(issues, `${path}.factors`, probability['factors'])) {
        return;
    }
    (probability['factors'] as unknown[]).forEach((factor, index) => {
        const factorPath = `${path}.factors[${index}]`;
        if (!checkRecord(issues, factorPath, factor)) {
            return;
        }
        checkUnknownKeys(issues, factorPath, factor, ['driver', 'curve']);
        if (checkString(issues, `${factorPath}.driver`, factor['driver'])) {
            const [role, attr] = (factor['driver'] as string).split('.');
            if (!role || !attr) {
                issues.add(`${factorPath}.driver`, 'expected "<role>.<attribute>"');
            } else if (!roleNames.has(role)) {
                issues.add(`${factorPath}.driver`, `references undeclared role "${role}"`);
            }
        }
        validateCurve(issues, `${factorPath}.curve`, factor['curve']);
    });
}

function validateEffects(issues: IssueCollector, id: string, effects: unknown, roleNames: Set<string>): void {
    const path = `${id}.effects`;
    if (!checkArray(issues, path, effects)) {
        return;
    }
    effects.forEach((effect, index) => {
        const effectPath = `${path}[${index}]`;
        if (!checkRecord(issues, effectPath, effect)) {
            return;
        }
        const type = effect['type'];
        if (typeof type !== 'string' || !(type in EFFECT_RULES)) {
            issues.add(`${effectPath}.type`, `expected one of [${Object.keys(EFFECT_RULES).join(', ')}]`);
            return;
        }
        const rules = EFFECT_RULES[type]!;
        checkUnknownKeys(issues, effectPath, effect, ['type', 'target', ...rules.required, ...rules.optional]);
        for (const field of rules.required) {
            if (!(field in effect)) {
                issues.add(effectPath, `effect "${type}" requires "${field}"`);
            }
        }
        // Role references must resolve against the declared roles.
        for (const field of ['role', 'mother', 'father', 'target']) {
            if (field in effect && checkString(issues, `${effectPath}.${field}`, effect[field])) {
                if (!roleNames.has(effect[field] as string)) {
                    issues.add(`${effectPath}.${field}`, `references undeclared role "${effect[field]}"`);
                }
            }
        }
        if (type === 'setAttr' && 'value' in effect && !isScalar(effect['value'])) {
            issues.add(`${effectPath}.value`, 'setAttr value must be a scalar');
        }
        if ((type === 'acquireSlot' || type === 'releaseSlot') && effect['resource'] !== 'job') {
            issues.add(`${effectPath}.resource`, 'the only slot resource is "job"');
        }
        if (type === 'adjustMoney' && 'amount' in effect) {
            validateCurve(issues, `${effectPath}.amount`, effect['amount']);
        }
        if (type === 'emit') {
            checkString(issues, `${effectPath}.signal`, effect['signal']);
        }
        if (type === 'acquireSkill') {
            checkString(issues, `${effectPath}.value`, effect['value']);
            if ('proficiency' in effect) {
                checkNumber(issues, `${effectPath}.proficiency`, effect['proficiency'], { min: 0.000001, max: 100 });
            }
        }
        if (type === 'setAttr') {
            checkString(issues, `${effectPath}.attr`, effect['attr']);
        }
    });
}

export function validateEventsSemantics(data: unknown, peers: Record<string, unknown>, issues: IssueCollector): void {
    const manifest = data as EventManifest;
    const skillManifest = (peers['skills'] ?? {}) as Record<string, unknown>;
    const knownAttrs = new Set(DEFAULT_BASE_ATTRIBUTES);

    // The compiler's own diagnostics (unknown hasEvent prerequisites, unknown required attributes, dependency
    // cycles) were previously only surfaced by a test assertion; here they are first-class validation errors.
    for (const warning of compileEvents(manifest).warnings) {
        issues.add('compiler', warning);
    }

    for (const [id, event] of Object.entries(manifest)) {
        event.effects.forEach((effect, index) => {
            const effectPath = `${id}.effects[${index}]`;
            if (effect.type === 'acquireSkill' && typeof effect.value === 'string') {
                if (!(effect.value in skillManifest)) {
                    issues.add(`${effectPath}.value`, `unknown skill "${effect.value}" (not in skills.json)`);
                }
            }
            if (effect.type === 'setAttr' && typeof effect.attr === 'string' && !knownAttrs.has(effect.attr)) {
                issues.add(`${effectPath}.attr`, `unknown attribute "${effect.attr}" (known: ${DEFAULT_BASE_ATTRIBUTES.join(', ')})`);
            }
            if (effect.type === 'emit' && typeof effect.signal === 'string' && !KNOWN_SIGNALS.includes(effect.signal)) {
                issues.add(`${effectPath}.signal`, `unknown signal "${effect.signal}" — nothing consumes it (known: ${KNOWN_SIGNALS.join(', ')})`);
            }
        });
    }
}
