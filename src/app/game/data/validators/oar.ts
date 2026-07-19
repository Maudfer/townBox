// Validator for object-action-relationships.json (task 044) and the shared consequence-op checker the
// actions validator reuses. Structure: shapes, dispositions, quantities, ObjectRef forms. Semantics: action
// and archetype references must exist; transformed inputs need transformTo; triggered/scheduled events must
// exist and (for triggerEvent) declare a manual trigger.

import { checkArray, checkEnum, checkNumber, checkRecord, checkString, checkUnknownKeys } from 'game/data/checks';
import { IssueCollector } from 'game/data/registry';
import { ActionManifest, OARTable } from 'types/Action';
import { EventManifest } from 'types/LifeEvent';

const DISPOSITIONS = ['consumed', 'retained', 'transformed', 'required'];
const OWNERSHIP_TARGETS = ['person', 'targetPerson', 'employer', 'world', 'none'];
const CONTAINERS = ['possessions', 'location'];
const OP_KINDS = ['createObject', 'consumeObject', 'removeObject', 'moveObject', 'moveObjectToPerson', 'transferObject', 'setObjectState', 'adjustMoney', 'adjustRelationship', 'planJointActivity', 'purchaseObject', 'triggerEvent', 'scheduleEvent', 'satisfyNeed'];

function validateObjectQuery(issues: IssueCollector, path: string, query: unknown): void {
    if (!checkRecord(issues, path, query)) {
        return;
    }
    checkUnknownKeys(issues, path, query, ['archetype', 'tag', 'flag', 'archetypeParam']);
    if (!('archetype' in query) && !('tag' in query) && !('flag' in query) && !('archetypeParam' in query)) {
        issues.add(path, 'an object query needs at least one of archetype/tag/flag/archetypeParam');
    }
    if ('archetype' in query && 'archetypeParam' in query) {
        issues.add(path, 'archetype and archetypeParam are mutually exclusive');
    }
}

function validateObjectRef(issues: IssueCollector, path: string, ref: unknown): void {
    if (!checkRecord(issues, path, ref)) {
        return;
    }
    if ('param' in ref) {
        checkUnknownKeys(issues, path, ref, ['param']);
        checkString(issues, `${path}.param`, ref['param']);
        return;
    }
    if ('output' in ref) {
        checkUnknownKeys(issues, path, ref, ['output']);
        checkString(issues, `${path}.output`, ref['output']);
        return;
    }
    if ('carried' in ref) {
        checkUnknownKeys(issues, path, ref, ['carried']);
        validateObjectQuery(issues, `${path}.carried`, ref['carried']);
        return;
    }
    if ('atLocation' in ref) {
        checkUnknownKeys(issues, path, ref, ['atLocation']);
        validateObjectQuery(issues, `${path}.atLocation`, ref['atLocation']);
        return;
    }
    issues.add(path, `unrecognized object ref (keys: ${Object.keys(ref).join(', ') || 'none'})`);
}

