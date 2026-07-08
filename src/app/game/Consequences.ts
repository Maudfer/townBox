// The bounded consequence executor (task 044; docs/tasks/038 §7.4/§7.6): applies an action's
// object-action-relationship entry (multi-input transformations) and its declared consequence ops when the
// action commits. Two phases per commit — PLAN resolves and validates every reference against pre-state
// (returning null on any failure, with zero mutations), APPLY performs the mutations. The atomicity boundary
// is the plan: two ops in one set contending for the same instance is an authoring conflict that throws
// loudly at apply time rather than corrupting silently.

import Inventory from 'game/Inventory';
import { ActionDeps } from 'game/ActionEngine';

import {
    ConsequenceOp,
    OAREntry,
    ObjectRef,
    OwnershipTarget,
} from 'types/Action';
import { ObjectContainerRef, ObjectInstanceId, ObjectOwner, locationKey } from 'types/Objects';
import { TickResult } from 'types/LifeEvent';
import { PersonId } from 'types/Genealogy';
import { ObjectQuery, Value } from 'types/Simulation';

export interface CommitContext {
    personId: PersonId;
    params: Record<string, Value>;
    // Output variables bound during this commit (OAR bindAs + createObject bindAs). The caller seeds it with
    // the sequence's previous outputs so "$previous.output"-style refs keep working across steps.
    outputs: Record<string, ObjectInstanceId>;
    causationId: number | null; // the committing log entry's seq (provenance + event causation)
    deps: ActionDeps;
    result: TickResult;
}

// A fully resolved, validated plan — applying it cannot fail on missing references.
interface Plan {
    steps: (() => void)[];
}

function inventoryOf(ctx: CommitContext): Inventory | null {
    return ctx.deps.inventory ?? null;
}

function resolveOwner(target: OwnershipTarget | undefined, ctx: CommitContext): ObjectOwner | null {
    switch (target ?? 'person') {
        case 'person':
            return { kind: 'person', personId: ctx.personId };
        case 'targetPerson': {
            const targetId = ctx.params['target'];
            return typeof targetId === 'string' ? { kind: 'person', personId: targetId } : null;
        }
        case 'employer': {
            const key = ctx.deps.employerKeyOf?.(ctx.personId) ?? null;
            return key ? { kind: 'business', key } : null;
        }
        case 'world':
            return { kind: 'world' };
        case 'none':
            return { kind: 'none' };
    }
}

function resolveContainer(container: 'possessions' | 'location' | undefined, ctx: CommitContext): ObjectContainerRef | null {
    if ((container ?? 'possessions') === 'possessions') {
        return { kind: 'possessions', personId: ctx.personId };
    }
    const world = ctx.deps.ctx.world;
    return world ? { kind: 'location', key: locationKey(world.objectLocationOf(ctx.personId)) } : null;
}

// Resolve an ObjectQuery's archetypeParam (067/068) against the committing action's params.
function resolveQueryParams(query: ObjectQuery, ctx: CommitContext): ObjectQuery | null {
    if (query.archetypeParam === undefined) {
        return query;
    }
    const value = ctx.params[query.archetypeParam];
    if (typeof value !== 'string') {
        return null;
    }
    const { archetypeParam, ...rest } = query;
    void archetypeParam;
    return { ...rest, archetype: value };
}

// Resolves an ObjectRef to a concrete instance id against pre-state (or a planned output name).
function resolveObjectRef(ref: ObjectRef, ctx: CommitContext, plannedOutputs: Set<string>): ObjectInstanceId | { planned: string } | null {
    const inventory = inventoryOf(ctx);
    if ('param' in ref) {
        const value = ctx.params[ref.param];
        return typeof value === 'string' && inventory?.getInstance(value) ? value : null;
    }
    if ('output' in ref) {
        if (ctx.outputs[ref.output]) {
            return ctx.outputs[ref.output]!;
        }
        return plannedOutputs.has(ref.output) ? { planned: ref.output } : null;
    }
    if (!inventory) {
        return null;
    }
    if ('carried' in ref) {
        const query = resolveQueryParams(ref.carried, ctx);
        if (!query) {
            return null;
        }
        const match = inventory.carriedInstances(ctx.personId).find(instance => inventory.instanceMatches(instance.id, query));
        return match?.id ?? null;
    }
    const world = ctx.deps.ctx.world;
    if (!world) {
        return null;
    }
    const query = resolveQueryParams(ref.atLocation, ctx);
    if (!query) {
        return null;
    }
    const match = world.objectsAt(world.objectLocationOf(ctx.personId)).find(id => inventory.instanceMatches(id, query));
    return match ?? null;
}

