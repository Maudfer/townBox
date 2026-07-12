import { TriggerSource } from 'types/LifeEvent';
import { Value } from 'types/Simulation';
import { Predicate } from 'util/predicate';

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
// A lifecycle -> event link (067): the string shorthand fires the event with no payload; the object form
// forwards a payload mapped from the action's own params ('$params.<name>') or literal scalars.
export type EventLink = string | { event: string; params?: Record<string, string | number | boolean> };

export interface ActionEventLinks {
    onStart?: EventLink;
    onComplete?: EventLink;
    onInterrupt?: EventLink;
    // Fired when an askFirst consent is DECLINED (task 074) — wired only where a downstream consumer exists
    // (curated: object transfers); everything else lets the failed log entry be the record.
    onDecline?: EventLink;
}

// The interaction contract every Person-targeted action must declare (task 072): which parameter names the
// target, same-building co-location (REQUIRED true this iteration — no remote interaction yet; the field
// exists so relaxing later is data), whether consent is asked first (073 implements the flow), whether the
// action may target its own actor, and how a declined/failed instance behaves as a sequence child.
export interface InteractionContract {
    targetParam: string;
    requiresSameBuilding: boolean;
    askFirst: boolean;
    allowSelf?: boolean;
    onDecline?: StepFailurePolicy;
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
    // Applied atomically when the action commits (discrete: at perform; continuous: at completion) — after
    // any object-action-relationship entry for the action (whose outputs these ops may reference).
    // The Person-target interaction contract (task 072) — validator-required on any action with a
    // person-typed parameter.
    interaction?: InteractionContract;
    consequences?: ConsequenceOp[];
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
    // Per-instance location requirement override (task 046): shared work actions run at the person's OWN
    // workplace, which only the caller knows.
    locationOverride?: string;
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
    // Output variables bound by the most recent step's consequences ("$previous.output", 038 §7.3/7.4).
    previousOutputs: Record<string, string>;
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
    | { ok: false; reason: 'unknownAction' | 'requirementsUnmet' | 'missingParameter' | 'targetNotPresent' | 'consentDeclined' | 'alreadyActive' | 'invalidParent' | 'inputsUnavailable' };

export interface ActionCause {
    source: TriggerSource;
    causationId: number | null;
}

// --- Consequences (task 044; docs/tasks/038 §7.4) ----------------------------------------------------------
//
// A bounded, declarative vocabulary — no scripting in JSON (the 013 flexibility line holds). Consequences
// apply ATOMICALLY per commit: every referenced object/target is resolved and validated first; any failure
// aborts the whole set with zero mutations and the action fails/blocks.

// Who receives/loses ownership. 'employer' resolves through the person's workplace (live) and is a typed
// failure when unresolvable; 'targetPerson' reads the action's `target` parameter.
export type OwnershipTarget = 'person' | 'targetPerson' | 'employer' | 'world' | 'none';

// Where an op finds its object. `param` reads an objectInstance parameter; `output` reads a variable bound
// earlier in this action/sequence; the query forms search carried Possessions or the current location.
export type ObjectRef =
    | { param: string }
    | { output: string }
    | { carried: { archetype?: string; tag?: string; flag?: string } }
    | { atLocation: { archetype?: string; tag?: string; flag?: string } };

export type ConsequenceOp =
    // Creates an instance (merging stacks per Inventory rules). `bindAs` names the output for later steps.
    | { op: 'createObject'; archetype: string; quantity?: number; state?: Record<string, Value>; owner?: OwnershipTarget; container?: 'possessions' | 'location'; bindAs?: string }
    | { op: 'consumeObject'; object: ObjectRef; quantity?: number }
    | { op: 'removeObject'; object: ObjectRef }
    // Physical movement only (ownership untouched): pocket something / put it down.
    | { op: 'moveObject'; object: ObjectRef; container: 'possessions' | 'location' }
    // Physical hand-off only (ownership untouched): the object lands in the target person's Possessions.
    // Lending and returning — the counterpart of moveObject when the destination is another person.
    | { op: 'moveObjectToPerson'; object: ObjectRef; target: 'targetPerson' }
    // Ownership only (location untouched): gifts, confiscation, purchases.
    | { op: 'transferObject'; object: ObjectRef; owner: OwnershipTarget }
    | { op: 'setObjectState'; object: ObjectRef; key: string; value: Value }
    // Approved person mutation: money through the ledger (never raw writes).
    | { op: 'adjustMoney'; amount: number; target?: 'person' | 'targetPerson' }
    // Fire a manual Event now / schedule an automated one — both through the Event engine, with causation.
    | { op: 'triggerEvent'; event: string }
    | { op: 'scheduleEvent'; event: string; afterTicks: number };

// --- Object-action relationships (task 044; docs/tasks/038 §7.6) -------------------------------------------
//
// Multi-input object transformations, keyed by entry id in object-action-relationships.json. An action may
// have several entries; at commit the FIRST entry (declaration order) whose inputs are all satisfiable
// applies. Inputs match against the person's carried instances (nested containers included).

export type InputDisposition = 'consumed' | 'retained' | 'transformed' | 'required';

export interface OARInput {
    archetype: string;
    state?: Record<string, Value>; // instance state that must match
    quantity?: number; // default 1
    disposition: InputDisposition;
    transformTo?: { archetype: string; state?: Record<string, Value> }; // required when disposition = transformed
    bindAs?: string; // names the (transformed) instance for later steps
}

export interface OAROutput {
    archetype: string;
    quantity?: number;
    state?: Record<string, Value>;
    owner?: OwnershipTarget; // default 'person'
    container?: 'possessions' | 'location'; // default 'possessions'
    bindAs?: string;
}

export interface OAREntry {
    action: ActionId;
    inputs: OARInput[];
    outputs: OAROutput[];
    // Contextual requirement: a matching instance must be present at the person's location (e.g. an oven).
    context?: { objectAtLocation?: { archetype?: string; tag?: string; flag?: string; archetypeParam?: string } };
}

export type OARTable = Record<string, OAREntry>;
