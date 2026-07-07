import { Predicate } from 'util/predicate';
import { Curve } from 'util/curve';
import { Value } from 'types/Simulation';

// Engine B — life-event manifest schema (docs/tasks/013-procedural-simulation-framework_DONE.md §5). An event is a
// flat, self-describing record: who participates (roles), how likely it is (probability), and what it does
// (effects). Events never reference each other for compatibility; the compiler (game/EventCompiler.ts) derives
// dependencies and mutual exclusivity structurally from each event's own requirements + effects.

// A participant in an event. `subject` is the implicit ticked person and is conventionally declared so its
// eligibility predicate can be stated. Other roles either search for a candidate (`where`) or bind through an
// indexed relation (`bind`, e.g. "partnerOf:subject") resolved at runtime.
export interface RoleSpec {
    where?: Predicate;
    bind?: string;
}

// A multiplicative modifier on the base rate: a curve evaluated at a driving attribute (e.g. "subject.age").
export interface ProbabilityFactor {
    driver: string;
    curve: Curve;
}

// Authored as an annual rate; the runtime converts it to a per-tick hazard via the clock's ticksPerYear.
export interface ProbabilitySpec {
    perYear: number;
    factors?: ProbabilityFactor[];
}

// --- Triggers (task 042; docs/tasks/038 §6) -------------------------------------------------------------
//
// Every event declares HOW it can happen via `triggers`; the validator errors on an event with none. An
// event may declare several types (e.g. a manual action-driven commit plus an automated fallback).

// Programmatically invokable through EventEngine.invoke() — by Actions (043), Brain (046), the Job
// Orchestrator (047), or any other system. "Manual" means caller-driven, NOT player-manual.
export interface ManualTriggerSpec {
    // Non-subject roles the caller must supply in `bindings` (they carry caller context the engine can't
    // search for, e.g. the specific target of a social action). Other roles resolve as usual (bind/search).
    requiredBindings?: string[];
}

// Deterministic schedule rules, represented as real work in the simulation timeline (the engine's schedule
// queue / the atHour sweep) — never invisible direct mutations.
export type ScheduleRule =
    // Fires for the SOURCE event's subject `delayTicks` after each commit of `afterEvent` (causation chains
    // to that commit). The "automated shift-end fallback" pattern.
    | { afterEvent: string; delayTicks: number }
    // Fires at the given hour of day (0..23) for every eligible subject, every day (limits gate repeats).
    | { atHour: number };

export interface AutomatedTriggerSpec {
    rules: ScheduleRule[];
}

export interface TriggerSpec {
    probabilistic?: ProbabilitySpec;
    manual?: ManualTriggerSpec;
    automated?: AutomatedTriggerSpec;
}

// Occurrence limits (task 042): enforced by the engine against the aggregate history for every trigger
// path. `perJob`/`perRelationship` scopes are reserved (validator-gated) until jobs/relationships carry the
// context to key them (tasks 045+).
export type OccurrenceLimit =
    | { once: 'ever' | 'perDay' }
    | { withinTicks: number };

// One queued automated trigger: event `eventId` should be attempted for `subjectId` at `dueTick`. `id` is a
// deterministic counter (drain order: dueTick, then id); `causationId` chains to the scheduling commit.
export interface ScheduledTrigger {
    id: number;
    eventId: string;
    subjectId: string;
    dueTick: number;
    causationId: number | null;
}

// The serializable schedule-queue state (save v8 family).
export interface ScheduleState {
    queue: ScheduledTrigger[];
    nextScheduleSeq: number;
}

// Typed result of a manual invocation — failures are explicit, never silent skips.
export type InvokeOutcome =
    | { ok: true; seq: number }
    | { ok: false; reason: 'unknownEvent' | 'notManual' | 'missingBinding' | 'ineligible' | 'rolesUnresolved' | 'limited' | 'aborted' };

// The closed, typed effect vocabulary. The set is fixed in code (adding a new primitive is a code change);
// manifests compose these freely (pure data). Fields are effect-specific and consumed by the runtime in 013d.
export type EffectType =
    | 'setDeath'
    | 'marry'
    | 'divorce'
    | 'birth'
    | 'setAttr'
    | 'acquireSlot'
    | 'releaseSlot'
    | 'adjustMoney'
    | 'acquireSkill'
    | 'emit';

export interface Effect {
    type: EffectType;
    attr?: string;
    value?: Value;
    role?: string;
    mother?: string;
    father?: string;
    signal?: string;
    target?: string;
    resource?: string;
    amount?: Curve;
}

export interface EventDefinition {
    roles: Record<string, RoleSpec>;
    // How the event can happen (task 042): probabilistic rolls, manual invocation, and/or automated schedule
    // rules. At least one type is required (validator-enforced).
    triggers: TriggerSpec;
    effects: Effect[];
    // Occurrence limit across ALL trigger paths (optional).
    limit?: OccurrenceLimit;
    // Presentation-only (task 032), ignored by the compiler and runtime: a human label for the person event-log
    // (027) and feed (029), and a coarse grouping for filtering/styling.
    label?: string;
    category?: string;
}

