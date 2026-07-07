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

// Authored as an annual rate; the runtime (013d) converts it to a per-day hazard via the clock's ticksPerYear.
export interface ProbabilitySpec {
    perYear: number;
    factors?: ProbabilityFactor[];
}

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
    probability: ProbabilitySpec;
    effects: Effect[];
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

// Append-only per-person logs, keyed by genealogy PersonId. An event with co-participants is logged on the
// SUBJECT's log (the roles map records the others); role-holders can be found by scanning or, later, an index.
export type EventLogTable = Record<string, EventLogEntry[]>;

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
