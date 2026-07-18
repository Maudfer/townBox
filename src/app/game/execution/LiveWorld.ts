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
import { CADENCE_SALT } from 'game/events/LifeLog';
import { LogicalLocation, TransitionHandle, WorldAdapter, SimulationMode } from 'types/Execution';
import { PersonId } from 'types/Genealogy';
import { locationKey } from 'types/Objects';
import { SeededRandom, hashStringToSeed } from 'util/random';
import Workplace from 'game/world/Workplace';
import venuesConfig from 'json/venues.json';

// Venue kind -> hosting blueprint keys (task 107). Data-registered; validated against actions + blueprints.
const VENUE_HOSTS = venuesConfig as Record<string, string[]>;

export interface LiveWorldDeps {
    getPeople(): Person[];
    buildingByKey(key: string): Building | null;
    // All placed structures (task 107): venue resolution scans for hosting businesses. Optional so minimal
    // pre-107 doubles keep working (venues then resolve to nothing, as before).
    listBuildings?(): Building[];
    startCommute(person: Person, destination: Building): void;
    getInventory?(): Inventory | null;
}

// Departure spreading (LP-11 / proposal simulation-aliveness-2 M1): commutes leave within the first
// DEPART_JITTER_MINUTES of the hour instead of all at :00 — the whole-town synchronized pulse dissolves,
// while the bound keeps obligation arrivals from slipping a full hour.
export const DEPART_JITTER_MINUTES = 15;

export default class LiveWorld implements WorldAdapter {
    readonly mode: SimulationMode = 'live';

    private deps: LiveWorldDeps;
    private nextHandleId = 0;
    private pending: TransitionHandle[] = [];
    // Venue targets resolve ONCE at request time (task 107) — the person walks to THAT building even if a
    // nearer host opens mid-trip. Keyed by handle id; dropped when the handle leaves pending.
    private resolvedVenues: Map<number, string> = new Map();
    // Commutes waiting for their departure minute (LP-11), keyed by handle id.
    private departures: Map<number, { person: Person; destination: Building; departMinute: number }> = new Map();

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

    private targetBuilding(person: Person, target: LogicalLocation, resolvedKey?: string): Building | null {
        if (target.kind === 'home') {
            return person.social.getHome();
        }
        if (target.kind === 'building') {
            return this.deps.buildingByKey(target.key);
        }
        if (target.kind === 'venue') {
            // Grounded venues (task 107): a pending trip keeps its once-resolved host; a fresh request
            // resolves to the NEAREST placed, occupied hosting business (deterministic tie-break by key).
            if (resolvedKey !== undefined) {
                return this.deps.buildingByKey(resolvedKey);
            }
            return this.nearestVenueHost(person, target.venue);
        }
        return null;
    }

    // The nearest placed, occupied business whose blueprint hosts the venue kind (task 107). Pixel Manhattan
    // distance from the person's current position; anchor-key tie-break. Null = the town has no such place.
    private nearestVenueHost(person: Person, venue: string): Building | null {
        const hosts = VENUE_HOSTS[venue];
        if (!hosts || !this.deps.listBuildings) {
            return null;
        }
        let best: Building | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;
        let bestKey = '';
        for (const building of this.deps.listBuildings()) {
            if (!(building instanceof Workplace)) {
                continue;
            }
            const blueprintKey = building.getBusiness()?.blueprintKey;
            if (!blueprintKey || !hosts.includes(blueprintKey)) {
                continue;
            }
            const entrance = building.getEntrance?.();
            const at = person.getPixelPosition?.();
            const distance = entrance && at ? Math.abs(entrance.x - at.x) + Math.abs(entrance.y - at.y) : 0;
            const key = building.getIdentifier();
            if (distance < bestDistance || (distance === bestDistance && key < bestKey)) {
                best = building;
                bestDistance = distance;
                bestKey = key;
            }
        }
        return best;
    }

