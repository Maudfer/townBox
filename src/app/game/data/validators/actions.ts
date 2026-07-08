// Validator for the Action manifest (src/json/actions.json, task 043). Structure: shapes, enums, parameter
// specs, children (pool/sequence), binding syntax. Semantics: child action refs must exist and be discrete,
// lifecycle event links must reference events that declare a `manual` trigger (the action↔event coupling is
// managed data, 038 §7), and sequence bindings must reference declared parent parameters.

import { IssueCollector } from 'game/data/registry';
import { checkArray, checkEnum, checkNumber, checkRecord, checkString, checkUnknownKeys, isScalar } from 'game/data/checks';
import { validatePredicate } from 'game/data/substrate';
import { ActionManifest } from 'types/Action';
import { validateConsequenceOps, validateConsequenceOpsSemantics } from 'game/data/validators/oar';
import { EventManifest } from 'types/LifeEvent';

const ACTION_KEYS = ['label', 'type', 'category', 'requirements', 'parameters', 'selection', 'location', 'durationTicks', 'completeWhen', 'children', 'events', 'consequences'];
const ACTION_TYPES = ['discrete', 'continuous'];
const CATEGORIES = ['obligation', 'work', 'leisure', 'social', 'recovery', 'movement', 'maintenance'];
const PARAMETER_TYPES = ['person', 'objectArchetype', 'objectInstance', 'recipe', 'string', 'number', 'boolean'];
const CONTINUOUS_ONLY = ['location', 'durationTicks', 'completeWhen', 'children'];
const STEP_FAILURE_POLICIES = ['blockParent', 'skipStep', 'failParent'];
const LOCATION_KEY_PATTERN = /^(home|outside|building:.+|venue:.+)$/;

export function validateActionsStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, '', data)) {
        return;
    }
    for (const [id, action] of Object.entries(data)) {
        if (!checkRecord(issues, id, action)) {
            continue;
        }
        checkUnknownKeys(issues, id, action, ACTION_KEYS);
        checkString(issues, `${id}.label`, action['label']);
        const typeOk = checkEnum(issues, `${id}.type`, action['type'], ACTION_TYPES);
        checkEnum(issues, `${id}.category`, action['category'], CATEGORIES);

        if (typeOk && action['type'] === 'discrete') {
            for (const field of CONTINUOUS_ONLY) {
                if (field in action) {
                    issues.add(`${id}.${field}`, 'only continuous actions may declare this field');
                }
            }
        }

        if ('requirements' in action) {
            validatePredicate(issues, `${id}.requirements`, action['requirements']);
        }
        const parameterNames = new Set<string>();
        if ('parameters' in action && checkRecord(issues, `${id}.parameters`, action['parameters'])) {
            for (const [name, spec] of Object.entries(action['parameters'] as Record<string, unknown>)) {
                parameterNames.add(name);
                const path = `${id}.parameters.${name}`;
                if (!checkRecord(issues, path, spec)) {
                    continue;
                }
                checkUnknownKeys(issues, path, spec, ['type', 'required']);
                checkEnum(issues, `${path}.type`, (spec as Record<string, unknown>)['type'], PARAMETER_TYPES);
            }
        }
        if ('selection' in action && checkRecord(issues, `${id}.selection`, action['selection'])) {
            const selection = action['selection'] as Record<string, unknown>;
            checkUnknownKeys(issues, `${id}.selection`, selection, ['weight', 'cooldownTicks', 'modifiers']);
            if ('weight' in selection) {
                checkNumber(issues, `${id}.selection.weight`, selection['weight'], { min: 0 });
            }
            if ('cooldownTicks' in selection) {
                checkNumber(issues, `${id}.selection.cooldownTicks`, selection['cooldownTicks'], { min: 1, integer: true });
            }
            if ('modifiers' in selection && checkArray(issues, `${id}.selection.modifiers`, selection['modifiers'])) {
                (selection['modifiers'] as unknown[]).forEach((modifier, index) => {
                    const path = `${id}.selection.modifiers[${index}]`;
                    if (!checkRecord(issues, path, modifier)) {
                        return;
                    }
                    checkUnknownKeys(issues, path, modifier, ['when', 'multiply']);
                    validatePredicate(issues, `${path}.when`, (modifier as Record<string, unknown>)['when']);
                    checkNumber(issues, `${path}.multiply`, (modifier as Record<string, unknown>)['multiply'], { min: 0 });
                });
            }
        }
        if ('location' in action && checkString(issues, `${id}.location`, action['location'])) {
            if (!LOCATION_KEY_PATTERN.test(action['location'] as string)) {
                issues.add(`${id}.location`, 'expected a canonical location key (home, outside, building:<key>, venue:<kind>)');
            }
        }
        if ('durationTicks' in action) {
            checkNumber(issues, `${id}.durationTicks`, action['durationTicks'], { min: 1, integer: true });
        }
        if ('completeWhen' in action) {
            validatePredicate(issues, `${id}.completeWhen`, action['completeWhen']);
        }
        if ('children' in action) {
            validateChildren(issues, id, action['children'], parameterNames);
        }
        if ('consequences' in action) {
            validateConsequenceOps(issues, `${id}.consequences`, action['consequences']);
        }
        if ('events' in action && checkRecord(issues, `${id}.events`, action['events'])) {
            const events = action['events'] as Record<string, unknown>;
            checkUnknownKeys(issues, `${id}.events`, events, ['onStart', 'onComplete', 'onInterrupt']);
            for (const hook of ['onStart', 'onComplete', 'onInterrupt']) {
                if (!(hook in events)) {
                    continue;
                }
                const link = events[hook];
                if (typeof link === 'string') {
                    checkString(issues, `${id}.events.${hook}`, link);
                    continue;
                }
                // The object form (task 067): { event, params? } — payload values are '$params.<name>'
                // mappings or literal scalars.
                if (!checkRecord(issues, `${id}.events.${hook}`, link)) {
                    continue;
                }
                checkUnknownKeys(issues, `${id}.events.${hook}`, link, ['event', 'params']);
                checkString(issues, `${id}.events.${hook}.event`, link['event']);
                if ('params' in link && checkRecord(issues, `${id}.events.${hook}.params`, link['params'])) {
                    for (const [key, value] of Object.entries(link['params'] as Record<string, unknown>)) {
                        if (!isScalar(value)) {
                            issues.add(`${id}.events.${hook}.params.${key}`, 'payload mappings must be scalars or $params refs');
                        }
                    }
                }
            }
        }
    }
}

