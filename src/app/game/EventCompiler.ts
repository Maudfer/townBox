import { Predicate } from 'util/predicate';
import { EventManifest, EventDefinition, Effect } from 'types/LifeEvent';

// Engine B — the load-time event compiler (docs/tasks/013 §5.2). Like an NPM resolver, it takes events that
// declare only their own requirements + effects and derives the whole dependency/conflict structure:
//
//  - dependsOn: B depends on A when B positively requires an event A provides (a `hasEvent` prerequisite).
//  - excludes:  A excludes B when A sets a state that falsifies a positive state requirement of B (e.g. death
//               sets alive=false, marriage requires alive=true ⇒ death excludes marriage) — DERIVED, never
//               authored — plus permanent negated prerequisites (`not hasEvent X` with no time window).
//  - topoOrder: a topological order over dependsOn so same-day prerequisite chains resolve correctly.
//  - indexKeys: cheap discriminant attributes per event for the runtime eligibility buckets.
//  - warnings:  unmet requirements (a `hasEvent` of an event nothing provides) and dependency cycles.
//
// The graph is built over two discrete capability kinds: history tokens (`hasEvent` / the implicit self event)
// and equality state tokens (`attr == value`). Continuous predicates (age >= 16, money thresholds, `in`,
// disjunctions) are runtime-only eligibility gates and are intentionally not part of the static graph. compile
// is pure → unit-testable against fixture manifests.

const DISCRIMINANT_ATTRS = new Set(['alive', 'gender', 'marital', 'employed']);

const DEFAULT_BASE_ATTRIBUTES = ['alive', 'gender', 'age', 'marital', 'employed', 'money', 'pregnant', 'homeless'];

export interface EventGraph {
    ids: string[];
    dependsOn: Record<string, string[]>;
    excludes: Record<string, string[]>;
    topoOrder: string[];
    indexKeys: Record<string, string[]>;
    warnings: string[];
}

interface StateToken {
    attr: string;
    value: string;
}

interface Requirements {
    positiveEvents: Set<string>;
    negativePermanentEvents: Set<string>;
    positiveStates: StateToken[]; // subject-only equality requirements
    discriminants: Set<string>;
}

function emptyRequirements(): Requirements {
    return { positiveEvents: new Set(), negativePermanentEvents: new Set(), positiveStates: [], discriminants: new Set() };
}

// Walks a predicate collecting hard requirements. `negated` tracks an enclosing not(); `isSubject` is false once
// we descend into a role's where (role state doesn't constrain the subject); `soft` is true inside any() since a
// disjunct is not individually required.
function walk(pred: Predicate, negated: boolean, isSubject: boolean, soft: boolean, out: Requirements): void {
    if ('all' in pred) {
        pred.all.forEach(child => walk(child, negated, isSubject, soft, out));
        return;
    }
    if ('any' in pred) {
        pred.any.forEach(child => walk(child, negated, isSubject, true, out));
        return;
    }
    if ('not' in pred) {
        walk(pred.not, !negated, isSubject, soft, out);
        return;
    }
    if ('where' in pred) {
        walk(pred.where, negated, false, soft, out);
        return;
    }
    if ('hasEvent' in pred) {
        if (soft) {
            return;
        }
        if (!negated) {
            out.positiveEvents.add(pred.hasEvent);
        } else if (pred.withinDays === undefined) {
            out.negativePermanentEvents.add(pred.hasEvent); // a windowed negation is a runtime cooldown, not a hard conflict
        }
        return;
    }
    // attribute comparison
    if (isSubject) {
        if (DISCRIMINANT_ATTRS.has(pred.attr) || pred.attr === 'age') {
            out.discriminants.add(pred.attr);
        }
        if (!soft && !negated && pred.op === '==') {
            out.positiveStates.push({ attr: pred.attr, value: String(pred.value) });
        }
    }
}

function collectRequirements(event: EventDefinition): Requirements {
    const out = emptyRequirements();
    for (const [roleName, spec] of Object.entries(event.roles)) {
        if (!spec.where) {
            continue;
        }
        walk(spec.where, false, roleName === 'subject', false, out);
    }
    return out;
}

// Discrete state tokens an effect sets. The closed effect vocabulary maps to known (attr,value) state changes;
// exclusivity is then derived by matching these against other events' positive state requirements.
function effectStateTokens(effect: Effect): StateToken[] {
    switch (effect.type) {
        case 'setDeath':
            return [{ attr: 'alive', value: 'false' }];
        case 'marry':
            return [{ attr: 'marital', value: 'married' }];
        case 'divorce':
            return [{ attr: 'marital', value: 'divorced' }];
        case 'setAttr':
            return effect.attr !== undefined ? [{ attr: effect.attr, value: String(effect.value) }] : [];
        default:
            return [];
    }
}

