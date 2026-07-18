// Validator for the Action manifest (src/json/actions.json, task 043). Structure: shapes, enums, parameter
// specs, children (pool/sequence), binding syntax. Semantics: child action refs must exist and be discrete,
// lifecycle event links must reference events that declare a `manual` trigger (the action↔event coupling is
// managed data, 038 §7), and sequence bindings must reference declared parent parameters.

import { checkBoolean, checkArray, checkEnum, checkNumber, checkRecord, checkString, checkUnknownKeys, isScalar } from 'game/data/checks';
import { IssueCollector } from 'game/data/registry';
import { validatePredicate } from 'game/data/substrate';
import { validateConsequenceOps, validateConsequenceOpsSemantics } from 'game/data/validators/oar';
import { ActionManifest } from 'types/Action';
import { EventManifest } from 'types/LifeEvent';

const ACTION_KEYS = ['label', 'type', 'category', 'requirements', 'parameters', 'selection', 'location', 'durationTicks', 'completeWhen', 'children', 'events', 'interaction', 'consequences', 'satisfies', 'resumable', 'affinity', 'ambulatory', 'habit'];
// The closed need vocabulary (task 084) — mirrors types/Needs.ts NEED_IDS.
const NEED_KEYS = ['food', 'rest', 'social', 'fun', 'hygiene', 'purpose'];
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
        if ('resumable' in action) {
            // Pause/resume (task 087) only makes sense for continuous instances.
            checkBoolean(issues, `${id}.resumable`, action['resumable']);
            if (action['type'] !== 'continuous') {
                issues.add(`${id}.resumable`, 'only continuous actions can pause/resume (discrete commits are instant)');
            }
        }
        if ('habit' in action) {
            checkString(issues, id + '.habit', action['habit']);
        }
        if ('ambulatory' in action) {
            // Street roaming (task 093): a gait for a continuous OUTDOOR action.
            checkEnum(issues, `${id}.ambulatory`, action['ambulatory'], ['stroll', 'jog', 'run']);
            if (action['type'] !== 'continuous') {
                issues.add(`${id}.ambulatory`, 'only continuous actions can roam (discrete commits are instant)');
            }
            if (action['location'] !== 'outside') {
                issues.add(`${id}.ambulatory`, 'an ambulatory action must be located outside (streets are the venue)');
            }
        }
        if ('affinity' in action) {
            // Trait affinity tags (task 087) — cross-checked against json/traits.json in semantics.
            if (!Array.isArray(action['affinity']) || !(action['affinity'] as unknown[]).every(tag => typeof tag === 'string')) {
                issues.add(`${id}.affinity`, 'expected an array of trait-affinity tag strings');
            }
        }
        // The workday lifecycle contract (LP-3 / proposal simulation-aliveness-2 P0-3): every continuous
        // work action must announce the shift — onStart started_working and stopped_working on BOTH exits.
        // The audit found 27 of 43 unwired, so shifts started invisibly and the day-progression seam
        // (SkillProgression reads stopped_working) fired only when the rotation happened to pick a wired
        // action. A new work action cannot regress this again.
        // Person-targeted work interactions (treating_patient) are care delivered DURING a shift, not the
        // shift wrapper itself — they keep their own counterpart lifecycles and are exempt.
        if (action['category'] === 'work' && action['type'] === 'continuous' && !('interaction' in action)) {
            const events = (action['events'] ?? {}) as Record<string, unknown>;
            const names = (hook: string): string | undefined => {
                const link = events[hook];
                return typeof link === 'string' ? link : (link as { event?: string } | undefined)?.event;
            };
            if (names('onStart') !== 'started_working') {
                issues.add(`${id}.events.onStart`, 'a continuous work action must fire started_working on start (LP-3 workday contract)');
            }
            if (names('onComplete') !== 'stopped_working' || names('onInterrupt') !== 'stopped_working') {
                issues.add(`${id}.events`, 'a continuous work action must fire stopped_working on completion AND interruption (LP-3 workday contract)');
            }
        }
        if ('satisfies' in action && checkRecord(issues, `${id}.satisfies`, action['satisfies'])) {
            // Needs satisfaction (task 084): keys from the closed need set, values finite numbers.
            const satisfies = action['satisfies'] as Record<string, unknown>;
            checkUnknownKeys(issues, `${id}.satisfies`, satisfies, NEED_KEYS);
            for (const [need, amount] of Object.entries(satisfies)) {
                if (typeof amount !== 'number' || !Number.isFinite(amount)) {
                    issues.add(`${id}.satisfies.${need}`, 'satisfaction amounts must be finite numbers');
                }
            }
        }
        if ('consequences' in action) {
            validateConsequenceOps(issues, `${id}.consequences`, action['consequences']);
        }
        const personParams = Object.entries((action['parameters'] ?? {}) as Record<string, { type?: string }>)
            .filter(([, spec]) => spec && spec.type === 'person').map(([name]) => name);
        if (personParams.length > 0 && !('interaction' in action)) {
            issues.add(`${id}.interaction`, 'an action with a person-typed parameter must declare its interaction contract (task 072)');
        }
        if ('interaction' in action && checkRecord(issues, `${id}.interaction`, action['interaction'])) {
            const interaction = action['interaction'] as Record<string, unknown>;
            checkUnknownKeys(issues, `${id}.interaction`, interaction, ['targetParam', 'requiresSameBuilding', 'askFirst', 'allowSelf', 'onDecline', 'covert']);
            if (checkString(issues, `${id}.interaction.targetParam`, interaction['targetParam'])
                && !personParams.includes(interaction['targetParam'] as string)) {
                issues.add(`${id}.interaction.targetParam`, `must name a declared person-typed parameter (have: ${personParams.join(', ') || 'none'})`);
            }
            checkBoolean(issues, `${id}.interaction.requiresSameBuilding`, interaction['requiresSameBuilding']);
            if (interaction['requiresSameBuilding'] === false) {
                // No remote interaction this iteration (task 072): relaxing this is a deliberate future change.
                issues.add(`${id}.interaction.requiresSameBuilding`, 'must be true (remote interaction is not modeled yet)');
            }
            checkBoolean(issues, `${id}.interaction.askFirst`, interaction['askFirst']);
            if ('allowSelf' in interaction) {
                checkBoolean(issues, `${id}.interaction.allowSelf`, interaction['allowSelf']);
            }
            if ('onDecline' in interaction) {
                checkEnum(issues, `${id}.interaction.onDecline`, interaction['onDecline'], ['blockParent', 'skipStep', 'failParent']);
            }
            if ('covert' in interaction) {
                // Covert posture (task 099): done WITHOUT the target's knowledge — asking first is a
                // contradiction in terms, so the two flags are mutually exclusive.
                checkBoolean(issues, `${id}.interaction.covert`, interaction['covert']);
                if (interaction['covert'] === true && interaction['askFirst'] === true) {
                    issues.add(`${id}.interaction.covert`, 'a covert action cannot be askFirst (you don\'t ask permission to pick a pocket)');
                }
            }
        }
        if ('events' in action && checkRecord(issues, `${id}.events`, action['events'])) {
            const events = action['events'] as Record<string, unknown>;
            checkUnknownKeys(issues, `${id}.events`, events, ['onStart', 'onComplete', 'onInterrupt', 'onDecline', 'onCompleteTarget', 'onDeclineTarget']);
            for (const hook of ['onStart', 'onComplete', 'onInterrupt', 'onDecline', 'onCompleteTarget', 'onDeclineTarget']) {
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

        // An onDecline event link only makes sense on an action that actually asks (task 074).
        if (action.events?.onDecline && action.interaction?.askFirst !== true) {
            issues.add(`${id}.events.onDecline`, 'declares a decline event but the action is not askFirst — nothing can ever decline it');
        }
        if (action.events?.onDeclineTarget && action.interaction?.askFirst !== true) {
            issues.add(`${id}.events.onDeclineTarget`, 'declares a target decline event but the action is not askFirst — nothing can ever decline it');
        }
        // Counterpart links (task 082): only an interaction has a target to fire at.
        for (const hook of ['onCompleteTarget', 'onDeclineTarget'] as const) {
            if (action.events?.[hook] && !action.interaction) {
                issues.add(`${id}.events.${hook}`, 'declares a counterpart event but the action has no interaction contract (no target to fire at)');
            }
        }

        // Lifecycle event links: the event must exist AND be manually triggerable (both directions of the
        // action↔event coupling are managed data — 038 §7).
        for (const hook of ['onStart', 'onComplete', 'onInterrupt', 'onDecline', 'onCompleteTarget', 'onDeclineTarget'] as const) {
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
                    // '$actor' (task 082) resolves only when firing at a target — actor-side links have no
                    // separate "actor" to name.
                    if (mapping === '$actor' && hook !== 'onCompleteTarget' && hook !== 'onDeclineTarget') {
                        issues.add(`${id}.events.${hook}.params.${key}`, `'$actor' is only meaningful on counterpart (target) links`);
                    }
                }
            }
        }
    }
}