// Lazily reads an id that may have been a planned output at plan time.
function materializeRef(resolved: ObjectInstanceId | { planned: string }, ctx: CommitContext): ObjectInstanceId {
    if (typeof resolved === 'string') {
        return resolved;
    }
    const id = ctx.outputs[resolved.planned];
    if (!id) {
        throw new Error(`[Consequences] Planned output "${resolved.planned}" was never bound (authoring conflict)`);
    }
    return id;
}

// --- Object-action relationships -----------------------------------------------------------------------

// Matched instances for one OAR input: instance ids + the quantity to take from each.
interface InputMatch {
    takes: { instanceId: ObjectInstanceId; quantity: number }[];
}

function stateMatches(instanceState: Record<string, Value> | undefined, wanted: Record<string, Value> | undefined): boolean {
    for (const [key, value] of Object.entries(wanted ?? {})) {
        if ((instanceState ?? {})[key] !== value) {
            return false;
        }
    }
    return true;
}

// Tries to satisfy an entry's inputs from the person's carried instances (nested containers included).
// Returns null when unsatisfiable. `claimed` prevents two inputs from taking the same units.
function matchInputs(entry: OAREntry, ctx: CommitContext): { matches: InputMatch[] } | null {
    const inventory = inventoryOf(ctx);
    if (!inventory) {
        return entry.inputs.length === 0 ? { matches: [] } : null;
    }
    const carried = inventory.carriedInstances(ctx.personId);
    const claimed = new Map<ObjectInstanceId, number>();
    const matches: InputMatch[] = [];
    for (const input of entry.inputs) {
        let needed = input.quantity ?? 1;
        const takes: InputMatch['takes'] = [];
        for (const instance of carried) {
            if (needed <= 0) {
                break;
            }
            if (instance.archetypeId !== input.archetype || !stateMatches(instance.state, input.state)) {
                continue;
            }
            const available = instance.quantity - (claimed.get(instance.id) ?? 0);
            if (available <= 0) {
                continue;
            }
            const take = Math.min(available, needed);
            takes.push({ instanceId: instance.id, quantity: take });
            claimed.set(instance.id, (claimed.get(instance.id) ?? 0) + take);
            needed -= take;
        }
        if (needed > 0) {
            return null;
        }
        matches.push({ takes });
    }
    return { matches };
}

function contextSatisfied(entry: OAREntry, ctx: CommitContext): boolean {
    let query = entry.context?.objectAtLocation;
    if (!query) {
        return true;
    }
    if (query.archetypeParam !== undefined) {
        // Resolve the archetype from the committing action's params (067).
        const value = ctx.params[query.archetypeParam];
        if (typeof value !== 'string') {
            return false;
        }
        const { archetypeParam, ...rest } = query;
        void archetypeParam;
        query = { ...rest, archetype: value };
    }
    const inventory = inventoryOf(ctx);
    const world = ctx.deps.ctx.world;
    if (!inventory || !world) {
        return false;
    }
    return world.objectsAt(world.objectLocationOf(ctx.personId)).some(id => inventory.instanceMatches(id, query));
}

// Plans the FIRST satisfiable OAR entry for the action (declaration order). Returns undefined when the
// action has no entries at all, null when entries exist but none are satisfiable.
export function planOAR(entries: OAREntry[], ctx: CommitContext): Plan | null | undefined {
    if (entries.length === 0) {
        return undefined;
    }
    for (const entry of entries) {
        if (!contextSatisfied(entry, ctx)) {
            continue;
        }
        const matched = matchInputs(entry, ctx);
        if (!matched) {
            continue;
        }
        // Outputs must be constructible too (owner/container resolvable).
        const outputSpecs = entry.outputs.map(output => ({
            output,
            owner: resolveOwner(output.owner, ctx),
            container: resolveContainer(output.container, ctx),
        }));
        if (outputSpecs.some(spec => !spec.owner || !spec.container)) {
            continue;
        }
        const inventory = inventoryOf(ctx)!;
        const steps: (() => void)[] = [];
        entry.inputs.forEach((input, index) => {
            const takes = matched.matches[index]!.takes;
            if (input.disposition === 'consumed') {
                steps.push(() => takes.forEach(take => inventory.withdraw(take.instanceId, take.quantity)));
            } else if (input.disposition === 'transformed') {
                const transformTo = input.transformTo!;
                steps.push(() => {
                    for (const take of takes) {
                        const transformed = inventory.transformInstance(take.instanceId, transformTo.archetype, transformTo.state, take.quantity);
                        if (input.bindAs) {
                            ctx.outputs[input.bindAs] = transformed.id;
                        }
                    }
                });
            } else if (input.bindAs) {
                // retained/required inputs may still be named for later steps.
                const first = takes[0];
                if (first) {
                    steps.push(() => {
                        ctx.outputs[input.bindAs!] = first.instanceId;
                    });
                }
            }
        });
        for (const spec of outputSpecs) {
            steps.push(() => {
                const created = inventory.createInstance({
                    archetypeId: spec.output.archetype,
                    quantity: spec.output.quantity ?? 1,
                    owner: spec.owner!,
                    container: spec.container!,
                    tick: ctx.deps.tick,
                    provenance: ctx.causationId,
                    ...(spec.output.state ? { state: spec.output.state } : {}),
                });
                if (spec.output.bindAs) {
                    ctx.outputs[spec.output.bindAs] = created.id;
                }
            });
        }
        return { steps };
    }
    return null;
}

