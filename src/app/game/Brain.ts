// The Brain (task 046; docs/tasks/038 §8): the per-person DECISION layer. Hooks inspect the simulation
// context and return Action INTENTS; the Brain resolves them (priority, then stable hook order) and asks the
// Action engine to start or interrupt actions through the normal pipeline. The Brain never mutates people,
// never writes logs, and never duplicates execution logic — the Action engine executes, jobs propose (047),
// the Brain arbitrates.
//
// Deliberately STATELESS: `status` derives from the person's active action instance; anti-repetition derives
// from the Action engine's aggregate history (`hasAction` + selection cooldowns). Nothing new to serialize,
// nothing to migrate, and the same Brain runs identically in both execution modes.
//
// Determinism: hooks run in registration order; intents sort by (necessity, priority, hook order, actionId);
// the free-time weighted pick forks the world-seed RNG per (tick, person).

import ActionEngine, { ActionDeps } from 'game/ActionEngine';

import { jobOrchestratorHook } from 'game/JobOrchestrator';

import { SeededRandom, hashStringToSeed } from 'util/random';
import { evaluatePredicate } from 'util/predicate';
import { isOnShiftAtTick } from 'util/shifts';

import { TickResult } from 'types/LifeEvent';
import { PersonId } from 'types/Genealogy';
import { Value } from 'types/Simulation';

// The person's broad simulation state — a small, stable enum, never an arbitrary action name (038 §8). The
// actual activity is the active instance (`activeActionInstanceId`), queryable separately.
export type BrainStatus = 'idle' | 'sleeping' | 'commuting' | 'working' | 'performing_action' | 'waiting_for_materialization';

// What a hook proposes. `necessity` outranks `priority`; `mayInterrupt` lets an intent displace a running
// continuous action (obligations interrupt leisure; leisure never interrupts anything).
export interface ActionIntent {
    actionId: string;
    params?: Record<string, Value>;
    locationOverride?: string;
    sourceHook: string;
    priority: number;
    necessity: 'optional' | 'required' | 'emergency';
    mayInterrupt: boolean;
    causationId: number | null;
}

// A person's job facts, resolved by the host (live: WorkLife/Workplace; bootstrap: the logical world when
// 055 builds it; tests: fixtures). Null = no job.
export interface JobFacts {
    shiftStart: number;
    shiftEnd: number;
    daysOfWeek?: readonly string[];
    workplaceKey: string;
    // The job's work-action repertoire (045), proposed by the Job Orchestrator hook (047): continuous
    // entries rotate by weight; discrete entries roll per tick on duty.
    continuousActions: { action: string; chancePerTick?: number }[];
    discreteActions: { action: string; chancePerTick?: number; maxPerTick?: number; cooldownTicks?: number }[];
}

export interface BrainDeps extends ActionDeps {
    jobOf?: (personId: PersonId) => JobFacts | null;
}

export type HookKind = 'onTick' | 'onEventCommitted' | 'onActionStarted' | 'onActionCompleted' | 'onActionInterrupted' | 'onLocationArrived' | 'onShiftStarted' | 'onShiftEnded';

export interface HookContext {
    personId: PersonId;
    deps: BrainDeps;
    brain: Brain;
    // For onEventCommitted: the committing event.
    event?: { eventId: string; seq: number };
}

export interface BrainHook {
    id: string;
    kind: HookKind;
    // Inspect and PROPOSE — never mutate. Return zero or more intents.
    propose(ctx: HookContext): ActionIntent[];
}

const NECESSITY_RANK = { emergency: 2, required: 1, optional: 0 } as const;

export default class Brain {
    private actionEngine: ActionEngine;
    private hooks: BrainHook[];

    constructor(actionEngine: ActionEngine) {
        this.actionEngine = actionEngine;
        // Built-in hooks in deterministic registration order. Registration is open for future hooks
        // (need-driven stats etc.) without touching the resolution machinery.
        this.hooks = [
            jobOrchestratorHook, // work obligations + on-duty flavor (task 047) — the job-context action source
            wokeUpHook,
            actionCompletedHook,
            inventoryOpportunityHook,
            idleFallbackHook,
        ];
    }

    registerHook(hook: BrainHook): void {
        this.hooks.push(hook);
    }

