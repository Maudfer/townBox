// The non-visual WorldAdapter (task 040): backs the `bootstrap` execution mode (history bootstrap today,
// the offline history-asset generator in task 055). Locations are plain state and transitions resolve
// IMMEDIATELY — same request, same handle lifecycle, no materialization wait. Deterministic: handle ids are
// a simple counter and no RNG is consumed.

import Inventory from 'game/objects/Inventory';
import { LogicalLocation, TransitionHandle, WorldAdapter, SimulationMode } from 'types/Execution';
import { PersonId } from 'types/Genealogy';
import { locationKey } from 'types/Objects';
import { count } from 'util/perfMeter';

export default class BootstrapWorld implements WorldAdapter {
    readonly mode: SimulationMode = 'bootstrap';

    // Optional: worlds without an object system (pure event tests) answer objectsAt with [].
    private inventory: Inventory | null;

    constructor(inventory: Inventory | null = null) {
        this.inventory = inventory;
    }

    private locations: Map<PersonId, LogicalLocation> = new Map();
    private nextHandleId = 0;
    // Kept for inspection/tests: every transition ever requested, in order.
    private transitions: TransitionHandle[] = [];

    locationOf(personId: PersonId): LogicalLocation {
        return this.locations.get(personId) ?? { kind: 'home' };
    }

    // Off-map, locations are already logical: object location == location. 055's logical world gives homes
    // distinct keys; until then the bootstrap 'home' stays a shared logical place (mode-consistent for tests).
    objectLocationOf(personId: PersonId): LogicalLocation {
        return this.locationOf(personId);
    }

    // Declare a person as present in this logical world (task 072): people default to {kind:'home'} but
    // peopleAt can only enumerate KNOWN people — hosts (tests today; 055's offline world) register their
    // agents so co-location queries see everyone, not just those who already transitioned somewhere.
    register(personId: PersonId): void {
        if (!this.locations.has(personId)) {
            this.locations.set(personId, { kind: 'home' });
        }
    }

    peopleAt(location: LogicalLocation): PersonId[] {
        count('world.peopleAt'); // perf: co-location queries — social hook rolls its RNG gate BEFORE calling (task 079)
        const ids: PersonId[] = [];
        for (const [personId, current] of this.locations) {
            if (sameLocation(current, location)) {
                ids.push(personId);
            }
        }
        return ids.sort();
    }

    hasVenue(): boolean {
        return true; // abstract venues always exist off-map (task 107)
    }

    objectsAt(location: LogicalLocation): string[] {
        return (this.inventory?.instancesAtLocation(locationKey(location)) ?? []).map(instance => instance.id);
    }

    requestTransition(personId: PersonId, target: LogicalLocation, tick: number, causationId: number | null): TransitionHandle {
        const handle: TransitionHandle = {
            id: this.nextHandleId++,
            personId,
            target,
            status: 'arrived', // no visual layer to wait for — the person is logically there this tick
            requestedAtTick: tick,
            resolvedAtTick: tick,
            causationId,
        };
        this.locations.set(personId, target);
        this.transitions.push(handle);
        return handle;
    }

    getTransitions(): TransitionHandle[] {
        return this.transitions;
    }
}

export function sameLocation(a: LogicalLocation, b: LogicalLocation): boolean {
    if (a.kind !== b.kind) {
        return false;
    }
    if (a.kind === 'building' && b.kind === 'building') {
        return a.key === b.key;
    }
    if (a.kind === 'venue' && b.kind === 'venue') {
        return a.venue === b.venue;
    }
    if (a.kind === 'outside' && b.kind === 'outside') {
        // Cell-scoped outdoors (V2): equal when the same cell (or both cell-less — the abstract outside
        // bootstrap/logical worlds use throughout, so this stays town-wide off-map, the sanctioned seam).
        return a.cell === b.cell;
    }
    return true;
}
