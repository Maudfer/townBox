// Declarative boolean predicates over a SimulationContext. This is the eligibility language of the
// procedural simulation framework (docs/tasks/013-procedural-simulation-framework_DONE.md): Engine B uses it for
// event requirements, and Engine A can use it for conditional composition. A predicate is a small JSON AST
// so it lives entirely in manifests; evaluatePredicate is pure given (pred, ctx), delegating all data access
// to the Context interface, so it is unit-testable with a plain fixture context (no scene, no engine).

import { count } from 'util/perfMeter';
import { SimulationContext, ObjectQuery, Value } from 'types/Simulation';

export type ComparisonOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in';

// Grammar version (task 043): bump when node kinds are added/changed so downstream tooling (the 054
// relationship docs, external validators) can pin what it understands.
export const PREDICATE_VERSION = 3; // v3 (task 083): the `relationship` standing node

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
    // v3 (task 083): the agent's relationship standing toward another participant — `to` names an action
    // parameter (action contexts; default 'target') or a bound role (event contexts). Standing kinds include
    // graph edge kinds plus the derived 'spouse'/'family'. Runtime-only (never part of the static event graph).
    | { relationship: { to?: string; kinds: string[]; minStrength?: number } }
    | { role: string; where: Predicate };

// A predicate compiled to a closure (task 079 pass 3). `evaluatePredicate` re-walks the JSON AST on every
// call — the `'x' in pred` structural dispatch plus recursion — and over the free-time candidate loop that
// interpreter overhead is the per-agent floor. `compilePredicate` resolves the dispatch ONCE into a closure
// tree; the returned function is a mechanical mirror of `evaluatePredicate` (same short-circuit order, same
// `compareValues`, same query shapes), so it returns identical results — verified against the interpreter over
// every fixture in test/predicate.test.ts.
export type CompiledPredicate = (ctx: SimulationContext) => boolean;

export function compilePredicate(pred: Predicate): CompiledPredicate {
    if ('all' in pred) {
        const children = pred.all.map(compilePredicate);
        return ctx => children.every(child => child(ctx));
    }
    if ('any' in pred) {
        const children = pred.any.map(compilePredicate);
        return ctx => children.some(child => child(ctx));
    }
    if ('not' in pred) {
        const child = compilePredicate(pred.not);
        return ctx => !child(ctx);
    }
    if ('hasEvent' in pred) {
        const eventId = pred.hasEvent;
        const role = pred.role;
        const query: { withinTicks?: number; minCount?: number } = {};
        if (pred.withinTicks !== undefined) {
            query.withinTicks = pred.withinTicks;
        }
        if (pred.minCount !== undefined) {
            query.minCount = pred.minCount;
        }
        return ctx => {
            const target = role ? ctx.role(role) : ctx;
            if (!target) {
                return false;
            }
            return target.hasEvent(eventId, query);
        };
    }
    if ('hasAction' in pred) {
        const actionId = pred.hasAction;
        const role = pred.role;
        const query: { withinTicks?: number; minCount?: number } = {};
        if (pred.withinTicks !== undefined) {
            query.withinTicks = pred.withinTicks;
        }
        if (pred.minCount !== undefined) {
            query.minCount = pred.minCount;
        }
        return ctx => {
            const target = role ? ctx.role(role) : ctx;
            if (!target || !target.hasAction) {
                return false;
            }
            return target.hasAction(actionId, query);
        };
    }
    if ('carries' in pred) {
        const query = pred.carries;
        return ctx => ctx.carries ? ctx.carries(query) : false;
    }
    if ('objectAtLocation' in pred) {
        const query = pred.objectAtLocation;
        return ctx => ctx.objectAtLocation ? ctx.objectAtLocation(query) : false;
    }
    if ('relationship' in pred) {
        const { to = 'target', kinds, minStrength } = pred.relationship;
        return ctx => {
            const view = ctx.relationshipWith ? ctx.relationshipWith(to) : null;
            if (!view || !kinds.includes(view.kind)) {
                return false;
            }
            return minStrength === undefined || view.strength >= minStrength;
        };
    }
    if ('where' in pred) {
        const role = pred.role;
        const child = compilePredicate(pred.where);
        return ctx => {
            const sub = ctx.role(role);
            return sub ? child(sub) : false;
        };
    }
    const { attr, op, value } = pred;
    return ctx => compareValues(ctx.getAttr(attr), op, value);
}

// Compile-once cache keyed on the predicate object identity (task 079 pass 3). Manifest predicates are stable
// references (loaded from JSON once), so the first evaluation compiles and every later one reuses the closure.
// Byte-identical to `evaluatePredicate` for any given (pred, ctx); use it on the hot repeated-evaluation paths
// (free-time/social selection, action requirement/completeWhen checks). One-shot predicates still work — they
// just compile then evaluate once (cheap).
const compiledCache = new WeakMap<Predicate, CompiledPredicate>();

export function evaluatePredicateCached(pred: Predicate, ctx: SimulationContext): boolean {
    count('predicate.evalCached');
    let compiled = compiledCache.get(pred);
    if (compiled === undefined) {
        compiled = compilePredicate(pred);
        compiledCache.set(pred, compiled);
    }
    return compiled(ctx);
}

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
    if ('relationship' in pred) {
        const { to = 'target', kinds, minStrength } = pred.relationship;
        const view = ctx.relationshipWith ? ctx.relationshipWith(to) : null;
        if (!view || !kinds.includes(view.kind)) {
            return false;
        }
        return minStrength === undefined || view.strength >= minStrength;
    }
    if ('where' in pred) {
        const sub = ctx.role(pred.role);
        return sub ? evaluatePredicate(pred.where, sub) : false;
    }
    return compareValues(ctx.getAttr(pred.attr), pred.op, pred.value);
}

// Exported so the event runtime's eligibility gates (EventEngine's discriminant snapshot walk) apply the
// EXACT comparison semantics of the full predicate evaluator — a gate must never pass or fail differently
// than the predicate node it was compiled from.
export function compareValues(actual: Value | Value[] | undefined, op: ComparisonOp, operand: Value | Value[]): boolean {
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