function validateChildren(issues: IssueCollector, id: string, children: unknown, parameterNames: Set<string>): void {
    const path = `${id}.children`;
    if (!checkRecord(issues, path, children)) {
        return;
    }
    const mode = children['mode'];
    if (mode === 'pool') {
        checkUnknownKeys(issues, path, children, ['mode', 'entries']);
        if (!checkArray(issues, `${path}.entries`, children['entries'])) {
            return;
        }
        const entries = children['entries'] as unknown[];
        if (entries.length === 0) {
            issues.add(`${path}.entries`, 'a pool needs at least one entry');
        }
        entries.forEach((entry, index) => {
            const entryPath = `${path}.entries[${index}]`;
            if (!checkRecord(issues, entryPath, entry)) {
                return;
            }
            checkUnknownKeys(issues, entryPath, entry, ['action', 'chancePerTick', 'maxPerTick', 'cooldownTicks', 'maxTotal', 'requirements']);
            checkString(issues, `${entryPath}.action`, entry['action']);
            checkNumber(issues, `${entryPath}.chancePerTick`, entry['chancePerTick'], { min: 0, max: 1 });
            for (const field of ['maxPerTick', 'cooldownTicks', 'maxTotal']) {
                if (field in entry) {
                    checkNumber(issues, `${entryPath}.${field}`, entry[field], { min: 1, integer: true });
                }
            }
            if ('requirements' in entry) {
                validatePredicate(issues, `${entryPath}.requirements`, entry['requirements']);
            }
        });
        return;
    }
    if (mode === 'sequence') {
        checkUnknownKeys(issues, path, children, ['mode', 'steps', 'onStepFailure']);
        if ('onStepFailure' in children) {
            checkEnum(issues, `${path}.onStepFailure`, children['onStepFailure'], STEP_FAILURE_POLICIES);
        }
        if (!checkArray(issues, `${path}.steps`, children['steps'])) {
            return;
        }
        const steps = children['steps'] as unknown[];
        if (steps.length === 0) {
            issues.add(`${path}.steps`, 'a sequence needs at least one step');
        }
        steps.forEach((step, index) => {
            const stepPath = `${path}.steps[${index}]`;
            if (!checkRecord(issues, stepPath, step)) {
                return;
            }
            checkUnknownKeys(issues, stepPath, step, ['action', 'params']);
            checkString(issues, `${stepPath}.action`, step['action']);
            if ('params' in step && checkRecord(issues, `${stepPath}.params`, step['params'])) {
                for (const [name, value] of Object.entries(step['params'] as Record<string, unknown>)) {
                    const paramPath = `${stepPath}.params.${name}`;
                    if (typeof value === 'string' && value.startsWith('$')) {
                        // Named bindings (038 §7.3): $parent.<declared param> or $previous.output.
                        if (value.startsWith('$parent.')) {
                            const bound = value.slice('$parent.'.length);
                            if (!parameterNames.has(bound)) {
                                issues.add(paramPath, `binding "${value}" references undeclared parent parameter "${bound}"`);
                            }
                        } else if (value !== '$previous.output') {
                            issues.add(paramPath, `unknown binding "${value}" (allowed: $parent.<param>, $previous.output)`);
                        }
                    } else if (!isScalar(value)) {
                        issues.add(paramPath, 'step params must be scalars or bindings');
                    }
                }
            }
        });
        return;
    }
    issues.add(`${path}.mode`, `expected one of [pool, sequence], got ${JSON.stringify(mode)}`);
}

