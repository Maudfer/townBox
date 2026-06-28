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
}

// The manifest (src/json/events.json) keyed by event id.
export type EventManifest = Record<string, EventDefinition>;

// Per-person event history — the compact "space for time" record the runtime reads for hasEvent() queries
// (docs/tasks/013 §5.3). One entry per event id the person has experienced.
export type EventHistory = Record<string, { count: number; lastTick: number }>;

// All event history, keyed by genealogy PersonId. Serialized in the save as a side-table so GenPerson stays
// pure and history survives de/re-materialization.
export type EventHistoryTable = Record<string, EventHistory>;

// What one day of event simulation changed, so the caller can reconcile the materialized world.
export interface DayResult {
    died: string[];
    born: { id: string; motherId: string; fatherId: string }[];
    signals: { signal: string; personId: string | null; tick: number }[];
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
