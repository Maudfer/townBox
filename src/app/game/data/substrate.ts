// Structural validators for the framework substrate types that appear inside data files: Curve (util/curve.ts)
// and Predicate (util/predicate.ts). These mirror the runtime evaluators exactly — same shape discrimination
// order as evaluatePredicate/evaluateCurve — so "validates" means "the runtime will interpret it as intended".

import { checkArray, checkNumber, checkRecord, checkString, checkUnknownKeys, isScalar } from 'game/data/checks';
import { IssueCollector } from 'game/data/registry';

const CURVE_KEYS: Record<string, readonly string[]> = {
    const: ['mode', 'value'],
    linear: ['mode', 'base', 'perUnit', 'min', 'max'],
    sqrt: ['mode', 'base', 'coeff', 'min', 'max'],
    log: ['mode', 'base', 'coeff', 'min', 'max'],
    logistic: ['mode', 'floor', 'ceiling', 'midpoint', 'steepness'],
    step: ['mode', 'points'],
};

const CURVE_REQUIRED: Record<string, readonly string[]> = {
    const: ['value'],
    linear: ['base', 'perUnit'],
    sqrt: ['base', 'coeff'],
    log: ['base', 'coeff'],
    logistic: ['floor', 'ceiling', 'midpoint', 'steepness'],
    step: ['points'],
};

export function validateCurve(issues: IssueCollector, path: string, value: unknown): void {
    if (!checkRecord(issues, path, value)) {
        return;
    }
    const mode = value['mode'];
    if (typeof mode !== 'string' || !(mode in CURVE_KEYS)) {
        issues.add(`${path}.mode`, `expected one of [${Object.keys(CURVE_KEYS).join(', ')}]`);
        return;
    }
    checkUnknownKeys(issues, path, value, CURVE_KEYS[mode]!);
    for (const field of CURVE_REQUIRED[mode]!) {
        if (field === 'points') {
            validateStepPoints(issues, `${path}.points`, value['points']);
        } else {
            checkNumber(issues, `${path}.${field}`, value[field]);
        }
    }
    for (const bound of ['min', 'max']) {
        if (bound in value) {
            checkNumber(issues, `${path}.${bound}`, value[bound]);
        }
    }
    if (typeof value['min'] === 'number' && typeof value['max'] === 'number' && value['min'] > value['max']) {
        issues.add(path, `min (${value['min']}) must be <= max (${value['max']})`);
    }
}

function validateStepPoints(issues: IssueCollector, path: string, value: unknown): void {
    if (!checkArray(issues, path, value)) {
        return;
    }
    if (value.length === 0) {
        issues.add(path, 'a step curve needs at least one point');
        return;
    }
    value.forEach((point, index) => {
        const pointPath = `${path}[${index}]`;
        if (!checkRecord(issues, pointPath, point)) {
            return;
        }
        checkUnknownKeys(issues, pointPath, point, ['at', 'value']);
        checkNumber(issues, `${pointPath}.at`, point['at']);
        checkNumber(issues, `${pointPath}.value`, point['value']);
    });
}

const COMPARISON_OPS = ['==', '!=', '<', '<=', '>', '>=', 'in'] as const;

