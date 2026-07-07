// Declarative boolean predicates over a SimulationContext. This is the eligibility language of the
// procedural simulation framework (docs/tasks/013-procedural-simulation-framework_DONE.md): Engine B uses it for
// event requirements, and Engine A can use it for conditional composition. A predicate is a small JSON AST
// so it lives entirely in manifests; evaluatePredicate is pure given (pred, ctx), delegating all data access
// to the Context interface, so it is unit-testable with a plain fixture context (no scene, no engine).

import { SimulationContext, ObjectQuery, Value } from 'types/Simulation';

export type ComparisonOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in';

// Grammar version (task 043): bump when node kinds are added/changed so downstream tooling (the 054
// relationship docs, external validators) can pin what it understands.
export const PREDICATE_VERSION = 2;

export type Predicate =
    | { all: Predicate[] }
    | { any: Predicate[] }
    | { not: Predicate }
    | { attr: string; op: ComparisonOp; value: Value | Value[] }
    | { hasEvent: string; role?: string; withinTicks?: number; minCount?: number }
    // v2 (task 043): the mirror of hasEvent over the ACTION log.
    | { hasAction: string; role?: string; withinTicks?: number; minCount?: number }
    // v2 (task 043): the agent carries a matching Object Instance (Possessions, nested containers included).
    | { carries: ObjectQuery }
    // v2 (task 043): a matching Object Instance is physically at the agent's current location.
    | { objectAtLocation: ObjectQuery }
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
        const query: { withinTicks?: number; minCount?: number } = {};
        if (pred.withinTicks !== undefined) {
            query.withinTicks = pred.withinTicks;
        }
        if (pred.minCount !== undefined) {
            query.minCount = pred.minCount;
        }
        return target.hasEvent(pred.hasEvent, query);
    }
    if ('hasAction' in pred) {
        const target = pred.role ? ctx.role(pred.role) : ctx;
        if (!target || !target.hasAction) {
            return false; // contexts without an action log (event-only fixtures) never match
        }
        const query: { withinTicks?: number; minCount?: number } = {};
        if (pred.withinTicks !== undefined) {
            query.withinTicks = pred.withinTicks;
        }
        if (pred.minCount !== undefined) {
            query.minCount = pred.minCount;
        }
        return target.hasAction(pred.hasAction, query);
    }
    if ('carries' in pred) {
        return ctx.carries ? ctx.carries(pred.carries) : false;
    }
    if ('objectAtLocation' in pred) {
        return ctx.objectAtLocation ? ctx.objectAtLocation(pred.objectAtLocation) : false;
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
