// The map-backed WorldAdapter (task 040): backs the `live` execution mode. Locations derive from the
// materialized world (a person's current building), and a transition request starts the real commute
// machinery, returning a PENDING handle that resolves when the visual layer confirms arrival. Nothing in
// production requests transitions yet (the Action engine, task 043, will); the contract and its lifecycle
// are exercised by tests so live and bootstrap provably emit the same records.
//
// Resolution model: `pump()` is called on the minute cadence (City.handleCommute) and flips pending handles
// whose person has reached the target building. Task 046 refines this into onLocationArrived hooks.

import Person from 'game/agents/Person';
import Inventory from 'game/objects/Inventory';
import Building from 'game/world/Building';
import House from 'game/world/House';
import { LogicalLocation, TransitionHandle, WorldAdapter, SimulationMode } from 'types/Execution';
import { PersonId } from 'types/Genealogy';
import { locationKey } from 'types/Objects';

export interface LiveWorldDeps {
    getPeople(): Person[];
    buildingByKey(key: string): Building | null;
    startCommute(person: Person, destination: Building): void;
    getInventory?(): Inventory | null;
}

export default class LiveWorld implements WorldAdapter {
    readonly mode: SimulationMode = 'live';

    private deps: LiveWorldDeps;
    private nextHandleId = 0;
    private pending: TransitionHandle[] = [];

    constructor(deps: LiveWorldDeps) {
        this.deps = deps;
    }

    private findPerson(personId: PersonId): Person | null {
        for (const person of this.deps.getPeople()) {
            if (person.social.getPersonId() === personId) {
                return person;
            }
        }
        return null;
    }

    locationOf(personId: PersonId): LogicalLocation {
        const person = this.findPerson(personId);
        if (!person) {
            return { kind: 'outside' };
        }
        const building = person.getCurrentBuilding();
        if (!building) {
            return { kind: 'outside' };
        }
        if (building instanceof House && building === person.social.getHome()) {
            return { kind: 'home' };
        }
        return { kind: 'building', key: building.getIdentifier() };
    }

    // Concrete object location (task 070): the current building's own key, home included — every house has
    // its own object pool (the shared 'home' key was a pre-070 wart that never mattered while nothing
    // seeded buildings).
    objectLocationOf(personId: PersonId): LogicalLocation {
        const person = this.findPerson(personId);
        const building = person?.getCurrentBuilding();
        if (!person || !building) {
            return { kind: 'outside' };
        }
        return { kind: 'building', key: building.getIdentifier() };
    }

    peopleAt(location: LogicalLocation): PersonId[] {
        const ids: PersonId[] = [];
        for (const person of this.deps.getPeople()) {
            const id = person.social.getPersonId();
            if (!id) {
                continue;
            }
            const current = this.locationOf(id);
            if (current.kind === location.kind && JSON.stringify(current) === JSON.stringify(location)) {
                ids.push(id);
            }
        }
        return ids.sort();
    }

    objectsAt(location: LogicalLocation): string[] {
        const inventory = this.deps.getInventory?.() ?? null;
        return (inventory?.instancesAtLocation(locationKey(location)) ?? []).map(instance => instance.id);
    }

    private targetBuilding(person: Person, target: LogicalLocation): Building | null {
        if (target.kind === 'home') {
            return person.social.getHome();
        }
        if (target.kind === 'building') {
            return this.deps.buildingByKey(target.key);
        }
        // Abstract venues have no map backing yet (tasks 041/046 map them to real buildings).
        return null;
    }

    requestTransition(personId: PersonId, target: LogicalLocation, tick: number, causationId: number | null): TransitionHandle {
        const handle: TransitionHandle = {
            id: this.nextHandleId++,
            personId,
            target,
            status: 'pending',
            requestedAtTick: tick,
            resolvedAtTick: null,
            causationId,
        };

        const person = this.findPerson(personId);
        const destination = person ? this.targetBuilding(person, target) : null;
        if (!person || !destination) {
            handle.status = 'cancelled';
            handle.resolvedAtTick = tick;
            return handle;
        }
        if (person.getCurrentBuilding() === destination) {
            handle.status = 'arrived'; // already there — resolves immediately, like bootstrap
            handle.resolvedAtTick = tick;
            return handle;
        }

        this.deps.startCommute(person, destination);
        this.pending.push(handle);
        return handle;
    }

    // Flips pending handles whose person has physically arrived. Called on the minute cadence.
    pump(tick: number): void {
        if (this.pending.length === 0) {
            return;
        }
        const unresolved: TransitionHandle[] = [];
        for (const handle of this.pending) {
            const person = this.findPerson(handle.personId);
            const destination = person ? this.targetBuilding(person, handle.target) : null;
            if (!person || !destination) {
                handle.status = 'cancelled';
                handle.resolvedAtTick = tick;
                continue;
            }
            if (person.getCurrentBuilding() === destination) {
                handle.status = 'arrived';
                handle.resolvedAtTick = tick;
                continue;
            }
            unresolved.push(handle);
        }
        this.pending = unresolved;
    }

    getPending(): TransitionHandle[] {
        return this.pending;
    }
}