// Validates a predicate AST. `onRoleRef` reports every role name the predicate references (hasEvent.role and
// role/where nodes), so callers with a role vocabulary (the events validator) can cross-check them.
export function validatePredicate(issues: IssueCollector, path: string, value: unknown, onRoleRef?: (role: string, path: string) => void): void {
    if (!checkRecord(issues, path, value)) {
        return;
    }
    // Same discrimination order as evaluatePredicate: all, any, not, hasEvent, where, attr.
    if ('all' in value || 'any' in value) {
        const key = 'all' in value ? 'all' : 'any';
        checkUnknownKeys(issues, path, value, [key]);
        if (checkArray(issues, `${path}.${key}`, value[key])) {
            (value[key] as unknown[]).forEach((child, index) => validatePredicate(issues, `${path}.${key}[${index}]`, child, onRoleRef));
        }
        return;
    }
    if ('not' in value) {
        checkUnknownKeys(issues, path, value, ['not']);
        validatePredicate(issues, `${path}.not`, value['not'], onRoleRef);
        return;
    }
    if ('hasEvent' in value || 'hasAction' in value) {
        const key = 'hasEvent' in value ? 'hasEvent' : 'hasAction';
        checkUnknownKeys(issues, path, value, [key, 'role', 'withinTicks', 'minCount']);
        checkString(issues, `${path}.${key}`, value[key]);
        if ('role' in value && checkString(issues, `${path}.role`, value['role'])) {
            onRoleRef?.(value['role'] as string, `${path}.role`);
        }
        if ('withinTicks' in value) {
            checkNumber(issues, `${path}.withinTicks`, value['withinTicks'], { min: 1, integer: true });
        }
        if ('minCount' in value) {
            checkNumber(issues, `${path}.minCount`, value['minCount'], { min: 1, integer: true });
        }
        return;
    }
    if ('carries' in value || 'objectAtLocation' in value) {
        const key = 'carries' in value ? 'carries' : 'objectAtLocation';
        checkUnknownKeys(issues, path, value, [key]);
        const query = value[key];
        if (!checkRecord(issues, `${path}.${key}`, query)) {
            return;
        }
        checkUnknownKeys(issues, `${path}.${key}`, query as Record<string, unknown>, ['archetype', 'tag', 'flag', 'archetypeParam']);
        const q = query as Record<string, unknown>;
        if (!('archetype' in q) && !('tag' in q) && !('flag' in q) && !('archetypeParam' in q)) {
            issues.add(`${path}.${key}`, 'an object query needs at least one of archetype/tag/flag/archetypeParam');
        }
        if ('archetype' in q && 'archetypeParam' in q) {
            issues.add(`${path}.${key}`, 'archetype and archetypeParam are mutually exclusive');
        }
        for (const field of ['archetype', 'tag', 'flag', 'archetypeParam']) {
            if (field in q) {
                checkString(issues, `${path}.${key}.${field}`, q[field]);
            }
        }
        return;
    }
    if ('relationship' in value) {
        // v3 (task 083): relationship standing toward another participant.
        checkUnknownKeys(issues, path, value, ['relationship']);
        const query = value['relationship'];
        if (!checkRecord(issues, `${path}.relationship`, query)) {
            return;
        }
        const q = query as Record<string, unknown>;
        checkUnknownKeys(issues, `${path}.relationship`, q, ['to', 'kinds', 'minStrength']);
        if ('to' in q) {
            checkString(issues, `${path}.relationship.to`, q['to']);
        }
        const STANDINGS = ['acquaintance', 'friend', 'close_friend', 'rival', 'dating', 'engaged', 'ex_partner', 'spouse', 'family', 'none'];
        if (checkArray(issues, `${path}.relationship.kinds`, q['kinds'])) {
            const kinds = q['kinds'] as unknown[];
            if (kinds.length === 0) {
                issues.add(`${path}.relationship.kinds`, 'must name at least one standing');
            }
            kinds.forEach((kind, index) => {
                if (typeof kind !== 'string' || !STANDINGS.includes(kind)) {
                    issues.add(`${path}.relationship.kinds[${index}]`, `expected one of [${STANDINGS.join(', ')}]`);
                }
            });
        }
        if ('minStrength' in q) {
            checkNumber(issues, `${path}.relationship.minStrength`, q['minStrength'], { min: 0 });
        }
        return;
    }
    if ('where' in value) {
        checkUnknownKeys(issues, path, value, ['role', 'where']);
        if (checkString(issues, `${path}.role`, value['role'])) {
            onRoleRef?.(value['role'] as string, `${path}.role`);
        }
        validatePredicate(issues, `${path}.where`, value['where'], onRoleRef);
        return;
    }
    if ('attr' in value) {
        checkUnknownKeys(issues, path, value, ['attr', 'op', 'value']);
        checkString(issues, `${path}.attr`, value['attr']);
        const op = value['op'];
        if (typeof op !== 'string' || !COMPARISON_OPS.includes(op as (typeof COMPARISON_OPS)[number])) {
            issues.add(`${path}.op`, `expected one of [${COMPARISON_OPS.join(', ')}]`);
            return;
        }
        const operand = value['value'];
        if (op === 'in') {
            if (!Array.isArray(operand) || operand.length === 0 || !operand.every(isScalar)) {
                issues.add(`${path}.value`, `op "in" requires a non-empty array of scalars`);
            }
        } else if (op === '==' || op === '!=') {
            if (!isScalar(operand)) {
                issues.add(`${path}.value`, `op "${op}" requires a scalar value`);
            }
        } else if (typeof operand !== 'number') {
            // Ordered comparisons are numbers-only at runtime (compareOrdered), so anything else is authoring error.
            issues.add(`${path}.value`, `op "${op}" requires a number`);
        }
        // Unit-scale guard (LP-5 quick fix / proposal simulation-aliveness-2 P1-8): `health` is 0–1.
        // An audit found EIGHT manifest comparisons authored on a 0–100 scale — always-true gates
        // (health < 40) silently inflating weights and always-false ones (health >= 70) silently dead.
        // The whole class is now an authoring error.
        if (value['attr'] === 'health' && typeof operand === 'number' && Math.abs(operand) > 1) {
            issues.add(`${path}.value`, `"health" is a 0–1 attribute — a comparison against ${operand} is always-${operand > 0 ? (op === '<' || op === '<=' ? 'true' : 'false') : 'degenerate'} (did you mean ${operand / 100}?)`);
        }
        return;
    }
    issues.add(path, `unrecognized predicate shape (keys: ${Object.keys(value).join(', ') || 'none'})`);
}