// The manifest (src/json/events.json) keyed by event id.
export type EventManifest = Record<string, EventDefinition>;

// Per-person event history — the compact aggregate index the runtime reads for O(1) hasEvent() queries
// (docs/tasks/013 §5.3). One entry per event id the person has experienced. Since task 040 this is a
// DERIVED index over the append-only event log below — the log is the source of truth for "what happened
// when"; the aggregate exists for query speed and stays serialized for cheap restore.
export type EventHistory = Record<string, { count: number; lastTick: number }>;

// All event history, keyed by genealogy PersonId. Serialized in the save as a side-table so GenPerson stays
// pure and history survives de/re-materialization.
export type EventHistoryTable = Record<string, EventHistory>;

// Where a committed record came from (task 040/042): today only probability rolls and system-synthesized
// migration entries exist; actions/brain/schedule sources arrive with tasks 042–046.
export type TriggerSource = 'probability' | 'action' | 'brain' | 'schedule' | 'system';

// One committed happening in a person's life — the append-only log entry (task 040, 038 §3.3). `seq` is a
// globally monotonic commit sequence (unique across ALL people), so same-tick records are totally ordered
// and causation chains (`causationId` = the seq of the record/intent that caused this one) are reproducible
// in both live and bootstrap simulation. `kind` gains 'action' with task 043.
export interface EventLogEntry {
    seq: number;
    tick: number;
    kind: 'event';
    defId: string; // event id in the manifest
    roles: Record<string, string>; // role name -> PersonId as bound at commit time
    triggerSource: TriggerSource;
    causationId: number | null; // seq of the causing record; null for spontaneous (probability) commits
}

// An action lifecycle transition in the same append-only log (task 043). One entry per transition
// ('performed' for discrete actions; started/completed/interrupted/blocked/failed for continuous ones),
// linked by instanceId — the log itself stays immutable.
export interface ActionLogEntry {
    seq: number;
    tick: number;
    kind: 'action';
    defId: string; // action id in the manifest
    instanceId: string | null; // null for discrete actions (no instance materializes)
    lifecycle: 'performed' | 'started' | 'completed' | 'interrupted' | 'blocked' | 'failed';
    params: Record<string, string | number | boolean>;
    parentInstanceId: string | null;
    triggerSource: TriggerSource;
    causationId: number | null;
}

// One person's life log holds both kinds, totally ordered by the shared seq.
export type PersonLogEntry = EventLogEntry | ActionLogEntry;

// Append-only per-person logs, keyed by genealogy PersonId. An event with co-participants is logged on the
// SUBJECT's log (the roles map records the others); role-holders can be found by scanning or, later, an index.
export type EventLogTable = Record<string, PersonLogEntry[]>;

// What one tick of event simulation changed, so the caller can reconcile the materialized world. Signals
// carry the emitting event and its log seq (task 040) so downstream world changes can chain causation.
export interface TickResult {
    died: string[];
    born: { id: string; motherId: string; fatherId: string }[];
    signals: { signal: string; personId: string | null; tick: number; eventId: string; causationId: number }[];
}

// The money adapter the event runtime consults so the pure engine can read wealth (the `money` Context
// attribute) and apply the `adjustMoney` effect without importing the Economy/Field layer (task 017).
export interface MoneyLedger {
    getPersonBalance(personId: string): number;
    adjustPerson(personId: string, delta: number): void;
}

// The employment adapter the event runtime consults so the pure engine can reason about (and effect) hiring
// without importing the materialized Workplace/Field layer (task 015). The concrete implementation lives in
// game/JobMarket.ts; the engine depends only on this interface, keeping it scene-free. All methods key on the
// genealogy PersonId. `hire` returns whether a slot was actually acquired (false aborts the get_job event).
export interface JobMarket {
    isEmployed(personId: string): boolean;
    canHire(personId: string): boolean;
    hire(personId: string): boolean;
    fire(personId: string): void;
}

// The housing adapter the event runtime consults so the pure engine can reason about move-out eligibility (the
// `canMoveOut` Context attribute) without importing the materialized House/Field layer (task 024). True when the
// person could actually leave home now: an adult living in a household they don't head, with a vacant home to
// move into. The concrete implementation lives in game/HousingMarket.ts; keyed on the genealogy PersonId.
export interface HousingMarket {
    canMoveOut(personId: string): boolean;
}

// The skill adapter the event runtime consults so education/training events can grant a real skill to a
// materialized person (the `acquireSkill` effect, task 032) without importing the WorkLife/Field layer. Returns
// whether the skill was newly added. The concrete implementation lives in game/SkillRegistry.ts; keyed on the
// genealogy PersonId.
export interface SkillRegistry {
    acquireSkill(personId: string, skill: string): boolean;
}