// Structural check for one consequence-op list (shared with the actions validator).
export function validateConsequenceOps(issues: IssueCollector, path: string, ops: unknown): void {
    if (!checkArray(issues, path, ops)) {
        return;
    }
    ops.forEach((op, index) => {
        const opPath = `${path}[${index}]`;
        if (!checkRecord(issues, opPath, op)) {
            return;
        }
        const kind = op['op'];
        if (typeof kind !== 'string' || !OP_KINDS.includes(kind)) {
            issues.add(`${opPath}.op`, `expected one of [${OP_KINDS.join(', ')}]`);
            return;
        }
        switch (kind) {
            case 'createObject':
                checkUnknownKeys(issues, opPath, op, ['op', 'archetype', 'quantity', 'state', 'owner', 'container', 'bindAs']);
                checkString(issues, `${opPath}.archetype`, op['archetype']);
                if ('quantity' in op) {
                    checkNumber(issues, `${opPath}.quantity`, op['quantity'], { min: 1, integer: true });
                }
                if ('owner' in op) {
                    checkEnum(issues, `${opPath}.owner`, op['owner'], OWNERSHIP_TARGETS);
                }
                if ('container' in op) {
                    checkEnum(issues, `${opPath}.container`, op['container'], CONTAINERS);
                }
                break;
            case 'consumeObject':
                checkUnknownKeys(issues, opPath, op, ['op', 'object', 'quantity']);
                validateObjectRef(issues, `${opPath}.object`, op['object']);
                if ('quantity' in op) {
                    checkNumber(issues, `${opPath}.quantity`, op['quantity'], { min: 1, integer: true });
                }
                break;
            case 'removeObject':
                checkUnknownKeys(issues, opPath, op, ['op', 'object']);
                validateObjectRef(issues, `${opPath}.object`, op['object']);
                break;
            case 'moveObject':
                checkUnknownKeys(issues, opPath, op, ['op', 'object', 'container']);
                validateObjectRef(issues, `${opPath}.object`, op['object']);
                // moveObject alone may target the shared curb (task 112: taking out the trash).
                checkEnum(issues, `${opPath}.container`, op['container'], [...CONTAINERS, 'outside']);
                break;
            case 'moveObjectToPerson':
                checkUnknownKeys(issues, opPath, op, ['op', 'object', 'target']);
                validateObjectRef(issues, `${opPath}.object`, op['object']);
                checkEnum(issues, `${opPath}.target`, op['target'], ['targetPerson']);
                break;
            case 'transferObject':
                checkUnknownKeys(issues, opPath, op, ['op', 'object', 'owner']);
                validateObjectRef(issues, `${opPath}.object`, op['object']);
                checkEnum(issues, `${opPath}.owner`, op['owner'], OWNERSHIP_TARGETS);
                break;
            case 'setObjectState':
                checkUnknownKeys(issues, opPath, op, ['op', 'object', 'key', 'value']);
                validateObjectRef(issues, `${opPath}.object`, op['object']);
                checkString(issues, `${opPath}.key`, op['key']);
                break;
            case 'adjustMoney':
                checkUnknownKeys(issues, opPath, op, ['op', 'amount', 'target']);
                checkNumber(issues, `${opPath}.amount`, op['amount']);
                if ('target' in op) {
                    checkEnum(issues, `${opPath}.target`, op['target'], ['person', 'targetPerson']);
                }
                break;
            case 'adjustRelationship':
                // Task 083: the actor↔target edge delta. Kind seeds new edges only.
                checkUnknownKeys(issues, opPath, op, ['op', 'delta', 'kind']);
                checkNumber(issues, `${opPath}.delta`, op['delta']);
                if ('kind' in op) {
                    checkEnum(issues, `${opPath}.kind`, op['kind'], ['acquaintance', 'friend', 'close_friend', 'rival', 'dating', 'engaged', 'ex_partner']);
                }
                break;
            case 'planJointActivity':
                // Task 085/D3: mirrored agenda entries from a consented invitation.
                checkUnknownKeys(issues, opPath, op, ['op', 'activityParam', 'afterTicks', 'windowTicks']);
                checkString(issues, `${opPath}.activityParam`, op['activityParam']);
                checkNumber(issues, `${opPath}.afterTicks`, op['afterTicks'], { min: 0, integer: true });
                checkNumber(issues, `${opPath}.windowTicks`, op['windowTicks'], { min: 1, integer: true });
                break;
            case 'purchaseObject': {
                // Task 089/F3: real stock preferred, conjured fallback allowed (the 071 keep-list posture).
                // `optional` (W0 / P0-1a): a skippable basket item — buy what's there.
                checkUnknownKeys(issues, opPath, op, ['op', 'query', 'price', 'fallback', 'fallbackQuantity', 'optional']);
                const query = op['query'];
                if (checkRecord(issues, `${opPath}.query`, query)) {
                    checkUnknownKeys(issues, `${opPath}.query`, query as Record<string, unknown>, ['archetype', 'tag']);
                    const q = query as Record<string, unknown>;
                    if (!('archetype' in q) && !('tag' in q)) {
                        issues.add(`${opPath}.query`, 'a purchase query needs archetype and/or tag');
                    }
                }
                checkNumber(issues, `${opPath}.price`, op['price'], { min: 0 });
                if ('fallback' in op) {
                    checkString(issues, `${opPath}.fallback`, op['fallback']);
                }
                if ('fallbackQuantity' in op) {
                    checkNumber(issues, `${opPath}.fallbackQuantity`, op['fallbackQuantity'], { min: 1, integer: true });
                }
                if ('optional' in op && typeof op['optional'] !== 'boolean') {
                    issues.add(`${opPath}.optional`, 'must be a boolean');
                }
                break;
            }
            case 'satisfyNeed':
                // LP-5/P1-7: household care — the co-located fan-out (need names cross-checked in semantics).
                checkUnknownKeys(issues, opPath, op, ['op', 'need', 'amount', 'scope']);
                checkString(issues, `${opPath}.need`, op['need']);
                checkNumber(issues, `${opPath}.amount`, op['amount'], { min: 1 });
                checkEnum(issues, `${opPath}.scope`, op['scope'], ['coLocated']);
                break;
            case 'triggerEvent':
                checkUnknownKeys(issues, opPath, op, ['op', 'event']);
                checkString(issues, `${opPath}.event`, op['event']);
                break;
            case 'scheduleEvent':
                checkUnknownKeys(issues, opPath, op, ['op', 'event', 'afterTicks']);
                checkString(issues, `${opPath}.event`, op['event']);
                checkNumber(issues, `${opPath}.afterTicks`, op['afterTicks'], { min: 1, integer: true });
                break;
        }
    });
}

