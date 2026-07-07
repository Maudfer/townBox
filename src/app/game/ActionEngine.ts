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

import { SeededRandom } from 'util/random';
import { evaluatePredicate } from 'util/predicate';
import { isAliveAt } from 'util/kinship';

import {
    ActionCause,
    ActionDefinition,
    ActionEngineState,
    ActionInstance,
    ActionInstanceId,
    ActionManifest,
    ActionStartOutcome,
    PoolChildSpec,
    SequenceStepSpec,
} from 'types/Action';
import { TickResult } from 'types/LifeEvent';
import { PersonId, PopulationState } from 'types/Genealogy';
import { ExecutionContext, TransitionHandle } from 'types/Execution';
import { SimulationContext, HasEventQuery, ObjectQuery, Value } from 'types/Simulation';
import { locationKey, parseLocationKey } from 'types/Objects';

import actionsConfig from 'json/actions.json';

export const DEFAULT_ACTION_MANIFEST: ActionManifest = actionsConfig as unknown as ActionManifest;

// Everything one advance/start call needs from the outside world. Built per tick by the TickRunner (live
// and bootstrap alike); tests build it directly.
export interface ActionDeps {
    state: PopulationState;
    tick: number;
    ticksPerYear: number;
    ctx: Partial<ExecutionContext>;
    eventEngine: EventEngine;
    inventory?: Inventory | null;
}

const ACTIVE_STATUSES = new Set(['pending', 'waiting_for_materialization', 'running']);

export default class ActionEngine {
    private manifest: ActionManifest;
    private lifeLog: LifeLog;
    private state: ActionEngineState;
    // Pending world transitions by instance id. Transient (handles are live objects); a load re-requests
    // transitions for waiting instances on the next advance.
    private handles: Map<ActionInstanceId, TransitionHandle>;

    constructor(manifest: ActionManifest = DEFAULT_ACTION_MANIFEST, lifeLog: LifeLog = new LifeLog()) {
        this.manifest = manifest;
        this.lifeLog = lifeLog;
        this.state = { instances: {}, nextInstanceSeq: 0, actionHistory: {} };
        this.handles = new Map();
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
    contextFor(personId: PersonId, deps: ActionDeps): SimulationContext {
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
                return base.getAttr(name);
            },
            hasEvent: (eventId, query) => base.hasEvent(eventId, query),
            role: name => base.role(name),
            hasAction: (actionId, query) => this.hasAction(personId, actionId, deps.tick, query),
            carries: query => {
                if (!inventory) {
                    return false;
                }
                if (query.archetype !== undefined && !query.tag && !query.flag) {
                    return inventory.carriesArchetype(personId, query.archetype);
                }
                return inventory.carriedInstances(personId).some(instance => matches(instance.id, query));
            },
            objectAtLocation: query => {
                if (!world || !inventory) {
                    return false;
                }
                return world.objectsAt(world.locationOf(personId)).some(id => matches(id, query));
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
    private fireEvent(eventId: string | undefined, personId: PersonId, causationSeq: number, deps: ActionDeps, result: TickResult): void {
        if (!eventId) {
            return;
        }
        const { result: eventResult } = deps.eventEngine.invoke(deps.state, eventId, personId, deps.tick, deps.ticksPerYear, { source: 'action', causationId: causationSeq }, {}, deps.ctx);
        result.died.push(...eventResult.died);
        result.born.push(...eventResult.born);
        result.signals.push(...eventResult.signals);
    }

    // --- Starting ------------------------------------------------------------

    // Starts an action for a person. Discrete actions commit immediately ('performed'); continuous actions
    // materialize an instance, requesting a location transition through the boundary when needed.
    startAction(personId: PersonId, actionId: string, params: Record<string, Value>, cause: ActionCause, deps: ActionDeps, result: TickResult, parentInstanceId: ActionInstanceId | null = null): ActionStartOutcome {
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
        if (def.requirements && !evaluatePredicate(def.requirements, this.contextFor(personId, deps))) {
            return { ok: false, reason: 'requirementsUnmet' };
        }

        if (def.type === 'discrete') {
            const seq = this.lifeLog.append(personId, {
                tick: deps.tick, kind: 'action', defId: actionId, instanceId: null, lifecycle: 'performed',
                params: { ...params }, parentInstanceId, triggerSource: cause.source, causationId: cause.causationId,
            });
            this.recordAction(personId, actionId, deps.tick);
            this.fireEvent(def.events?.onStart, personId, seq, deps, result);
            this.fireEvent(def.events?.onComplete, personId, seq, deps, result);
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
        if (def.location && world) {
            const at = locationKey(world.locationOf(instance.personId));
            if (at !== def.location) {
                let handle = this.handles.get(instance.id) ?? null;
                if (!handle || handle.status === 'cancelled') {
                    handle = world.requestTransition(instance.personId, parseLocationKey(def.location), deps.tick, instance.causationId);
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
        this.fireEvent(def.events?.onStart, instance.personId, instance.startLogSeq, deps, result);
    }

    // --- Advancing (lifecycle phases 1–2) --------------------------------------

    // Advances every active instance one tick: waiting instances re-check their transition, running ones
    // process children and completion conditions. Returns the world changes (events fired by lifecycles).
    advance(deps: ActionDeps): TickResult {
        const result: TickResult = { died: [], born: [], signals: [] };
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

            instance.ticksRun += 1;
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
            if (def.completeWhen && evaluatePredicate(def.completeWhen, this.contextFor(instance.personId, deps))) {
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
        instance.status = outcome;
        instance.outcome = outcome;
        instance.endedTick = deps.tick;
        this.handles.delete(instance.id);
        const def = this.manifest[instance.defId]!;
        const seq = this.lifeLog.append(instance.personId, {
            tick: deps.tick, kind: 'action', defId: instance.defId, instanceId: instance.id, lifecycle: outcome,
            params: { ...instance.params }, parentInstanceId: instance.parentInstanceId, triggerSource: cause.source, causationId: cause.causationId,
        });
        if (outcome === 'completed') {
            this.fireEvent(def.events?.onComplete, instance.personId, seq, deps, result);
        } else if (outcome === 'interrupted') {
            this.fireEvent(def.events?.onInterrupt, instance.personId, seq, deps, result);
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
            if (entry.requirements && !evaluatePredicate(entry.requirements, this.contextFor(instance.personId, deps))) {
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
        const outcome = this.startAction(instance.personId, step.action, params, { source: 'action', causationId: instance.startLogSeq }, deps, result, instance.id);
        if (outcome.ok) {
            instance.sequenceIndex += 1;
            return null;
        }
        if (policy === 'skipStep') {
            instance.sequenceIndex += 1;
            return null;
        }
        return policy === 'failParent' ? 'failed' : 'blocked';
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
            if (raw === '$previous.output') {
                continue; // populated by the consequence system (task 044)
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
