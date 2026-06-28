// Declarative boolean predicates over a SimulationContext. This is the eligibility language of the
// procedural simulation framework (docs/tasks/013-procedural-simulation-framework.md): Engine B uses it for
// event requirements, and Engine A can use it for conditional composition. A predicate is a small JSON AST
// so it lives entirely in manifests; evaluatePredicate is pure given (pred, ctx), delegating all data access
// to the Context interface, so it is unit-testable with a plain fixture context (no scene, no engine).

import { SimulationContext, Value } from 'types/Simulation';

export type ComparisonOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in';

export type Predicate =
    | { all: Predicate[] }
    | { any: Predicate[] }
    | { not: Predicate }
    | { attr: string; op: ComparisonOp; value: Value | Value[] }
    | { hasEvent: string; role?: string; withinDays?: number; minCount?: number }
    | { role: string; where: Predicate };

export function evaluatePredicate(pred: Predicate, ctx: SimulationContext): boolean {
    if ('all' in pred) {
        return pred.all.every(child => evaluatePredicate(child, ctx));
    }
    if ('any' in pred) {
        return pred.any.some(child => evaluatePredicate(child, ctx));
    }
    if ('not' in pred) {
        return !evaluatePredicate(pred.not, ctx);
    }
    if ('hasEvent' in pred) {
        const target = pred.role ? ctx.role(pred.role) : ctx;
        if (!target) {
            return false;
        }
        const query: { withinDays?: number; minCount?: number } = {};
        if (pred.withinDays !== undefined) {
            query.withinDays = pred.withinDays;
        }
        if (pred.minCount !== undefined) {
            query.minCount = pred.minCount;
        }
        return target.hasEvent(pred.hasEvent, query);
    }
    if ('where' in pred) {
        const sub = ctx.role(pred.role);
        return sub ? evaluatePredicate(pred.where, sub) : false;
    }
    return compare(ctx.getAttr(pred.attr), pred.op, pred.value);
}

function compare(actual: Value | Value[] | undefined, op: ComparisonOp, operand: Value | Value[]): boolean {
    switch (op) {
        case '==':
            return actual === operand;
        case '!=':
            return actual !== operand;
        case 'in':
            return Array.isArray(operand) && (operand as Value[]).some(item => item === actual);
        case '<':
        case '<=':
        case '>':
        case '>=':
            return compareOrdered(actual, op, operand);
    }
}

// Ordered comparisons are only meaningful between two numbers; anything else is false rather than coerced.
function compareOrdered(actual: Value | Value[] | undefined, op: '<' | '<=' | '>' | '>=', operand: Value | Value[]): boolean {
    if (typeof actual !== 'number' || typeof operand !== 'number') {
        return false;
    }
    switch (op) {
        case '<':
            return actual < operand;
        case '<=':
            return actual <= operand;
        case '>':
            return actual > operand;
        case '>=':
            return actual >= operand;
    }
}