    // The derived broad state (038 §8): stable enum + the activity id held separately.
    statusOf(personId: PersonId): { status: BrainStatus; activeActionInstanceId: string | null } {
        const active = this.actionEngine.activeInstanceOf(personId);
        if (!active) {
            return { status: 'idle', activeActionInstanceId: null };
        }
        if (active.status === 'waiting_for_materialization') {
            // Commuting IS our materialization wait in live mode; both surface the same way.
            return { status: 'commuting', activeActionInstanceId: active.id };
        }
        const def = this.actionEngine.getDefinition(active.defId);
        if (active.defId === 'sleep') {
            return { status: 'sleeping', activeActionInstanceId: active.id };
        }
        if (def?.category === 'work') {
            return { status: 'working', activeActionInstanceId: active.id };
        }
        return { status: 'performing_action', activeActionInstanceId: active.id };
    }

    // Lifecycle phase 7 (038 §3.1): run hooks for every agent, resolve intents, and execute through the
    // Action engine (phase 8). `committed` carries the tick's event commits for onEventCommitted hooks.
    processTick(agentIds: PersonId[], deps: BrainDeps, committed: TickResult['committed'], result: TickResult): void {
        const committedByPerson = new Map<PersonId, { eventId: string; seq: number }[]>();
        for (const commit of committed) {
            const list = committedByPerson.get(commit.personId) ?? [];
            list.push({ eventId: commit.eventId, seq: commit.seq });
            committedByPerson.set(commit.personId, list);
        }

        for (const personId of [...agentIds].sort()) {
            const intents: ActionIntent[] = [];
            for (const hook of this.hooks) {
                if (hook.kind === 'onTick') {
                    intents.push(...hook.propose({ personId, deps, brain: this }));
                } else if (hook.kind === 'onEventCommitted') {
                    for (const event of committedByPerson.get(personId) ?? []) {
                        intents.push(...hook.propose({ personId, deps, brain: this, event }));
                    }
                }
                // Other kinds (arrival/shift/action hooks) are dispatched by their producers as those
                // systems land (046 follow-ups + 047); the registry accommodates them already.
            }
            this.resolveIntents(personId, intents, deps, result);
        }
    }

    // Deterministic arbitration: necessity, then priority, then hook registration order, then actionId.
    private resolveIntents(personId: PersonId, intents: ActionIntent[], deps: BrainDeps, result: TickResult): void {
        if (intents.length === 0) {
            return;
        }
        const hookOrder = new Map(this.hooks.map((hook, index) => [hook.id, index]));
        intents.sort((a, b) =>
            NECESSITY_RANK[b.necessity] - NECESSITY_RANK[a.necessity]
            || b.priority - a.priority
            || (hookOrder.get(a.sourceHook) ?? 99) - (hookOrder.get(b.sourceHook) ?? 99)
            || a.actionId.localeCompare(b.actionId)
        );

        for (const intent of intents) {
            const def = this.actionEngine.getDefinition(intent.actionId);
            if (!def) {
                continue;
            }
            const active = this.actionEngine.activeInstanceOf(personId);
            if (def.type === 'continuous' && active) {
                if (active.defId === intent.actionId) {
                    return; // already doing it — the winning intent is satisfied
                }
                if (!intent.mayInterrupt) {
                    continue; // can't displace the current activity; try the next intent
                }
                this.actionEngine.interrupt(active.id, { source: 'brain', causationId: intent.causationId }, deps, result);
            }
            const outcome = this.actionEngine.startAction(
                personId, intent.actionId, intent.params ?? {}, { source: 'brain', causationId: intent.causationId },
                deps, result, null, undefined, intent.locationOverride
            );
            if (outcome.ok && def.type === 'continuous') {
                return; // one continuous activity per person; lower intents wait for another tick
            }
            // Discrete intents (or failed starts) fall through to the next intent.
        }
    }

    // --- Free-time selection (038 §8): filter → score → deterministic weighted pick -----------------------