// --- Consequence ops ---------------------------------------------------------------------------------------

// Plans a consequence-op list. `plannedOutputs` carries bindAs names an already-planned OAR entry (or earlier
// createObject op) will produce, so {output} refs across the same commit validate.
export function planConsequences(ops: ConsequenceOp[], ctx: CommitContext, plannedOutputs: Set<string>): Plan | null {
    const inventory = inventoryOf(ctx);
    const steps: (() => void)[] = [];
    for (const op of ops) {
        switch (op.op) {
            case 'createObject': {
                const owner = resolveOwner(op.owner, ctx);
                const container = resolveContainer(op.container, ctx);
                if (!owner || !container || !inventory || !inventory.getArchetype(op.archetype)) {
                    return null;
                }
                if (op.bindAs) {
                    plannedOutputs.add(op.bindAs);
                }
                steps.push(() => {
                    const created = inventory.createInstance({
                        archetypeId: op.archetype,
                        quantity: op.quantity ?? 1,
                        owner,
                        container,
                        tick: ctx.deps.tick,
                        provenance: ctx.causationId,
                        ...(op.state ? { state: op.state } : {}),
                    });
                    if (op.bindAs) {
                        ctx.outputs[op.bindAs] = created.id;
                    }
                });
                break;
            }
            case 'consumeObject':
            case 'removeObject':
            case 'moveObject':
            case 'moveObjectToPerson':
            case 'transferObject':
            case 'setObjectState': {
                const resolved = resolveObjectRef(op.object, ctx, plannedOutputs);
                if (resolved === null || !inventory) {
                    return null;
                }
                if (op.op === 'moveObject') {
                    const container = resolveContainer(op.container, ctx);
                    if (!container) {
                        return null;
                    }
                    steps.push(() => inventory.moveInstance(materializeRef(resolved, ctx), container));
                } else if (op.op === 'moveObjectToPerson') {
                    const targetId = ctx.params['target'];
                    if (typeof targetId !== 'string') {
                        return null;
                    }
                    steps.push(() => inventory.moveInstance(materializeRef(resolved, ctx), { kind: 'possessions', personId: targetId }));
                } else if (op.op === 'transferObject') {
                    const owner = resolveOwner(op.owner, ctx);
                    if (!owner) {
                        return null;
                    }
                    steps.push(() => inventory.transferOwnership(materializeRef(resolved, ctx), owner));
                } else if (op.op === 'setObjectState') {
                    steps.push(() => inventory.setInstanceState(materializeRef(resolved, ctx), op.key, op.value));
                } else if (op.op === 'consumeObject') {
                    steps.push(() => inventory.withdraw(materializeRef(resolved, ctx), op.quantity));
                } else {
                    steps.push(() => inventory.removeInstance(materializeRef(resolved, ctx)));
                }
                break;
            }
            case 'adjustMoney': {
                const target = op.target === 'targetPerson' ? ctx.params['target'] : ctx.personId;
                if (op.target === 'targetPerson' && typeof target !== 'string') {
                    return null;
                }
                // Mirrors the event effect: a no-op without a ledger (money doesn't exist off-map).
                steps.push(() => ctx.deps.ctx.markets?.ledger?.adjustPerson(target as string, op.amount));
                break;
            }
            case 'triggerEvent': {
                steps.push(() => {
                    const { result } = ctx.deps.eventEngine.invoke(
                        ctx.deps.state, op.event, ctx.personId, ctx.deps.tick, ctx.deps.ticksPerYear,
                        { source: 'action', causationId: ctx.causationId }, {}, ctx.deps.ctx
                    );
                    ctx.result.died.push(...result.died);
                    ctx.result.born.push(...result.born);
                    ctx.result.signals.push(...result.signals);
                    ctx.result.committed.push(...result.committed);
                });
                break;
            }
            case 'scheduleEvent': {
                steps.push(() => ctx.deps.eventEngine.scheduleTrigger(op.event, ctx.personId, ctx.deps.tick + op.afterTicks, ctx.causationId));
                break;
            }
        }
    }
    return { steps };
}

export function applyPlan(plan: Plan): void {
    for (const step of plan.steps) {
        step();
    }
}
