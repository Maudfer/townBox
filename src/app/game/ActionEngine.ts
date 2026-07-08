// The Action engine (task 043; docs/tasks/038 §7). Actions are what people DO: discrete actions commit
// instantly ("Grabbed a pencil"); continuous actions materialize an instance with a real lifecycle
// (pending → waiting_for_materialization → running → completed/interrupted/blocked/failed) and can
// orchestrate children (probabilistic pools and ordered sequences). Location-needing actions request
// transitions through the execution boundary (040) and park in waiting_for_materialization until arrival —
// which resolves immediately under the bootstrap adapter, so both modes emit identical lifecycle records.
//
// Division of labor (038 §8): this engine EXECUTES — validates requirements, advances instances, writes the
// log, and fires the declared manual Events (through EventEngine.invoke, triggerSource 'action'). Deciding
// WHAT a person does next is Brain's job (046); jobs PROPOSE through the orchestrator (047). Consequences
// (world/object mutations) attach to the commit points in task 044.
//
// Determinism: instance ids are a serialized counter (`a<n>`); the per-tick RNG forks off the world seed
// with a fixed salt so action rolls never perturb the event streams; instances advance in sorted-id order.

import EventEngine from 'game/EventEngine';
import LifeLog from 'game/LifeLog';
import Inventory from 'game/Inventory';
import { evaluateConsent } from 'game/Consent';
import { CommitContext, applyPlan, planConsequences, planOAR } from 'game/Consequences';

import { SeededRandom } from 'util/random';
import { evaluatePredicate } from 'util/predicate';
import { isAliveAt } from 'util/kinship';

import { EventLink,
    ActionCause,
    ActionDefinition,
    ActionEngineState,
    ActionInstance,
    ActionInstanceId,
    ActionManifest,
    ActionStartOutcome,
    OAREntry,
    OARTable,
    PoolChildSpec,
    SequenceStepSpec,
} from 'types/Action';
import { TickResult } from 'types/LifeEvent';
import { PersonId, PopulationState } from 'types/Genealogy';
import { ExecutionContext, TransitionHandle } from 'types/Execution';
import { SimulationContext, HasEventQuery, ObjectQuery, Value } from 'types/Simulation';
import { locationKey, parseLocationKey } from 'types/Objects';
import { hourOfTick } from 'util/time';

import actionsConfig from 'json/actions.json';
import oarConfig from 'json/object-action-relationships.json';

export const DEFAULT_ACTION_MANIFEST: ActionManifest = actionsConfig as unknown as ActionManifest;
export const DEFAULT_OAR_TABLE: OARTable = oarConfig as unknown as OARTable;

// Everything one advance/start call needs from the outside world. Built per tick by the TickRunner (live
// and bootstrap alike); tests build it directly.
export interface ActionDeps {
    state: PopulationState;
    tick: number;
    ticksPerYear: number;
    // Coarse stepping (bootstrap): one advance() covers this many ticks (durations consume them; pool
    // chances stay per-advance — documented coarse-step caveat until 055 runs fine-grained).
    ticksPerStep?: number;
    ctx: Partial<ExecutionContext>;
    eventEngine: EventEngine;
    inventory?: Inventory | null;
    // Resolves a person's employer (workplace anchor key) for 'employer'-owned consequence outputs (044).
    // Live wires it through WorkLife; absent (bootstrap, pure tests) the target is a typed plan failure.
    employerKeyOf?: (personId: PersonId) => string | null;
}

const ACTIVE_STATUSES = new Set(['pending', 'waiting_for_materialization', 'running']);

export default class ActionEngine {
    private manifest: ActionManifest;
    private lifeLog: LifeLog;
    private state: ActionEngineState;
    // OAR entries indexed by action id, in declaration order (first satisfiable entry applies — task 044).
    private oarByAction: Map<string, OAREntry[]>;
    // Pending world transitions by instance id. Transient (handles are live objects); a load re-requests
    // transitions for waiting instances on the next advance.
    private handles: Map<ActionInstanceId, TransitionHandle>;

