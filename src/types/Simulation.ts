// Shared contract types for the procedural simulation framework (see
// docs/tasks/013-procedural-simulation-framework_DONE.md). These are the substrate both engines bind against:
// the value space a predicate can compare, and the SimulationContext a predicate is evaluated over. The
// concrete Context implementation (reading a materialized person's state + event history) lands with the
// event runtime (phase 013d); the substrate only depends on this interface, so curve/predicate stay pure
// and scene-free.

// The comparable value space for attributes and predicate operands.
export type Value = string | number | boolean;

// Optional qualifiers on a hasEvent query: within the last N in-game days, and/or at least N occurrences.
export interface HasEventQuery {
    withinTicks?: number;
    minCount?: number;
}

// A parameterized query against the object system (task 043): matches instances by archetype id, archetype
// tag, and/or archetype flag (e.g. "pocketable"). All supplied criteria must match.
export interface ObjectQuery {
    archetype?: string;
    tag?: string;
    flag?: string;
    // Task 067: resolve the archetype from the evaluating ACTION's parameter of this name (declared type
    // objectArchetype). Lets one generic action ("Grab X") require X-at-location as pure data. Only
    // meaningful where params exist (action requirements, OAR context) — validators reject it in event
    // predicates.
    archetypeParam?: string;
}

// The read-only view a predicate (and, later, a probability factor) evaluates against. An implementation
// represents one agent at one moment: its attributes, its event history, and access to any co-participants
// bound to named roles for a multi-agent event. Deliberately method-based so the substrate never reaches
// into engine internals — it only asks questions through this interface.
//
// The action-era queries (task 043) are optional: contexts that predate the Action engine (event-only
// fixtures, the compiler's static walk) simply lack them, and the corresponding predicates evaluate false.
export interface SimulationContext {
    // The current value of a named attribute (Context schema, e.g. "alive", "age", "marital"), or
    // undefined when the attribute is not present.
    getAttr(name: string): Value | Value[] | undefined;

    // Whether this agent has the given event in its history, optionally constrained by recency/count.
    hasEvent(eventId: string, query?: HasEventQuery): boolean;

    // The sub-context for a co-participant bound to `name` (e.g. "father", "partner"), or null when no
    // such role is bound. Used by the { role, where } predicate to condition on another participant.
    role(name: string): SimulationContext | null;

    // Whether this agent has performed the given ACTION, optionally constrained by recency/count (task 043
    // — the mirror of hasEvent over the action log).
    hasAction?(actionId: string, query?: HasEventQuery): boolean;

    // Whether this agent carries a matching Object Instance in their Possessions (nested containers
    // included) — task 043, backed by the Inventory (041).
    carries?(query: ObjectQuery): boolean;

    // Whether a matching Object Instance is physically present at this agent's current location — task 043,
    // backed by WorldAdapter.objectsAt (040/041).
    objectAtLocation?(query: ObjectQuery): boolean;
}