    hasVenue(venue: string): boolean {
        const hosts = VENUE_HOSTS[venue];
        if (!hosts || !this.deps.listBuildings) {
            return false;
        }
        return this.deps.listBuildings().some(building => {
            const blueprintKey = building instanceof Workplace ? building.getBusiness()?.blueprintKey : undefined;
            return blueprintKey !== undefined && hosts.includes(blueprintKey);
        });
    }

    // The business occupying this building, if any (task 113): a purchase made HERE is at a real shop —
    // its shelf is the truth, and the conjuring fallback is retired.
    businessAt(location: LogicalLocation): string | null {
        if (location.kind !== 'building') {
            return null;
        }
        const building = this.deps.buildingByKey(location.key);
        return building instanceof Workplace && building.getBusiness() ? location.key : null;
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
        // Stepping OUTSIDE (task 093 / E1): pre-093 this cancelled and outdoor actions blocked in live mode.
        // Now the person steps out the door — visible at the entrance, no longer in the building — and the
        // handle resolves immediately (the walk itself is the ambulatory action's business, not a commute).
        if (person && target.kind === 'outside') {
            const building = person.getCurrentBuilding();
            if (building) {
                // Optional calls: the scene-facing bits are absent on minimal test doubles (arcScenarios).
                const entrance = building.getEntrance?.();
                if (entrance) {
                    person.setPosition?.(entrance.x, entrance.y);
                }
                person.setIndoors?.(false);
                person.setCurrentBuilding?.(null);
            }
            handle.status = 'arrived';
            handle.resolvedAtTick = tick;
            return handle;
        }
        const destination = person ? this.targetBuilding(person, target) : null;
        if (!person || !destination) {
            handle.status = 'cancelled';
            handle.resolvedAtTick = tick;
            return handle;
        }
        if (target.kind === 'venue') {
            this.resolvedVenues.set(handle.id, destination.getIdentifier());
        }
        if (person.getCurrentBuilding() === destination) {
            handle.status = 'arrived'; // already there — resolves immediately, like bootstrap
            handle.resolvedAtTick = tick;
            return handle;
        }

        // Departure spreading (LP-11): the commute physically starts at a deterministic minute within the
        // jitter window — pumped by the minute cadence below — instead of the whole town stepping out at
        // :00. Deterministic per (person, tick); a stream of its own, perturbing no decision stream.
        const departMinute = new SeededRandom(hashStringToSeed(personId)).fork(tick).fork(CADENCE_SALT).nextInt(0, DEPART_JITTER_MINUTES - 1);
        this.departures.set(handle.id, { person, destination, departMinute });
        this.pending.push(handle);
        return handle;
    }

    // Flips pending handles whose person has physically arrived, and starts deferred commutes whose
    // departure minute has come. Called on the minute cadence (minuteOfHour from the clock; callers
    // without minute context — tests, catch-up paths — omit it and everything departs immediately).
    pump(tick: number, minuteOfHour?: number): void {
        if (this.pending.length === 0) {
            return;
        }
        const unresolved: TransitionHandle[] = [];
        for (const handle of this.pending) {
            // Deferred departure first: past the minute (or any later tick — the catch-up), start the walk.
            const departure = this.departures.get(handle.id);
            if (departure) {
                const due = minuteOfHour === undefined || tick > handle.requestedAtTick || minuteOfHour >= departure.departMinute;
                if (due) {
                    this.departures.delete(handle.id);
                    this.deps.startCommute(departure.person, departure.destination);
                } else {
                    unresolved.push(handle); // not yet left home — nothing to resolve or cancel
                    continue;
                }
            }
            const person = this.findPerson(handle.personId);
            const destination = person ? this.targetBuilding(person, handle.target, this.resolvedVenues.get(handle.id)) : null;
            if (!person || !destination) {
                handle.status = 'cancelled';
                handle.resolvedAtTick = tick;
                this.resolvedVenues.delete(handle.id);
                this.departures.delete(handle.id);
                continue;
            }
            if (person.getCurrentBuilding() === destination) {
                handle.status = 'arrived';
                handle.resolvedAtTick = tick;
                this.resolvedVenues.delete(handle.id);
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