    constructor(manifest: ActionManifest = DEFAULT_ACTION_MANIFEST, lifeLog: LifeLog = new LifeLog(), oar: OARTable = DEFAULT_OAR_TABLE) {
        this.manifest = manifest;
        this.lifeLog = lifeLog;
        this.state = { instances: {}, nextInstanceSeq: 0, actionHistory: {} };
        this.handles = new Map();
        this.oarByAction = new Map();
        for (const entry of Object.values(oar)) {
            const entries = this.oarByAction.get(entry.action) ?? [];
            entries.push(entry);
            this.oarByAction.set(entry.action, entries);
        }
    }

    getState(): ActionEngineState {
        return this.state;
    }

    loadState(state: ActionEngineState): void {
        this.state = state ?? { instances: {}, nextInstanceSeq: 0, actionHistory: {} };
        this.handles = new Map();
    }

    getDefinition(actionId: string): ActionDefinition | null {
        return this.manifest[actionId] ?? null;
    }

    getManifest(): ActionManifest {
        return this.manifest;
    }

    getActionLabel(actionId: string): string {
        const label = this.manifest[actionId]?.label;
        if (label) {
            return label;
        }
        return actionId.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
    }

    getInstance(instanceId: ActionInstanceId): ActionInstance | null {
        return this.state.instances[instanceId] ?? null;
    }

    // The person's currently active continuous instance (at most one; Brain owns the single-activity rule
    // and this engine enforces it at start).
    activeInstanceOf(personId: PersonId): ActionInstance | null {
        for (const instance of Object.values(this.state.instances)) {
            if (instance.personId === personId && ACTIVE_STATUSES.has(instance.status)) {
                return instance;
            }
        }
        return null;
    }

    // The aggregate counts ATTEMPTS: consent-declined starts record here too (task 073), so anti-repetition
    // and selection cooldowns gate immediate re-tries after a decline. A requirement that needs "successfully
    // did X" (not "attempted X") should query the action's success event via hasEvent instead.
    hasAction(personId: PersonId, actionId: string, tick: number, query?: HasEventQuery): boolean {
        const record = this.state.actionHistory[personId]?.[actionId];
        if (!record) {
            return false;
        }
        if (query?.minCount !== undefined && record.count < query.minCount) {
            return false;
        }
        if (query?.withinTicks !== undefined && tick - record.lastTick > query.withinTicks) {
            return false;
        }
        return true;
    }

    // The requirement-evaluation context (shared predicate grammar v2): the event engine's attribute/history
    // view, extended with the action log (hasAction), Possessions (carries), objects-at-location, and the
    // 'locationKey' attribute answered by the world adapter.
    // Resolve an ObjectQuery's archetypeParam (067) against the evaluating action's params. A missing or
    // non-string param yields an unmatchable query (start-time validation catches required params first).
    private static resolveQuery(query: ObjectQuery, params?: Record<string, Value>): ObjectQuery | null {
        if (query.archetypeParam === undefined) {
            return query;
        }
        const value = params?.[query.archetypeParam];
        if (typeof value !== 'string') {
            return null;
        }
        const { archetypeParam, ...rest } = query;
        void archetypeParam;
        return { ...rest, archetype: value };
    }

    contextFor(personId: PersonId, deps: ActionDeps, params?: Record<string, Value>): SimulationContext {
        const base = deps.eventEngine.contextFor(deps.state, personId, deps.tick, deps.ticksPerYear);
        const world = deps.ctx.world ?? null;
        const inventory = deps.inventory ?? null;
        const matches = (instanceId: string, query: ObjectQuery): boolean => {
            const instance = inventory?.getInstance(instanceId);
            const archetype = instance ? inventory?.getArchetype(instance.archetypeId) : null;
            if (!instance || !archetype) {
                return false;
            }
            if (query.archetype !== undefined && instance.archetypeId !== query.archetype) {
                return false;
            }
            if (query.tag !== undefined && !(archetype.tags ?? []).includes(query.tag)) {
                return false;
            }
            if (query.flag !== undefined && !(archetype.flags as unknown as Record<string, boolean>)[query.flag]) {
                return false;
            }
            return true;
        };
        return {
            getAttr: (name: string) => {
                if (name === 'locationKey') {
                    return world ? locationKey(world.locationOf(personId)) : undefined;
                }
                if (name === 'hourOfDay') {
                    return hourOfTick(deps.tick);
                }
                return base.getAttr(name);
            },
            hasEvent: (eventId, query) => base.hasEvent(eventId, query),
            role: name => base.role(name),
            hasAction: (actionId, query) => this.hasAction(personId, actionId, deps.tick, query),
            carries: rawQuery => {
                const query = ActionEngine.resolveQuery(rawQuery, params);
                if (!inventory || !query) {
                    return false;
                }
                if (query.archetype !== undefined && !query.tag && !query.flag) {
                    return inventory.carriesArchetype(personId, query.archetype);
                }
                return inventory.carriedInstances(personId).some(instance => matches(instance.id, query));
            },
            objectAtLocation: rawQuery => {
                const query = ActionEngine.resolveQuery(rawQuery, params);
                if (!world || !inventory || !query) {
                    return false;
                }
                return world.objectsAt(world.objectLocationOf(personId)).some(id => matches(id, query));
            },
        };
    }

