// The bounded consequence executor (task 044; docs/tasks/038 §7.4/§7.6): applies an action's
// object-action-relationship entry (multi-input transformations) and its declared consequence ops when the
// action commits. Two phases per commit — PLAN resolves and validates every reference against pre-state
// (returning null on any failure, with zero mutations), APPLY performs the mutations. The atomicity boundary
// is the plan: two ops in one set contending for the same instance is an authoring conflict that throws
// loudly at apply time rather than corrupting silently.

import { ActionDeps } from 'game/actions/ActionEngine';
import Inventory from 'game/objects/Inventory';
import inventoryTuning from 'json/inventory.json';

// Business shelf capacity per archetype (task 089 / F3) — production halts at a full shelf.
const STOCK_CEILING_PER_ARCHETYPE = (inventoryTuning as { businessStockCeilingPerArchetype?: number }).businessStockCeilingPerArchetype ?? 60;
import {
    ConsequenceOp,
    OAREntry,
    ObjectRef,
    OwnershipTarget,
} from 'types/Action';
import { PersonId } from 'types/Genealogy';
import { TickResult } from 'types/LifeEvent';
import { EdgeKind } from 'types/Relationship';
import { ObjectContainerRef, ObjectInstanceId, ObjectOwner, locationKey } from 'types/Objects';
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
    // Bucket-indexed (perf): same first-match as the old sorted-contents .find() — matchingIdsAtLocation
    // returns the matching ids in the same ascending order the contents walk produced.
    const match = inventory.matchingIdsAtLocation(locationKey(world.objectLocationOf(ctx.personId)), query)[0];
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
    return inventory.hasMatchingAtLocation(locationKey(world.objectLocationOf(ctx.personId)), query);
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
        // Stock ceilings (task 089 / F3): a business stops producing an archetype once its shelf is full —
        // the 12,185-baked-dough mountain the audit found can no longer accumulate. A full shelf makes the
        // entry unsatisfiable (typed inputsUnavailable upstream); sales drain the shelf and production resumes.
        const ceiling = STOCK_CEILING_PER_ARCHETYPE;
        const overCeiling = outputSpecs.some(spec => {
            if (spec.owner!.kind !== 'business') {
                return false;
            }
            const held = inventory.instancesOwnedBy(spec.owner!)
                .filter(instance => instance.archetypeId === spec.output.archetype)
                .reduce((total, instance) => total + instance.quantity, 0);
            return held >= ceiling;
        });
        if (overCeiling) {
            continue;
        }
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
    // Basket accounting (W0 / P0-1a): optional purchase ops may individually skip (missing stock, too
    // broke), but a basket whose EVERY purchase op skipped fails the plan typed — a shopping commit that
    // buys nothing is not a purchase.
    let purchaseOpsSeen = 0;
    let purchaseOpsPlanned = 0;
    // Running planned spend (W0 / P1-8): the solvency floor must account for what THIS commit's earlier
    // ops already plan to spend, or a multi-item basket overdrafts right through the per-op check.
    let plannedSpend = 0;
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
                    // 'outside' (task 112): the shared curb — where the trash goes and the collectors sweep.
                    const container = op.container === 'outside'
                        ? { kind: 'location' as const, key: 'outside' }
                        : resolveContainer(op.container, ctx);
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
                // Debit solvency floor (W0 / P1-8): action-side spends (paid_the_bill, tips, fees) were the
                // last unfloored micro-flow — balances drifted to −8/−32 through them. A debit the person
                // can't cover is a typed plan failure (the engine logs it), symmetric with purchaseObject.
                if (op.amount < 0) {
                    const ledger = ctx.deps.ctx.markets?.ledger ?? null;
                    const spendSoFar = target === ctx.personId ? plannedSpend : 0;
                    if (ledger?.getPersonBalance && ledger.getPersonBalance(target as string) - spendSoFar < -op.amount) {
                        return null;
                    }
                    if (target === ctx.personId) {
                        plannedSpend += -op.amount;
                    }
                }
                // Mirrors the event effect: a no-op without a ledger (money doesn't exist off-map).
                steps.push(() => ctx.deps.ctx.markets?.ledger?.adjustPerson(target as string, op.amount));
                break;
            }
            case 'adjustRelationship': {
                // The elective social graph (task 083): actor ↔ the action's `target` parameter. Plan-time
                // validation only needs a resolvable target; a missing graph is a benign no-op (pure tests).
                const otherId = ctx.params['target'];
                if (typeof otherId !== 'string') {
                    return null;
                }
                steps.push(() => {
                    const graph = ctx.deps.ctx.markets?.social ?? null;
                    if (!graph || otherId === ctx.personId) {
                        return;
                    }
                    // Dating is exclusive here (LP-9): the decode audit found 1,172 STANDING dating edges
                    // (~9 per living person) because a consented ask seeded a new edge and nothing ever
                    // closed the others. Starting to date someone demotes both parties' other romances to
                    // ex_partner — the 090 arc is a ladder (dating → engaged → married), not a web.
                    if (op.kind === 'dating') {
                        for (const person of [ctx.personId, otherId]) {
                            for (const edge of graph.edgesOf(person, ctx.deps.tick)) {
                                const kind = edge.view?.kind;
                                if ((kind === 'dating' || kind === 'engaged') && edge.otherId !== (person === ctx.personId ? otherId : ctx.personId)) {
                                    graph.setKind(person, edge.otherId, 'ex_partner', ctx.deps.tick, edge.view.strength);
                                }
                            }
                        }
                    }
                    const adjusted = graph.adjust(ctx.personId, otherId, op.delta, ctx.deps.tick,
                        { ...(op.kind ? { kind: op.kind as EdgeKind } : {}), provenance: ctx.causationId });
                    // A ladder promotion fires its authored event for BOTH sides, chained to this commit.
                    if (adjusted.promoted?.onPromote) {
                        for (const [subject, other] of [[ctx.personId, otherId], [otherId, ctx.personId]] as const) {
                            const { result } = ctx.deps.eventEngine.invoke(
                                ctx.deps.state, adjusted.promoted.onPromote, subject, ctx.deps.tick, ctx.deps.ticksPerYear,
                                { source: 'action', causationId: ctx.causationId }, {}, ctx.deps.ctx, { with: other }
                            );
                            ctx.result.died.push(...result.died);
                            ctx.result.born.push(...result.born);
                            ctx.result.signals.push(...result.signals);
                            ctx.result.committed.push(...result.committed);
                        }
                    }
                });
                break;
            }
            case 'purchaseObject': {
                // Materialized retail (task 089): prefer real business stock here; fall back to conjuring.
                // Plannable whenever a fallback exists (shops without stock still sell — the 071 posture);
                // without a fallback, missing stock is a typed plan failure.
                const world = ctx.deps.ctx.world ?? null;
                const stockId = (): string | null => {
                    if (!world || !inventory) {
                        return null;
                    }
                    // Bucket-narrowed (perf): the archetype/tag conditions are archetype-level, so only
                    // matching buckets can hold stock; the business-ownership check stays per-instance.
                    // The final sort normalizes order, so the pick is identical to the old full scan.
                    const candidates: string[] = [];
                    const buckets = inventory.archetypeBucketsAtLocation(locationKey(world.objectLocationOf(ctx.personId)));
                    for (const [archetypeId, bucket] of buckets) {
                        if (op.query.archetype !== undefined && archetypeId !== op.query.archetype) {
                            continue;
                        }
                        if (op.query.tag !== undefined && !(inventory.getArchetype(archetypeId)?.tags ?? []).includes(op.query.tag)) {
                            continue;
                        }
                        for (const id of bucket) {
                            if (inventory.getInstance(id)?.owner.kind === 'business') {
                                candidates.push(id);
                            }
                        }
                    }
                    candidates.sort();
                    return candidates[0] ?? null;
                };
                // At a REAL shop (task 113: a live world answers businessAt with the occupying business)
                // the shelf is the truth — the conjuring fallback is retired, and missing stock is a typed
                // plan failure. Off-map worlds leave businessAt undefined and keep the abstract fallback.
                // An `optional` basket item (W0 / P0-1a) SKIPS instead of failing the plan — the buyer takes
                // what the shelf has; the seen/planned counters below enforce "you can't buy nothing".
                purchaseOpsSeen += 1;
                const atRealShop = world?.businessAt?.(world.objectLocationOf(ctx.personId)) != null;
                const ledgerForFloor = ctx.deps.ctx.markets?.ledger ?? null;
                const unbuyable =
                    (stockId() === null && (op.fallback === undefined || atRealShop))
                    || (op.fallback !== undefined && (!inventory || !inventory.getArchetype(op.fallback)))
                    // The solvency floor (LP-4 / P1-5): retail never overdrafts — too broke is a typed
                    // failure (or an optional skip), and money-gated selection gets a truthful signal.
                    || (!!ledgerForFloor?.getPersonBalance && op.price > 0
                        && ledgerForFloor.getPersonBalance(ctx.personId) - plannedSpend < op.price);
                if (unbuyable) {
                    if (op.optional) {
                        break; // skip this basket item; the basket-level check runs after the loop
                    }
                    return null;
                }
                purchaseOpsPlanned += 1;
                plannedSpend += op.price;
                steps.push(() => {
                    const ledger = ctx.deps.ctx.markets?.ledger ?? null;
                    const id = stockId(); // re-resolve at apply time (earlier steps may have moved stock)
                    if (id !== null && inventory) {
                        const businessKey = (inventory.getInstance(id)!.owner as { kind: 'business'; key: string }).key;
                        inventory.transferOwnership(id, { kind: 'person', personId: ctx.personId });
                        inventory.moveInstance(id, { kind: 'possessions', personId: ctx.personId });
                        ledger?.recordPurchase?.(ctx.personId, businessKey, op.price);
                        return;
                    }
                    if (op.fallback !== undefined && !atRealShop && inventory) {
                        inventory.createInstance({
                            archetypeId: op.fallback,
                            quantity: op.fallbackQuantity ?? 1,
                            owner: { kind: 'person', personId: ctx.personId },
                            container: { kind: 'possessions', personId: ctx.personId },
                            tick: ctx.deps.tick,
                            provenance: ctx.causationId,
                        });
                        ledger?.recordFallbackPurchase?.(ctx.personId, op.price);
                    }
                });
                break;
            }
            case 'satisfyNeed': {
                // Household care (LP-5 / P1-7): feed the co-located — the cook's serving credits everyone
                // sharing the room. Needs-less contexts (pure tests) and empty rooms are benign no-ops.
                steps.push(() => {
                    const needs = ctx.deps.ctx.markets?.needs ?? null;
                    const world = ctx.deps.ctx.world ?? null;
                    if (!needs || !world) {
                        return;
                    }
                    const here = world.locationOf(ctx.personId);
                    const served = world.peopleAt(here).filter(id => id !== ctx.personId).slice(0, 8);
                    for (const id of served) {
                        needs.satisfy(id, { [op.need]: op.amount }, ctx.deps.tick, ctx.deps.state.worldSeed);
                    }
                });
                break;
            }
            case 'planJointActivity': {
                // Joint plans (task 085 / D3): a consented invitation installs mirrored agenda entries. The
                // activity id and target come from the action's params; missing either is a plan failure.
                const guestId = ctx.params['target'];
                const activityId = ctx.params[op.activityParam];
                if (typeof guestId !== 'string' || typeof activityId !== 'string') {
                    return null;
                }
                steps.push(() => {
                    const agenda = ctx.deps.ctx.markets?.agenda ?? null;
                    if (!agenda) {
                        return; // no planning substrate (pure tests) — benign no-op
                    }
                    const linkId = `l${ctx.causationId ?? ctx.deps.tick}`;
                    const window = {
                        enqueuedAtTick: ctx.deps.tick,
                        earliestTick: ctx.deps.tick + op.afterTicks,
                        latestTick: ctx.deps.tick + op.afterTicks + op.windowTicks,
                        linkId,
                        causationId: ctx.causationId,
                        source: 'jointActivity',
                    };
                    // Host at home; guest follows the host.
                    agenda.enqueue({ ...window, personId: ctx.personId, actionId: activityId, locationOverride: 'home' });
                    agenda.enqueue({ ...window, personId: guestId, actionId: activityId, locationOverride: `person:${ctx.personId}` });
                });
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
    // The basket rule (W0 / P0-1a): a commit that declared purchases but could plan NONE of them is not a
    // purchase — typed failure (the engine logs it as inputsUnavailable), never a silent empty-handed walk.
    if (purchaseOpsSeen > 0 && purchaseOpsPlanned === 0) {
        return null;
    }
    return { steps };
}

export function applyPlan(plan: Plan): void {
    for (const step of plan.steps) {
        step();
    }
}
