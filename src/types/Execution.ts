// The simulation execution boundary (task 040; docs/tasks/038 §3.4). Live play and the history bootstrap run
// the SAME engines over the same data; the only sanctioned difference is this context: location-dependent
// behaviour asks the WorldAdapter for facts and transitions instead of branching on where it runs. In `live`
// mode a transition may stay pending until the visual layer confirms arrival; in `bootstrap` mode the same
// request resolves immediately — both emit identical lifecycle records. `mode` exists for logging/metrics
// only and must NEVER gate game logic.

import { PersonId } from 'types/Genealogy';
import { JobMarket, MoneyLedger, HousingMarket, SkillRegistry } from 'types/LifeEvent';

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
}

export interface ExecutionContext {
    mode: SimulationMode;
    world: WorldAdapter;
    markets: SimulationMarkets;
}