    private recordAction(personId: PersonId, actionId: string, tick: number): void {
        const personHistory = this.state.actionHistory[personId] ?? {};
        const existing = personHistory[actionId];
        personHistory[actionId] = { count: (existing?.count ?? 0) + 1, lastTick: tick };
        this.state.actionHistory[personId] = personHistory;
    }

    // Fires a lifecycle-linked manual Event (triggerSource 'action', causation = the lifecycle log entry).
    // The event's own eligibility applies; a rejection is fine (e.g. the person died this tick).
    // Resolve a lifecycle EventLink (067): the object form maps an event payload from the action's params
    // ('$params.<name>') or literal scalars; the string shorthand fires with no payload.
    private fireEvent(link: EventLink | undefined, personId: PersonId, causationSeq: number, deps: ActionDeps, result: TickResult, actionParams?: Record<string, Value>): void {
        if (!link) {
            return;
        }
        const eventId = typeof link === 'string' ? link : link.event;
        let payload: Record<string, string | number | boolean> | undefined;
        if (typeof link !== 'string' && link.params) {
            payload = {};
            for (const [name, mapping] of Object.entries(link.params)) {
                if (typeof mapping === 'string' && mapping.startsWith('$params.')) {
                    const value = actionParams?.[mapping.slice('$params.'.length)];
                    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                        payload[name] = value;
                    }
                } else {
                    payload[name] = mapping;
                }
            }
        }
        const { result: eventResult } = deps.eventEngine.invoke(
            deps.state, eventId, personId, deps.tick, deps.ticksPerYear,
            { source: 'action', causationId: causationSeq },  // triggerSource 'action', causation = lifecycle log seq
            {},                                                // role bindings (person params arrive with 072)
            deps.ctx,
            payload                                            // the mapped event payload (067)
        );
        result.died.push(...eventResult.died);
        result.born.push(...eventResult.born);
        result.signals.push(...eventResult.signals);
        result.committed.push(...eventResult.committed);
    }

    // --- Starting ------------------------------------------------------------

    // Starts an action for a person. Discrete actions commit immediately ('performed'); continuous actions
    // materialize an instance, requesting a location transition through the boundary when needed.
    startAction(personId: PersonId, actionId: string, params: Record<string, Value>, cause: ActionCause, deps: ActionDeps, result: TickResult, parentInstanceId: ActionInstanceId | null = null, onOutputs?: (outputs: Record<string, string>) => void, locationOverride?: string): ActionStartOutcome {
        const def = this.manifest[actionId];
        if (!def) {
            return { ok: false, reason: 'unknownAction' };
        }
        if (parentInstanceId && !this.state.instances[parentInstanceId]) {
            return { ok: false, reason: 'invalidParent' };
        }
        for (const [name, spec] of Object.entries(def.parameters ?? {})) {
            if (spec.required && params[name] === undefined) {
                return { ok: false, reason: 'missingParameter' };
            }
        }
        const record = deps.state.people[personId];
        if (!record || !isAliveAt(record, deps.tick)) {
            return { ok: false, reason: 'requirementsUnmet' };
        }

        // The Person-target interaction contract (task 072): the target must be a live, currently simulated
        // person, distinct from the actor unless allowSelf, and — this iteration, always — in the SAME
        // building (no remote interaction). Violations are typed, zero-mutation failures.
        if (def.interaction) {
            const targetId = params[def.interaction.targetParam];
            const target = typeof targetId === 'string' ? deps.state.people[targetId] : undefined;
            if (typeof targetId !== 'string' || !target || !isAliveAt(target, deps.tick)) {
                return { ok: false, reason: 'targetNotPresent' };
            }
            if (targetId === personId && def.interaction.allowSelf !== true) {
                return { ok: false, reason: 'targetNotPresent' };
            }
            if (def.interaction.requiresSameBuilding) {
                const world = deps.ctx.world;
                if (!world || locationKey(world.locationOf(personId)) !== locationKey(world.locationOf(targetId))) {
                    return { ok: false, reason: 'targetNotPresent' };
                }
            }
            // Consent (task 073): askFirst actions consult the TARGET's decision layer before anything
            // commits. A decline is a real, traceable outcome — a 'failed' log entry with the reason and the
            // full params snapshot — never a silent skip; it also counts toward the actor's action history,
            // so selection cooldowns apply to declined attempts (no immediate re-tries).
            if (def.interaction.askFirst) {
                const consented = evaluateConsent({
                    actionId, params, sourcePersonId: personId, targetPersonId: targetId,
                    tick: deps.tick, worldSeed: deps.state.worldSeed,
                });
                if (!consented) {
                    const seq = this.lifeLog.append(personId, {
                        tick: deps.tick, kind: 'action', defId: actionId, instanceId: null, lifecycle: 'failed',
                        params: { ...params }, parentInstanceId, triggerSource: cause.source,
                        causationId: cause.causationId, failureReason: 'consent_declined',
                    });
                    this.recordAction(personId, actionId, deps.tick);
                    // Curated decline events (task 074): only actions that wire events.onDecline fire one —
                    // the failed log entry above is the universal record; the event is for consumers.
                    this.fireEvent(def.events?.onDecline, personId, seq, deps, result, params);
                    return { ok: false, reason: 'consentDeclined' };
                }
            }
        }
        if (def.requirements && !evaluatePredicate(def.requirements, this.contextFor(personId, deps, params))) {
            return { ok: false, reason: 'requirementsUnmet' };
        }

        if (def.type === 'discrete') {
            // Consequences (task 044): plan BOTH the object-action-relationship entry and the declared ops
            // against pre-state; any unresolvable reference aborts the whole commit with zero mutations.
            const commitCtx: CommitContext = { personId, params, outputs: {}, causationId: cause.causationId, deps, result };
            const oarPlan = planOAR(this.oarByAction.get(actionId) ?? [], commitCtx);
            if (oarPlan === null) {
                return { ok: false, reason: 'inputsUnavailable' };
            }
            const plannedOutputs = new Set<string>();
            for (const entry of this.oarByAction.get(actionId) ?? []) {
                entry.inputs.forEach(input => input.bindAs && plannedOutputs.add(input.bindAs));
                entry.outputs.forEach(output => output.bindAs && plannedOutputs.add(output.bindAs));
            }
            const opsPlan = def.consequences ? planConsequences(def.consequences, commitCtx, plannedOutputs) : { steps: [] };
            if (!opsPlan) {
                return { ok: false, reason: 'inputsUnavailable' };
            }

            const seq = this.lifeLog.append(personId, {
                tick: deps.tick, kind: 'action', defId: actionId, instanceId: null, lifecycle: 'performed',
                params: { ...params }, parentInstanceId, triggerSource: cause.source, causationId: cause.causationId,
            });
            commitCtx.causationId = seq; // provenance + event causation chain to THIS commit
            if (oarPlan) {
                applyPlan(oarPlan);
            }
            applyPlan(opsPlan);
            onOutputs?.(commitCtx.outputs);
            this.recordAction(personId, actionId, deps.tick);
            this.fireEvent(def.events?.onStart, personId, seq, deps, result, params);
            this.fireEvent(def.events?.onComplete, personId, seq, deps, result, params);
            return { ok: true, instanceId: null, logSeq: seq };
        }

        // Continuous: one active instance per person (Brain arbitrates what replaces what, task 046).
        if (this.activeInstanceOf(personId)) {
            return { ok: false, reason: 'alreadyActive' };
        }
        const instance: ActionInstance = {
            id: `a${this.state.nextInstanceSeq++}`,
            defId: actionId,
            personId,
            params: { ...params },
            ...(locationOverride ? { locationOverride } : {}),
            status: 'pending',
            startedTick: deps.tick,
            runningSinceTick: null,
            endedTick: null,
            outcome: null,
            parentInstanceId,
            causationId: cause.causationId,
            startLogSeq: null,
            ticksRun: 0,
            transitionHandleId: null,
            sequenceIndex: 0,
            previousOutputs: {},
            poolState: {},
            lastPoolChild: null,
        };
        this.state.instances[instance.id] = instance;
        this.materialize(instance, cause, deps, result);
        if (instance.status === 'blocked') {
            return { ok: true, instanceId: instance.id, logSeq: this.lifeLog.getNextSeq() - 1 };
        }
        return { ok: true, instanceId: instance.id, logSeq: instance.startLogSeq ?? this.lifeLog.getNextSeq() - 1 };
    }

    // Moves a pending/waiting instance toward running: requests the location transition when needed, enters
    // `running` (logging 'started' and firing onStart) once the person is logically in place. "Started
    // working" fires HERE — when the action actually starts — never when commuting begins.
    private materialize(instance: ActionInstance, cause: ActionCause, deps: ActionDeps, result: TickResult): void {
        const def = this.manifest[instance.defId]!;
        const world = deps.ctx.world;
        // Per-instance override (task 046): a shared work action's location is the person's OWN workplace,
        // supplied by the caller (Brain/Orchestrator) rather than authored on the shared definition.
        const requiredLocation = instance.locationOverride ?? def.location;
        if (requiredLocation && world) {
            const at = locationKey(world.locationOf(instance.personId));
            if (at !== requiredLocation) {
                let handle = this.handles.get(instance.id) ?? null;
                if (!handle || handle.status === 'cancelled') {
                    handle = world.requestTransition(instance.personId, parseLocationKey(requiredLocation), deps.tick, instance.causationId);
                    this.handles.set(instance.id, handle);
                    instance.transitionHandleId = handle.id;
                }
                if (handle.status === 'pending') {
                    instance.status = 'waiting_for_materialization';
                    return;
                }
                if (handle.status === 'cancelled') {
                    // No route to the required location (e.g. no such building): the action can't proceed.
                    this.finish(instance, 'blocked', cause, deps, result);
                    return;
                }
                // arrived — fall through to running.
            }
        }
        this.enterRunning(instance, cause, deps, result);
    }

    private enterRunning(instance: ActionInstance, cause: ActionCause, deps: ActionDeps, result: TickResult): void {
        instance.status = 'running';
        instance.runningSinceTick = deps.tick;
        instance.transitionHandleId = null;
        this.handles.delete(instance.id);
        const def = this.manifest[instance.defId]!;
        instance.startLogSeq = this.lifeLog.append(instance.personId, {
            tick: deps.tick, kind: 'action', defId: instance.defId, instanceId: instance.id, lifecycle: 'started',
            params: { ...instance.params }, parentInstanceId: instance.parentInstanceId, triggerSource: cause.source, causationId: cause.causationId,
        });
        this.recordAction(instance.personId, instance.defId, deps.tick);
        this.fireEvent(def.events?.onStart, instance.personId, instance.startLogSeq, deps, result, instance.params);
    }

    // --- Advancing (lifecycle phases 1–2) --------------------------------------

    // Advances every active instance one tick: waiting instances re-check their transition, running ones
    // process children and completion conditions. Returns the world changes (events fired by lifecycles).
    advance(deps: ActionDeps): TickResult {
        const result: TickResult = { died: [], born: [], signals: [], committed: [] };
        const rng = new SeededRandom(deps.state.worldSeed).fork(deps.tick).fork(0xac7);
        const active = Object.values(this.state.instances)
            .filter(instance => ACTIVE_STATUSES.has(instance.status))
            .sort((a, b) => a.id.localeCompare(b.id));

        for (const instance of active) {
            const person = deps.state.people[instance.personId];
            if (!person || !isAliveAt(person, deps.tick)) {
                this.finish(instance, 'interrupted', { source: 'system', causationId: null }, deps, result);
                continue;
            }
            if (instance.status === 'pending' || instance.status === 'waiting_for_materialization') {
                this.materialize(instance, { source: 'system', causationId: instance.causationId }, deps, result);
                continue; // materializing consumes the tick; children start next tick
            }

            instance.ticksRun += Math.max(1, deps.ticksPerStep ?? 1);
            instance.lastPoolChild = null;
            const def = this.manifest[instance.defId]!;

            if (def.children?.mode === 'pool') {
                this.runPool(instance, def.children.entries, rng, deps, result);
            } else if (def.children?.mode === 'sequence') {
                const finished = this.runSequenceStep(instance, def.children.steps, def.children.onStepFailure ?? 'blockParent', deps, result);
                if (finished !== null) {
                    this.finish(instance, finished, { source: 'system', causationId: instance.startLogSeq }, deps, result);
                    continue;
                }
                if (instance.sequenceIndex >= def.children.steps.length) {
                    this.finish(instance, 'completed', { source: 'system', causationId: instance.startLogSeq }, deps, result);
                    continue;
                }
            }

            if (def.durationTicks !== undefined && instance.ticksRun >= def.durationTicks) {
                this.finish(instance, 'completed', { source: 'system', causationId: instance.startLogSeq }, deps, result);
                continue;
            }
            if (def.completeWhen && evaluatePredicate(def.completeWhen, this.contextFor(instance.personId, deps, instance.params))) {
                this.finish(instance, 'completed', { source: 'system', causationId: instance.startLogSeq }, deps, result);
            }
        }
        return result;
    }

    // External interruption (Brain arbitration, shift obligations, death reconciliation).
    interrupt(instanceId: ActionInstanceId, cause: ActionCause, deps: ActionDeps, result: TickResult): boolean {
        const instance = this.state.instances[instanceId];
        if (!instance || !ACTIVE_STATUSES.has(instance.status)) {
            return false;
        }
        this.finish(instance, 'interrupted', cause, deps, result);
        return true;
    }

    private finish(instance: ActionInstance, outcome: 'completed' | 'interrupted' | 'blocked' | 'failed', cause: ActionCause, deps: ActionDeps, result: TickResult): void {
        const def = this.manifest[instance.defId]!;
        let failureReason: import('types/LifeEvent').ActionFailureReason | undefined;

        // Completion consequences (task 044): planned before the outcome is logged — an unsatisfiable plan
        // turns the completion into a failure with zero mutations. Outputs are seeded from the sequence's
        // bound outputs, so the parent can validate/transfer the final child output WITHOUT duplicating it.
        let completionCtx: CommitContext | null = null;
        let completionPlan: { steps: (() => void)[] } | null = null;
        if (outcome === 'completed' && def.consequences) {
            completionCtx = { personId: instance.personId, params: instance.params, outputs: { ...instance.previousOutputs }, causationId: instance.startLogSeq, deps, result };
            completionPlan = planConsequences(def.consequences, completionCtx, new Set());
            if (!completionPlan) {
                outcome = 'failed';
                failureReason = 'inputs_unavailable';
            }
        }

        instance.status = outcome;
        instance.outcome = outcome;
        instance.endedTick = deps.tick;
        this.handles.delete(instance.id);
        const seq = this.lifeLog.append(instance.personId, {
            tick: deps.tick, kind: 'action', defId: instance.defId, instanceId: instance.id, lifecycle: outcome,
            params: { ...instance.params }, parentInstanceId: instance.parentInstanceId, triggerSource: cause.source, causationId: cause.causationId,
            ...(failureReason ? { failureReason } : {}),
        });
        if (outcome === 'completed') {
            if (completionCtx && completionPlan) {
                completionCtx.causationId = seq;
                applyPlan(completionPlan);
            }
            this.fireEvent(def.events?.onComplete, instance.personId, seq, deps, result, instance.params);
        } else if (outcome === 'interrupted') {
            this.fireEvent(def.events?.onInterrupt, instance.personId, seq, deps, result, instance.params);
        }
    }

    // --- Children --------------------------------------------------------------

    // Pool children (038 §7.5): roll each entry's per-tick chance (up to maxPerTick occurrence slots), then
    // interleave the tick's occurrences so identical children never run consecutively unless nothing else is
    // eligible — that is the extent of sub-tick simulation.
    private runPool(instance: ActionInstance, entries: PoolChildSpec[], rng: SeededRandom, deps: ActionDeps, result: TickResult): void {
        const occurrences: string[] = [];
        for (const entry of entries) {
            const bookkeeping = instance.poolState[entry.action] ?? { count: 0, lastTick: -Infinity };
            if (entry.maxTotal !== undefined && bookkeeping.count >= entry.maxTotal) {
                continue;
            }
            if (entry.cooldownTicks !== undefined && deps.tick - bookkeeping.lastTick < entry.cooldownTicks) {
                continue;
            }
            if (entry.requirements && !evaluatePredicate(entry.requirements, this.contextFor(instance.personId, deps, instance.params))) {
                continue;
            }
            const slots = Math.max(1, entry.maxPerTick ?? 1);
            let count = 0;
            for (let slot = 0; slot < slots; slot++) {
                if (rng.chance(entry.chancePerTick)) {
                    count += 1;
                }
            }
            // Re-check the per-lifetime cap against what this tick would add.
            if (entry.maxTotal !== undefined) {
                count = Math.min(count, entry.maxTotal - bookkeeping.count);
            }
            for (let i = 0; i < count; i++) {
                occurrences.push(entry.action);
            }
        }
        for (const childId of interleave(occurrences)) {
            const outcome = this.startAction(instance.personId, childId, {}, { source: 'action', causationId: instance.startLogSeq }, deps, result, instance.id);
            if (outcome.ok) {
                const bookkeeping = instance.poolState[childId] ?? { count: 0, lastTick: -Infinity };
                instance.poolState[childId] = { count: bookkeeping.count + 1, lastTick: deps.tick };
                instance.lastPoolChild = childId;
            }
        }
    }

    // Sequence children (038 §7.5): one step per running tick. Returns a terminal outcome when a failure
    // policy ends the parent, else null (the caller checks for sequence completion).
    private runSequenceStep(instance: ActionInstance, steps: SequenceStepSpec[], policy: 'blockParent' | 'skipStep' | 'failParent', deps: ActionDeps, result: TickResult): 'blocked' | 'failed' | null {
        const step = steps[instance.sequenceIndex];
        if (!step) {
            return null;
        }
        const params = this.resolveStepParams(instance, step);
        const outcome = this.startAction(instance.personId, step.action, params, { source: 'action', causationId: instance.startLogSeq }, deps, result, instance.id, outputs => {
            instance.previousOutputs = { ...outputs };
        });
        if (outcome.ok) {
            instance.sequenceIndex += 1;
            return null;
        }
        // A consent decline (task 073) resolves through the DECLINED child's own onDecline policy when it
        // declares one, falling back to the sequence-wide onStepFailure. That fallback is deliberate: a
        // rejected transfer must never let the sequence continue as though the object changed hands.
        const effectivePolicy = outcome.reason === 'consentDeclined'
            ? this.manifest[step.action]?.interaction?.onDecline ?? policy
            : policy;
        if (effectivePolicy === 'skipStep') {
            instance.sequenceIndex += 1;
            return null;
        }
        return effectivePolicy === 'failParent' ? 'failed' : 'blocked';
    }

    // Named bindings (038 §7.3): "$parent.<param>" reads the parent instance's parameters;
    // "$previous.output" resolves to the previous step's bound output once consequences exist (044) — until
    // then it stays unresolved and simply isn't passed.
    private resolveStepParams(instance: ActionInstance, step: SequenceStepSpec): Record<string, Value> {
        const params: Record<string, Value> = {};
        for (const [name, raw] of Object.entries(step.params ?? {})) {
            if (typeof raw === 'string' && raw.startsWith('$parent.')) {
                const key = raw.slice('$parent.'.length);
                const value = instance.params[key];
                if (value !== undefined) {
                    params[name] = value;
                }
                continue;
            }
            if (typeof raw === 'string' && raw.startsWith('$previous.')) {
                const key = raw.slice('$previous.'.length);
                const value = instance.previousOutputs[key];
                if (value !== undefined) {
                    params[name] = value;
                }
                continue;
            }
            params[name] = raw;
        }
        return params;
    }
}

// Orders a multiset of child-action occurrences so no id appears twice in a row unless it is the only one
// left — the classic greedy "reorganize" pass, deterministic (ties break by id).
export function interleave(occurrences: string[]): string[] {
    const remaining = new Map<string, number>();
    for (const id of occurrences) {
        remaining.set(id, (remaining.get(id) ?? 0) + 1);
    }
    const ordered: string[] = [];
    let last: string | null = null;
    while (ordered.length < occurrences.length) {
        const candidates = [...remaining.entries()]
            .filter(([id, count]) => count > 0 && id !== last)
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        const pick = candidates[0] ?? [...remaining.entries()].filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
        if (!pick) {
            break;
        }
        ordered.push(pick[0]);
        remaining.set(pick[0], pick[1] - 1);
        last = pick[0];
    }
    return ordered;
}
