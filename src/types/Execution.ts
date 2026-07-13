// The simulation execution boundary (task 040; docs/tasks/038 §3.4). Live play and the history bootstrap run
// the SAME engines over the same data; the only sanctioned difference is this context: location-dependent
// behaviour asks the WorldAdapter for facts and transitions instead of branching on where it runs. In `live`
// mode a transition may stay pending until the visual layer confirms arrival; in `bootstrap` mode the same
// request resolves immediately — both emit identical lifecycle records. `mode` exists for logging/metrics
// only and must NEVER gate game logic.

import { AgendaAccess } from 'types/Agenda';
import { PersonId } from 'types/Genealogy';
import { JobMarket, MoneyLedger, HousingMarket, SkillRegistry } from 'types/LifeEvent';
import { HabitsReader } from 'types/Habits';
import { MoodReader } from 'types/Mood';
import { NeedsReader } from 'types/Needs';
import { RelationshipGraph } from 'types/Relationship';
import { ServiceCoverageReader } from 'types/Services';
import { TraitsReader } from 'types/Traits';

export type SimulationMode = 'live' | 'bootstrap';

// Where a person logically is. Live backs this with real map buildings; bootstrap keeps it as plain state.
// `venue` is an abstract location kind (park, shop, …) — populated by tasks 041/046 and 055's offline world.
export type LogicalLocation =
    | { kind: 'home' }
    | { kind: 'building'; key: string } // building anchor key ("row-col" on the map; logical id off-map)
    | { kind: 'venue'; venue: string }
    | { kind: 'outside' };

export type TransitionStatus = 'pending' | 'arrived' | 'cancelled';

// A location-transition request. Consumers hold the handle and react when `status` flips (the Action engine
// parks in `waiting_for_materialization` on a pending handle, task 043).
export interface TransitionHandle {
    id: number;
    personId: PersonId;
    target: LogicalLocation;
    status: TransitionStatus;
    requestedAtTick: number;
    resolvedAtTick: number | null;
    causationId: number | null;
}

export interface WorldAdapter {
    readonly mode: SimulationMode;
    locationOf(personId: PersonId): LogicalLocation;
    // Where the person's OBJECTS are (task 070): like locationOf, but always concrete — a resident at home
    // resolves to their house's building key, never the shared 'home' kind, so each house has its own
    // object pool. Action-location semantics ('sleep at home') keep using locationOf.
    objectLocationOf(personId: PersonId): LogicalLocation;
    peopleAt(location: LogicalLocation): PersonId[];
    // Object instance ids physically at the location (task 041) — the query "is there something pocketable
    // here" style requirements resolve through. Ids resolve against the Inventory (game/Inventory.ts).
    objectsAt(location: LogicalLocation): string[];
    requestTransition(personId: PersonId, target: LogicalLocation, tick: number, causationId: number | null): TransitionHandle;
}

// The adapter bundle the event engine consults (formerly a loose `adapters` bag; tasks 015/017/024/032).
export interface SimulationMarkets {
    jobMarket?: JobMarket | null;
    ledger?: MoneyLedger | null;
    housing?: HousingMarket | null;
    skills?: SkillRegistry | null;
    // The elective social graph (task 083): consent, target weighting, relationship predicates, and the
    // adjustRelationship effect/consequence all consult it. Null/absent = pre-graph contexts (pure tests).
    social?: RelationshipGraph | null;
    // The needs ledger (task 084): action commits credit their `satisfies`, selection reads urgency.
    // Null/absent = pre-needs contexts (pure tests) — selection multipliers read as 1.
    needs?: NeedsReader | null;
    // The agenda (task 085): the planner hook reads due entries; producers and the joint-activity
    // consequence enqueue. Null/absent = no planning (pure tests).
    agenda?: AgendaAccess | null;
    // Habits (task 095): vice practice bumps counters; selection reads the escalation multiplier.
    habits?: HabitsReader | null;
    // Mood (task 091): event valence lands impulses; consent/selection/vice gates read the meter.
    mood?: MoodReader | null;
    // City services (task 096): coverage ratios the hazards read (healthcare -> recovery). Derived daily.
    services?: ServiceCoverageReader | null;
    // Traits (task 087): temperament axes read by selection affinity and consent. Derived, never stored.
    traits?: TraitsReader | null;
}

export interface ExecutionContext {
    mode: SimulationMode;
    world: WorldAdapter;
    markets: SimulationMarkets;
}

// Optional finer per-phase attribution for the offline generator's --profile mode (task 079). The coarse
// TickProfiler (game/TickRunner) buckets to actions/events/progression/brain; when a SubProfiler is threaded
// through, Brain and the Action engine additionally accumulate per-hook and per-advance-sub-phase wall-clock
// so the dominant part of `brain` (~60%) and `actions` (~37%) can be pinpointed. Purely diagnostic — reading
// the clock never affects logic or the RNG stream, so determinism is untouched. Lives here (a neutral types
// home) so Brain/ActionEngine don't take a type-only import cycle on TickRunner.
export interface SubProfiler {
    // Per-Brain-hook propose() wall-clock, keyed by hook id (jobOrchestrator/schoolObligation/wokeUp/
    // socialOpportunity/inventoryOpportunity/idleFallback). idleFallback ≈ free-time selection cost;
    // inventoryOpportunity ≈ context build + object scans; socialOpportunity ≈ the 15%-gated manifest scan.
    brainHooks: Record<string, number>;
    // Intent arbitration + execution (resolveIntents → startAction/interrupt), incl. discrete-action
    // consequence planning and the consent-decline dispatch.
    brainResolve: number;
    // ActionEngine.advance sub-phases, keyed by phase (materialize/pool/sequence/completeWhen).
    actionsAdvance: Record<string, number>;
}