// Semantic checks for consequence ops (shared): archetype refs and event refs resolve, and ops that read
// the `target` parameter ('targetPerson') sit on an action that actually declares one — a targetPerson op
// on a target-less action can never plan and would be permanently dead content.
export function validateConsequenceOpsSemantics(issues: IssueCollector, path: string, ops: { op: string; archetype?: string; event?: string; owner?: string; target?: string }[], archetypes: Set<string>, events: EventManifest, declaredParams: Set<string>): void {
    ops.forEach((op, index) => {
        const opPath = `${path}[${index}]`;
        if (op.op === 'createObject' && op.archetype !== undefined && !archetypes.has(op.archetype)) {
            issues.add(`${opPath}.archetype`, `references unknown object archetype "${op.archetype}"`);
        }
        if ((op.op === 'triggerEvent' || op.op === 'scheduleEvent') && op.event !== undefined) {
            const event = events[op.event];
            if (!event) {
                issues.add(`${opPath}.event`, `references unknown event "${op.event}"`);
            } else if (op.op === 'triggerEvent' && !event.triggers?.manual) {
                issues.add(`${opPath}.event`, `event "${op.event}" does not declare a manual trigger`);
            }
        }
        if ((op.owner === 'targetPerson' || op.target === 'targetPerson') && !declaredParams.has('target')) {
            issues.add(opPath, `op references 'targetPerson' but the action declares no "target" parameter`);
        }
        if (op.op === 'adjustRelationship' && !declaredParams.has('target')) {
            // Task 083: the edge is actor↔target; without a target parameter the op can never plan.
            issues.add(opPath, `adjustRelationship requires the action to declare a "target" parameter`);
        }
        if (op.op === 'purchaseObject') {
            const fallback = (op as { fallback?: string }).fallback;
            if (fallback !== undefined && !archetypes.has(fallback)) {
                issues.add(opPath + '.fallback', 'references unknown object archetype "' + fallback + '"');
            }
        }
        if (op.op === 'planJointActivity' && !declaredParams.has('target')) {
            // Task 085: the mirrored entries need both sides; without a target the op can never plan.
            issues.add(opPath, `planJointActivity requires the action to declare a "target" parameter`);
        }
    });
}