function sortedUnique(items: Iterable<string>): string[] {
    return [...new Set(items)].sort();
}

export function compileEvents(manifest: EventManifest, baseAttributes: string[] = DEFAULT_BASE_ATTRIBUTES): EventGraph {
    const ids = Object.keys(manifest);
    const idSet = new Set(ids);
    const baseAttrSet = new Set(baseAttributes);

    const requirements = new Map<string, Requirements>();
    for (const id of ids) {
        requirements.set(id, collectRequirements(manifest[id]!));
    }

    // State providers: attr -> value -> events that set it. (Every event also implicitly provides its own
    // history token, handled directly via id below.)
    const stateProviders = new Map<string, Map<string, Set<string>>>();
    for (const id of ids) {
        for (const effect of manifest[id]!.effects) {
            for (const token of effectStateTokens(effect)) {
                const byValue = stateProviders.get(token.attr) ?? new Map<string, Set<string>>();
                const events = byValue.get(token.value) ?? new Set<string>();
                events.add(id);
                byValue.set(token.value, events);
                stateProviders.set(token.attr, byValue);
            }
        }
    }

    const dependsOn: Record<string, string[]> = {};
    const excludes: Record<string, Set<string>> = {};
    const indexKeys: Record<string, string[]> = {};
    const warnings: string[] = [];
    for (const id of ids) {
        excludes[id] = new Set<string>();
    }

    for (const id of ids) {
        const req = requirements.get(id)!;

        // Dependencies: positive hasEvent prerequisites. Unmet ones (no such event) are flagged.
        const deps: string[] = [];
        for (const eventToken of req.positiveEvents) {
            if (idSet.has(eventToken)) {
                if (eventToken !== id) {
                    deps.push(eventToken);
                }
            } else {
                warnings.push(`Event "${id}" requires unknown event "${eventToken}"`);
            }
        }
        dependsOn[id] = sortedUnique(deps);

        // Permanent negated prerequisites: the provider event excludes this one.
        for (const eventToken of req.negativePermanentEvents) {
            if (idSet.has(eventToken)) {
                excludes[eventToken]!.add(id);
            }
        }

        // State requirements: any event setting the same attribute to a different value excludes this one.
        for (const state of req.positiveStates) {
            if (!baseAttrSet.has(state.attr) && !stateProviders.has(state.attr)) {
                warnings.push(`Event "${id}" requires unknown state attribute "${state.attr}"`);
            }
            const byValue = stateProviders.get(state.attr);
            if (!byValue) {
                continue;
            }
            for (const [value, providers] of byValue) {
                if (value === state.value) {
                    continue;
                }
                for (const provider of providers) {
                    if (provider !== id) {
                        excludes[provider]!.add(id);
                    }
                }
            }
        }

        indexKeys[id] = [...req.discriminants].sort();
    }

    const excludesOut: Record<string, string[]> = {};
    for (const id of ids) {
        excludesOut[id] = [...excludes[id]!].sort();
    }

    const { order, cycle } = topologicalOrder(ids, dependsOn);
    if (cycle.length > 0) {
        warnings.push(`Dependency cycle among events: ${cycle.sort().join(', ')}`);
    }

    return { ids, dependsOn, excludes: excludesOut, topoOrder: order, indexKeys, warnings };
}

// Kahn's algorithm over dependsOn (edge A -> B means B depends on A, so A is emitted first). Deterministic:
// ready nodes are always taken in sorted order. Any nodes left over are in a cycle; they are appended (sorted)
// and reported so the caller can warn.
function topologicalOrder(ids: string[], dependsOn: Record<string, string[]>): { order: string[]; cycle: string[] } {
    const indegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();
    for (const id of ids) {
        indegree.set(id, 0);
        dependents.set(id, []);
    }
    for (const id of ids) {
        for (const dep of dependsOn[id] ?? []) {
            indegree.set(id, (indegree.get(id) ?? 0) + 1);
            dependents.get(dep)!.push(id);
        }
    }

    const order: string[] = [];
    let ready = ids.filter(id => (indegree.get(id) ?? 0) === 0).sort();
    while (ready.length > 0) {
        const next = ready.shift()!;
        order.push(next);
        for (const dependent of dependents.get(next)!) {
            const remaining = (indegree.get(dependent) ?? 0) - 1;
            indegree.set(dependent, remaining);
            if (remaining === 0) {
                ready.push(dependent);
            }
        }
        ready = ready.sort();
    }

    const cycle = ids.filter(id => !order.includes(id));
    return { order: [...order, ...cycle.slice().sort()], cycle };
}
