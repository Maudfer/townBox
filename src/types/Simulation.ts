// Shared contract types for the procedural simulation framework (see
// docs/tasks/013-procedural-simulation-framework.md). These are the substrate both engines bind against:
// the value space a predicate can compare, and the SimulationContext a predicate is evaluated over. The
// concrete Context implementation (reading a materialized person's state + event history) lands with the
// event runtime (phase 013d); the substrate only depends on this interface, so curve/predicate stay pure
// and scene-free.

// The comparable value space for attributes and predicate operands.
export type Value = string | number | boolean;

// Optional qualifiers on a hasEvent query: within the last N in-game days, and/or at least N occurrences.
export interface HasEventQuery {
    withinDays?: number;
    minCount?: number;
}

// The read-only view a predicate (and, later, a probability factor) evaluates against. An implementation
// represents one agent at one moment: its attributes, its event history, and access to any co-participants
// bound to named roles for a multi-agent event. Deliberately method-based so the substrate never reaches
// into engine internals — it only asks questions through this interface.
export interface SimulationContext {
    // The current value of a named attribute (Context schema, e.g. "alive", "age", "marital"), or
    // undefined when the attribute is not present.
    getAttr(name: string): Value | Value[] | undefined;

    // Whether this agent has the given event in its history, optionally constrained by recency/count.
    hasEvent(eventId: string, query?: HasEventQuery): boolean;

    // The sub-context for a co-participant bound to `name` (e.g. "father", "partner"), or null when no
    // such role is bound. Used by the { role, where } predicate to condition on another participant.
    role(name: string): SimulationContext | null;
}