export function validateOarStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, '', data)) {
        return;
    }
    for (const [id, entry] of Object.entries(data)) {
        if (!checkRecord(issues, id, entry)) {
            continue;
        }
        checkUnknownKeys(issues, id, entry, ['action', 'inputs', 'outputs', 'context']);
        checkString(issues, `${id}.action`, entry['action']);

        if (checkArray(issues, `${id}.inputs`, entry['inputs'])) {
            const inputs = entry['inputs'] as unknown[];
            inputs.forEach((input, index) => {
                const inputPath = `${id}.inputs[${index}]`;
                if (!checkRecord(issues, inputPath, input)) {
                    return;
                }
                checkUnknownKeys(issues, inputPath, input, ['archetype', 'state', 'quantity', 'disposition', 'transformTo', 'bindAs']);
                checkString(issues, `${inputPath}.archetype`, input['archetype']);
                if ('quantity' in input) {
                    checkNumber(issues, `${inputPath}.quantity`, input['quantity'], { min: 1, integer: true });
                }
                const dispositionOk = checkEnum(issues, `${inputPath}.disposition`, input['disposition'], DISPOSITIONS);
                if (dispositionOk && input['disposition'] === 'transformed') {
                    if (!checkRecord(issues, `${inputPath}.transformTo`, input['transformTo'])) {
                        return;
                    }
                    const transformTo = input['transformTo'] as Record<string, unknown>;
                    checkUnknownKeys(issues, `${inputPath}.transformTo`, transformTo, ['archetype', 'state']);
                    checkString(issues, `${inputPath}.transformTo.archetype`, transformTo['archetype']);
                } else if (dispositionOk && 'transformTo' in input) {
                    issues.add(`${inputPath}.transformTo`, 'only transformed inputs may declare transformTo');
                }
            });
        }
        if (checkArray(issues, `${id}.outputs`, entry['outputs'])) {
            (entry['outputs'] as unknown[]).forEach((output, index) => {
                const outputPath = `${id}.outputs[${index}]`;
                if (!checkRecord(issues, outputPath, output)) {
                    return;
                }
                checkUnknownKeys(issues, outputPath, output, ['archetype', 'quantity', 'state', 'owner', 'container', 'bindAs']);
                checkString(issues, `${outputPath}.archetype`, output['archetype']);
                if ('quantity' in output) {
                    checkNumber(issues, `${outputPath}.quantity`, output['quantity'], { min: 1, integer: true });
                }
                if ('owner' in output) {
                    checkEnum(issues, `${outputPath}.owner`, output['owner'], OWNERSHIP_TARGETS);
                }
                if ('container' in output) {
                    checkEnum(issues, `${outputPath}.container`, output['container'], CONTAINERS);
                }
            });
        }
        const entryRecord = entry as Record<string, unknown>;
        const inputCount = Array.isArray(entryRecord['inputs']) ? (entryRecord['inputs'] as unknown[]).length : 0;
        const outputCount = Array.isArray(entryRecord['outputs']) ? (entryRecord['outputs'] as unknown[]).length : 0;
        if (inputCount === 0 && outputCount === 0) {
            issues.add(id, 'an entry needs at least one input or output');
        }
        if ('context' in entry && checkRecord(issues, `${id}.context`, entry['context'])) {
            const context = entry['context'] as Record<string, unknown>;
            checkUnknownKeys(issues, `${id}.context`, context, ['objectAtLocation']);
            if ('objectAtLocation' in context) {
                validateObjectQuery(issues, `${id}.context.objectAtLocation`, context['objectAtLocation']);
            }
        }
    }
}

export function validateOarSemantics(data: unknown, peers: Record<string, unknown>, issues: IssueCollector): void {
    const table = data as OARTable;
    const actions = (peers['actions'] ?? {}) as ActionManifest;
    const archetypes = new Set(Object.keys((peers['objects'] ?? {}) as Record<string, unknown>));

    for (const [id, entry] of Object.entries(table)) {
        const action = actions[entry.action];
        if (!action) {
            issues.add(`${id}.action`, `references unknown action "${entry.action}"`);
        } else if (action.type !== 'discrete') {
            // Transformations attach to discrete commits; continuous actions compose them via children.
            issues.add(`${id}.action`, `object-action relationships attach to discrete actions; "${entry.action}" is continuous`);
        }
        entry.inputs.forEach((input, index) => {
            if (!archetypes.has(input.archetype)) {
                issues.add(`${id}.inputs[${index}].archetype`, `references unknown object archetype "${input.archetype}"`);
            }
            if (input.transformTo && !archetypes.has(input.transformTo.archetype)) {
                issues.add(`${id}.inputs[${index}].transformTo.archetype`, `references unknown object archetype "${input.transformTo.archetype}"`);
            }
        });
        entry.outputs.forEach((output, index) => {
            if (!archetypes.has(output.archetype)) {
                issues.add(`${id}.outputs[${index}].archetype`, `references unknown object archetype "${output.archetype}"`);
            }
            if (output.owner === 'targetPerson' && action && !('target' in (action.parameters ?? {}))) {
                issues.add(`${id}.outputs[${index}].owner`, `owner 'targetPerson' but action "${entry.action}" declares no "target" parameter`);
            }
        });
        const contextArchetype = entry.context?.objectAtLocation?.archetype;
        if (contextArchetype !== undefined && !archetypes.has(contextArchetype)) {
            issues.add(`${id}.context.objectAtLocation.archetype`, `references unknown object archetype "${contextArchetype}"`);
        }
    }
}
