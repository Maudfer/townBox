import { Predicate } from 'util/predicate';
import { Curve } from 'util/curve';
import { Value } from 'types/Simulation';

// Engine B — life-event manifest schema (docs/tasks/013-procedural-simulation-framework.md §5). An event is a
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
