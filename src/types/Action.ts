import { Predicate } from 'util/predicate';
import { Value } from 'types/Simulation';
import { TriggerSource } from 'types/LifeEvent';

// The Action system schema (task 043; docs/tasks/038 §7). Actions are what people DO (sleep, cook, wander,
// work); Events are what HAPPENED (logged life facts). Discrete Actions are instantaneous and log-worthy
// ("Grabbed a pencil"); continuous Actions span ticks with a full lifecycle and can orchestrate children.
// Consequences (world/object mutations) land with task 044 — in 043 Actions gate, run, log, and trigger
// manual Events through their lifecycle.

export type ActionId = string;
export type ActionInstanceId = string;

// The parameter type system distinguishes ARCHETYPE references ("cake" the recipe target) from INSTANCE
// references ("this specific raw dough in my Possessions") — 038 §7.3.
export type ActionParameterType = 'person' | 'objectArchetype' | 'objectInstance' | 'recipe' | 'string' | 'number' | 'boolean';

export interface ActionParameterSpec {
    type: ActionParameterType;
    required?: boolean;
}

// Selection metadata consumed by Brain's candidate scoring (task 046). Schema-complete now so content can be
// authored once; 043 validates it and stores it, 046 reads it.
export interface SelectionModifier {
    when: Predicate;
    multiply: number;
}

export interface SelectionSpec {
    weight?: number; // base selection weight (default 1)
    cooldownTicks?: number; // Brain-level anti-repetition (distinct from event limits)
    modifiers?: SelectionModifier[];
}

// A pool child (038 §7.5): a discrete action that may occur while the parent continuous action runs.
export interface PoolChildSpec {
    action: ActionId;
    chancePerTick: number; // 0..1 per occurrence slot
    maxPerTick?: number; // default 1
    cooldownTicks?: number; // min ticks between occurrences of this child (per parent instance)
    maxTotal?: number; // max occurrences over the parent instance's lifetime
    requirements?: Predicate; // per-child gate, evaluated at occurrence time
}

// A sequence step (038 §7.5): steps run in order, one per tick. `params` bind the child's parameters —
// values may be literals or bindings ("$parent.<param>", "$previous.output").
export interface SequenceStepSpec {
    action: ActionId;
    params?: Record<string, Value>;
}

export type StepFailurePolicy = 'blockParent' | 'skipStep' | 'failParent';

export type ChildrenSpec =
    | { mode: 'pool'; entries: PoolChildSpec[] }
    | { mode: 'sequence'; steps: SequenceStepSpec[]; onStepFailure?: StepFailurePolicy };

// Manual Events fired by the action lifecycle (through EventEngine.invoke, triggerSource 'action', causation
// = the lifecycle log entry). "Started working" fires when the Work Action STARTS — not when commuting begins.
export interface ActionEventLinks {
    onStart?: string;
    onComplete?: string;
    onInterrupt?: string;
}

export interface ActionDefinition {
    label: string;
    type: 'discrete' | 'continuous';
    // Broad behavior category (038 §8): obligations outrank leisure in Brain's intent resolution (046).
    category: 'obligation' | 'work' | 'leisure' | 'social' | 'recovery' | 'movement' | 'maintenance';
    requirements?: Predicate; // hard gate (shared predicate grammar v2)
    parameters?: Record<string, ActionParameterSpec>;
    selection?: SelectionSpec;
    // Continuous only: where the person must be. A canonical location key ('home', 'outside', 'venue:park',
    // 'building:<key>'); starting elsewhere requests a transition through the execution boundary and parks
    // the instance in waiting_for_materialization until arrival.
    location?: string;
    // Continuous only: completes after this many RUNNING ticks (mutually exclusive with sequence end).
    durationTicks?: number;
    // Continuous only: completes when this predicate becomes true (checked each running tick).
    completeWhen?: Predicate;
    children?: ChildrenSpec; // continuous only
    events?: ActionEventLinks;
}

export type ActionManifest = Record<ActionId, ActionDefinition>;

// --- Runtime ---------------------------------------------------------------------------------------------

export type ActionStatus = 'pending' | 'waiting_for_materialization' | 'running' | 'completed' | 'interrupted' | 'blocked' | 'failed';

export type ActionOutcome = 'completed' | 'interrupted' | 'blocked' | 'failed';

// A live (or finished) continuous-action instance. Discrete actions don't materialize instances — they
// commit straight to the log.
export interface ActionInstance {
    id: ActionInstanceId;
    defId: ActionId;
    personId: string;
    params: Record<string, Value>;
    status: ActionStatus;
    startedTick: number; // when the instance was created (requested)
    runningSinceTick: number | null; // when it actually entered `running` (post-materialization)
    endedTick: number | null;
    outcome: ActionOutcome | null;
    parentInstanceId: ActionInstanceId | null;
    causationId: number | null; // seq of the record/intent that started it
    startLogSeq: number | null; // seq of the 'started' log entry (causation for children/lifecycle events)
    ticksRun: number;
    transitionHandleId: number | null; // pending world transition, when waiting_for_materialization
    sequenceIndex: number; // next step to run (sequence children)
    // Per-child occurrence bookkeeping for pool children: count + last occurrence tick.
    poolState: Record<ActionId, { count: number; lastTick: number }>;
    lastPoolChild: string | null; // interleaving: the last child that occurred within the current tick
}

// Aggregate action history (mirror of the event aggregate): O(1) hasAction queries.
export type ActionHistory = Record<string, Record<ActionId, { count: number; lastTick: number }>>;

// The serializable Action-engine state (save v8 family).
export interface ActionEngineState {
    instances: Record<ActionInstanceId, ActionInstance>;
    nextInstanceSeq: number;
    actionHistory: ActionHistory;
}

// Typed result of starting an action — failures are explicit, never silent skips.
export type ActionStartOutcome =
    | { ok: true; instanceId: ActionInstanceId | null; logSeq: number } // instanceId null for discrete actions
    | { ok: false; reason: 'unknownAction' | 'requirementsUnmet' | 'missingParameter' | 'alreadyActive' | 'invalidParent' };

export interface ActionCause {
    source: TriggerSource;
    causationId: number | null;
}
