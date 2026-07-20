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
import { isOnShiftAtTick } from 'util/shifts';
import Workplace from 'game/world/Workplace';
import venuesConfig from 'json/venues.json';

// Venue kind -> hosting blueprint keys (task 107). Data-registered; validated against actions + blueprints.
const VENUE_HOSTS = venuesConfig as Record<string, string[]>;

// Outdoor co-location scoping (V2 / aliveness-4): the map is bucketed into OUTDOOR_CELL_TILES-tile patches;
// two outdoor people co-locate only within the same patch. 4 tiles (64px) is "the same bit of street" — big
// enough that a couple walking together stays co-located, small enough that a lend across town cannot happen.
const OUTDOOR_CELL_TILES = 4;
const OUTDOOR_TILE_PX = 16;

export interface LiveWorldDeps {
    getPeople(): Person[];
    buildingByKey(key: string): Building | null;
    // All placed structures (task 107): venue resolution scans for hosting businesses. Optional so minimal
    // pre-107 doubles keep working (venues then resolve to nothing, as before).
    listBuildings?(): Building[];
    startCommute(person: Person, destination: Building): void;
    getInventory?(): Inventory | null;
    // Whether a building currently has an open fire (V4 / aliveness-4): a located transition INTO a burning
    // building is refused, so nobody walks back in to sleep/work while it burns (the audit's man who went
    // back to bed in his burning house). Optional — pre-V4 doubles never block.
    isBurning?(buildingKey: string): boolean;
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
    // The venue clock (W2 / P1-2): opening hours read the last simulated tick — updated by every
    // requestTransition and pump, so hasVenue/nearestVenueHost answer for "now" without a clock dependency.
    private lastTick = 0;
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
            // Outdoors: tag the patch of street the body stands in (V2), so co-location is LOCAL — two
            // pedestrians only meet when they are actually near each other, not town-wide.
            return { kind: 'outside', cell: this.outdoorCellOf(person) };
        }
        if (building instanceof House && building === person.social.getHome()) {
            return { kind: 'home' };
        }
        return { kind: 'building', key: building.getIdentifier() };
    }

    // The street-cell key for an outdoor person's pixel position (V2 / aliveness-4). Buckets the map into
    // OUTDOOR_CELL_TILES-sized patches; two people in the same patch co-locate. A grid bucket has the usual
    // boundary approximation (neighbours across a cell edge miss), accepted per the proposal — the point is
    // that a lend/hug/chat can no longer cross the whole map. Cell-less fallback if the position is unknown.
    private outdoorCellOf(person: Person): string | undefined {
        const position = person.getPixelPosition?.() ?? person.getPosition?.();
        if (!position) {
            return undefined;
        }
        const cellPx = OUTDOOR_CELL_TILES * OUTDOOR_TILE_PX;
        const cellRow = Math.floor(position.y / cellPx);
        const cellCol = Math.floor(position.x / cellPx);
        return `${cellRow}-${cellCol}`;
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
        // A cell-less `{kind:'outside'}` query means "anyone outdoors, anywhere" (V2): the global check the
        // pursuit/dispatch hooks want ("is a chase on somewhere?"). A cell-scoped outside query returns only
        // the people in that street patch — the LOCAL co-location the social hook and witnesses want.
        const outsideAnywhere = location.kind === 'outside' && location.cell === undefined;
        const ids: PersonId[] = [];
        for (const person of this.deps.getPeople()) {
            const id = person.social.getPersonId();
            if (!id) {
                continue;
            }
            const current = this.locationOf(id);
            const match = outsideAnywhere
                ? current.kind === 'outside'
                : locationKey(current) === locationKey(location);
            if (match) {
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
            if (!this.venueHostOpen(building)) {
                continue; // closed (W2/P1-2): nobody walks to a dark shop
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
            return blueprintKey !== undefined && hosts.includes(blueprintKey) && this.venueHostOpen(building as Workplace);
        });
    }

    // Opening hours (W2 / proposal simulation-aliveness-3 P1-2): a venue is OPEN while at least one of its
    // employees is on shift — the audit watched 2 AM shopping trips at unstaffed shops. Derived from the
    // authored shifts (no new data); an unstaffed business is closed until the labor loop (W1) staffs it.
    // Live-only truth: bootstrap/logical venues stay abstract and always open (the seam's sanctioned
    // difference), so off-map lives and the generator are untouched.
    private venueHostOpen(building: Workplace): boolean {
        const employees = building.getEmployees?.() ?? [];
        return employees.some(employee => {
            const job = employee.work?.getJob?.();
            return !!job && isOnShiftAtTick(job, this.lastTick);
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
        this.lastTick = tick; // the venue clock (W2/P1-2)
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
        // Now the person steps out the door — onto the curb of the connected street (W8 follow-up; the
        // entrance pixel sits inside the footprint and read as "standing on the house sprite") — and the
        // handle resolves immediately (the walk itself is the ambulatory action's business, not a commute).
        if (person && target.kind === 'outside') {
            const building = person.getCurrentBuilding();
            if (building) {
                if (person.stepOutside) {
                    person.stepOutside();
                } else {
                    // Optional calls: the scene-facing bits are absent on minimal test doubles (arcScenarios).
                    const entrance = building.getEntrance?.();
                    if (entrance) {
                        person.setPosition?.(entrance.x, entrance.y);
                    }
                    person.setIndoors?.(false);
                    person.setCurrentBuilding?.(null);
                }
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
        // The burning gate (V4): refuse a trip INTO a building on fire — nobody walks back in to sleep or
        // work while it burns. The person shrugs and picks something else; the evacuation hook owns the exit.
        if (this.deps.isBurning?.(destination.getIdentifier()) && !this.personInside(person, destination)) {
            handle.status = 'cancelled';
            handle.resolvedAtTick = tick;
            return handle;
        }
        if (target.kind === 'venue') {
            this.resolvedVenues.set(handle.id, destination.getIdentifier());
        }
        if (this.personInside(person, destination)) {
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
        this.lastTick = Math.max(this.lastTick, tick); // the venue clock (W2/P1-2)
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
            // The burning gate (V4): a destination that caught fire mid-trip cancels like one that vanished —
            // the walker stops rather than finishing the journey into a burning building.
            const destinationBurning = !!destination && !!person
                && this.deps.isBurning?.(destination.getIdentifier()) && !this.personInside(person, destination);
            if (!person || !destination || destinationBurning) {
                handle.status = 'cancelled';
                handle.resolvedAtTick = tick;
                this.resolvedVenues.delete(handle.id);
                this.departures.delete(handle.id);
                // The body stops with the trip (W8 / P0-2): a destination that vanished mid-flight
                // (bulldozed, business closed) used to leave the walker finishing a stale journey and the
                // commute car stranded forever.
                person?.abortTravel?.();
                continue;
            }
            if (this.personInside(person, destination)) {
                handle.status = 'arrived';
                handle.resolvedAtTick = tick;
                this.resolvedVenues.delete(handle.id);
                continue;
            }
            unresolved.push(handle);
        }
        this.pending = unresolved;
    }

    // Arrival ground truth (W8 follow-up): the identity link when it exists, else the body physically
    // inside the destination while flagged indoors. Materialized, loaded and logically-relocated people
    // used to carry a null currentBuilding, and the pure identity check deadlocked their located actions —
    // the live audit caught a pending 'home' handle 12 sim-hours old on a man standing in his own living
    // room, his sleep waiting_for_materialization all night. The fallback heals the link on resolution.
    private personInside(person: Person, destination: Building): boolean {
        if (person.getCurrentBuilding() === destination) {
            return true;
        }
        if (person.getCurrentBuilding() === null && person.isIndoors?.() && person.isPhysicallyInside?.(destination)) {
            person.setCurrentBuilding?.(destination);
            return true;
        }
        return false;
    }

    getPending(): TransitionHandle[] {
        return this.pending;
    }

    // Coherent travel abort (W8 / proposal simulation-aliveness-3 P0-2.3): the engine reports that the
    // intent holding this handle died (interrupt/pause/block). The trip stops NOW — handle cancelled and
    // dropped from every queue, the body parked where it stands, the commute car despawned — instead of
    // the travel machine finishing a stale journey while a new intent runs somewhere else.
    cancelTransition(handleId: number, personId: PersonId): void {
        const handle = this.pending.find(pendingHandle => pendingHandle.id === handleId);
        if (handle) {
            handle.status = 'cancelled';
            this.pending = this.pending.filter(pendingHandle => pendingHandle.id !== handleId);
        }
        this.resolvedVenues.delete(handleId);
        this.departures.delete(handleId);
        this.findPerson(personId)?.abortTravel?.();
    }
}
