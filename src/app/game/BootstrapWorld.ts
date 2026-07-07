// The non-visual WorldAdapter (task 040): backs the `bootstrap` execution mode (history bootstrap today,
// the offline history-asset generator in task 055). Locations are plain state and transitions resolve
// IMMEDIATELY — same request, same handle lifecycle, no materialization wait. Deterministic: handle ids are
// a simple counter and no RNG is consumed.

import { PersonId } from 'types/Genealogy';
import { LogicalLocation, TransitionHandle, WorldAdapter, SimulationMode } from 'types/Execution';
import { locationKey } from 'types/Objects';
import Inventory from 'game/Inventory';

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

    peopleAt(location: LogicalLocation): PersonId[] {
        const ids: PersonId[] = [];
        for (const [personId, current] of this.locations) {
            if (sameLocation(current, location)) {
                ids.push(personId);
            }
        }
        return ids.sort();
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
    return true;
}