    selectFreeTimeAction(personId: PersonId, deps: BrainDeps): string | null {
        const context = this.actionEngine.contextFor(personId, deps);
        const candidates: { actionId: string; weight: number }[] = [];
        for (const [actionId, def] of Object.entries(this.actionEngine.getManifest())) {
            if (def.type !== 'continuous' || def.category === 'work' || def.category === 'obligation') {
                continue; // obligations are hook-driven, never free-time picks
            }
            const selection = def.selection;
            let weight = selection?.weight ?? 0;
            if (weight <= 0) {
                continue; // not selectable
            }
            if (selection?.cooldownTicks !== undefined && this.actionEngine.hasAction(personId, actionId, deps.tick, { withinTicks: selection.cooldownTicks })) {
                continue; // anti-repetition
            }
            if (def.requirements && !evaluatePredicate(def.requirements, context)) {
                continue; // hard gate
            }
            for (const modifier of selection?.modifiers ?? []) {
                if (evaluatePredicate(modifier.when, context)) {
                    weight *= modifier.multiply;
                }
            }
            if (weight > 0) {
                candidates.push({ actionId, weight });
            }
        }
        if (candidates.length === 0) {
            return null;
        }
        candidates.sort((a, b) => a.actionId.localeCompare(b.actionId));
        const rng = new SeededRandom(deps.state.worldSeed).fork(deps.tick).fork(hashStringToSeed(personId));
        const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
        let roll = rng.next() * total;
        for (const candidate of candidates) {
            roll -= candidate.weight;
            if (roll <= 0) {
                return candidate.actionId;
            }
        }
        return candidates[candidates.length - 1]!.actionId;
    }

    getActionEngine(): ActionEngine {
        return this.actionEngine;
    }
}

// --- Built-in hooks -----------------------------------------------------------------------------------------

// Woke up (onEventCommitted 'woke_up'): the canonical morning decision — obligation first (the obligation
// hook will catch the shift on this same tick), else pick a free-time activity now rather than idling.
const wokeUpHook: BrainHook = {
    id: 'wokeUp',
    kind: 'onEventCommitted',
    propose({ personId, deps, brain, event }): ActionIntent[] {
        if (event?.eventId !== 'woke_up') {
            return [];
        }
        const job = deps.jobOf?.(personId) ?? null;
        if (job && isOnShiftAtTick(job, deps.tick)) {
            return []; // the obligation hook owns the work intent — don't duplicate it
        }
        const pick = brain.selectFreeTimeAction(personId, deps);
        return pick ? [{
            actionId: pick,
            sourceHook: 'wokeUp',
            priority: 40,
            necessity: 'optional',
            mayInterrupt: false,
            causationId: event.seq,
        }] : [];
    },
};

// A continuous action just finished (observed as: committed stopped_working / no active instance) → the
// idle fallback below covers selection; this hook exists as the registration point for 047's refinements.
const actionCompletedHook: BrainHook = {
    id: 'actionCompleted',
    kind: 'onActionCompleted',
    propose(): ActionIntent[] {
        return [];
    },
};

// Inventory opportunity (onTick): something pocketable is lying at the person's location and they're not
// otherwise engaged → a discrete pocket action (038 §8's "natural variety in Possessions").
const inventoryOpportunityHook: BrainHook = {
    id: 'inventoryOpportunity',
    kind: 'onTick',
    propose({ personId, deps, brain }): ActionIntent[] {
        if (brain.statusOf(personId).status !== 'idle') {
            return [];
        }
        const context = brain.getActionEngine().contextFor(personId, deps);
        if (!context.objectAtLocation?.({ flag: 'pocketable' })) {
            return [];
        }
        return [{
            actionId: 'pocketed_small_object',
            sourceHook: 'inventoryOpportunity',
            priority: 15,
            necessity: 'optional',
            mayInterrupt: false,
            causationId: null,
        }];
    },
};

// Idle fallback (onTick, lowest priority): nobody stands around forever — pick a valid low-priority activity.
const idleFallbackHook: BrainHook = {
    id: 'idleFallback',
    kind: 'onTick',
    propose({ personId, deps, brain }): ActionIntent[] {
        if (brain.getActionEngine().activeInstanceOf(personId)) {
            return [];
        }
        const pick = brain.selectFreeTimeAction(personId, deps);
        return pick ? [{
            actionId: pick,
            sourceHook: 'idleFallback',
            priority: 10,
            necessity: 'optional',
            mayInterrupt: false,
            causationId: null,
        }] : [];
    },
};