// Walk a predicate JSON for object queries carrying archetypeParam refs (task 067).
function collectArchetypeParamRefs(node: unknown, refs: string[]): void {
    if (Array.isArray(node)) {
        node.forEach(child => collectArchetypeParamRefs(child, refs));
        return;
    }
    if (typeof node !== 'object' || node === null) {
        return;
    }
    const record = node as Record<string, unknown>;
    for (const key of ['carries', 'objectAtLocation']) {
        const query = record[key];
        if (typeof query === 'object' && query !== null && typeof (query as Record<string, unknown>)['archetypeParam'] === 'string') {
            refs.push((query as Record<string, unknown>)['archetypeParam'] as string);
        }
    }
    Object.values(record).forEach(child => collectArchetypeParamRefs(child, refs));
}

export function validateActionsSemantics(data: unknown, peers: Record<string, unknown>, issues: IssueCollector): void {
    const manifest = data as ActionManifest;
    const events = (peers['events'] ?? {}) as EventManifest;
    const archetypes = new Set(Object.keys((peers['objects'] ?? {}) as Record<string, unknown>));

    for (const [id, action] of Object.entries(manifest)) {
        // archetypeParam requirement refs (067) must name a declared objectArchetype parameter.
        {
            const refs: string[] = [];
            collectArchetypeParamRefs(action.requirements, refs);
            for (const ref of refs) {
                const spec = action.parameters?.[ref];
                if (!spec) {
                    issues.add(`${id}.requirements`, `archetypeParam "${ref}" references an undeclared parameter`);
                } else if (spec.type !== 'objectArchetype') {
                    issues.add(`${id}.requirements`, `archetypeParam "${ref}" must reference an objectArchetype parameter (got ${spec.type})`);
                }
            }
        }

        if (action.consequences) {
            validateConsequenceOpsSemantics(issues, `${id}.consequences`, action.consequences as { op: string; archetype?: string; event?: string; owner?: string; target?: string }[], archetypes, events, new Set(Object.keys(action.parameters ?? {})));
        }
        // Children must reference existing DISCRETE actions (v1: no nested continuous children — a sequence
        // of continuous activities is a Brain-level plan, not an action definition).
        const childRefs: { ref: string; path: string }[] = [];
        if (action.children?.mode === 'pool') {
            action.children.entries.forEach((entry, index) => {
                childRefs.push({ ref: entry.action, path: `${id}.children.entries[${index}].action` });
                // Pools start children with NO params (unlike sequence steps, which bind them) — a child
                // with a required parameter would fail with missingParameter on every occurrence.
                const child = manifest[entry.action];
                const required = Object.entries(child?.parameters ?? {}).filter(([, spec]) => spec.required).map(([name]) => name);
                if (required.length > 0) {
                    issues.add(`${id}.children.entries[${index}].action`, `pool child "${entry.action}" declares required parameter(s) [${required.join(', ')}] — pools pass no params, so it can never start`);
                }
            });
        } else if (action.children?.mode === 'sequence') {
            action.children.steps.forEach((step, index) => childRefs.push({ ref: step.action, path: `${id}.children.steps[${index}].action` }));
        }
        for (const { ref, path } of childRefs) {
            const child = manifest[ref];
            if (!child) {
                issues.add(path, `references unknown action "${ref}"`);
            } else if (child.type !== 'discrete') {
                issues.add(path, `child actions must be discrete (v1); "${ref}" is continuous`);
            }
        }

        // Lifecycle event links: the event must exist AND be manually triggerable (both directions of the
        // action↔event coupling are managed data — 038 §7).
        for (const hook of ['onStart', 'onComplete', 'onInterrupt'] as const) {
            const link = action.events?.[hook];
            if (!link) {
                continue;
            }
            const eventId = typeof link === 'string' ? link : link.event;
            const event = events[eventId];
            if (!event) {
                issues.add(`${id}.events.${hook}`, `references unknown event "${eventId}"`);
                continue;
            }
            if (!event.triggers?.manual) {
                issues.add(`${id}.events.${hook}`, `event "${eventId}" does not declare a manual trigger (actions fire events through EventEngine.invoke)`);
            }
            // Payload mapping (067): '$params.<name>' refs must exist on the action; every mapped key must
            // be declared by the event's parameters spec.
            if (typeof link !== 'string' && link.params) {
                const eventSpec = (event as { parameters?: Record<string, unknown> }).parameters ?? {};
                for (const [key, mapping] of Object.entries(link.params)) {
                    if (!(key in eventSpec)) {
                        issues.add(`${id}.events.${hook}.params.${key}`, `event "${eventId}" declares no parameter "${key}"`);
                    }
                    if (typeof mapping === 'string' && mapping.startsWith('$params.')) {
                        const paramName = mapping.slice('$params.'.length);
                        if (!(paramName in (action.parameters ?? {}))) {
                            issues.add(`${id}.events.${hook}.params.${key}`, `mapping references undeclared action parameter "${paramName}"`);
                        }
                    }
                }
            }
        }
    }
}
