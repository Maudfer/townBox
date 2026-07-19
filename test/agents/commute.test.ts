import City from 'game/City';
import GameManager from 'game/GameManager';
import Person from 'game/agents/Person';
import Field from 'game/world/Field';
import House from 'game/world/House';
import Road from 'game/world/Road';
import Workplace from 'game/world/Workplace';
import { PixelPosition, TilePosition } from 'types/Position';
import { TimeChangedEvent } from 'types/Time';

function makeWorld(): { city: City; field: Field } {
    const rows = 40;
    const cols = 40;
    const game = {
        field: null,
        population: null,
        clock: null,
        eventEngine: null,
        gridParams: { rows, cols, cells: { width: 16, height: 16 }, footprint: { tiles: 3, width: 48, height: 48 } },
        tileToPixelPosition: (position: TilePosition) => (position === null ? null : { x: position.col * 16 + 8, y: position.row * 16 + 8 }),
        pixelToTilePosition: (pixel: PixelPosition) => {
            if (pixel === null) {
                return null;
            }
            const row = Math.floor(pixel.y / 16);
            const col = Math.floor(pixel.x / 16);
            return row < 0 || row >= rows || col < 0 || col >= cols ? null : { row, col };
        },
        emit: () => {},
        emitSingle: () => {},
        on: () => {},
        toolbelt: {},
    } as unknown as GameManager;

    const field = new Field(game, rows, cols);
    (game as unknown as { field: Field }).field = field;
    const city = new City(game);
    return { city, field };
}

function timeAt(hour: number, minute: number): TimeChangedEvent {
    return { timestamp: { hour, minute } as never, tick: 0 };
}

// An employed resident with a 09:00–17:00 shift, idle at home.
function employ(field: Field): { person: Person; home: House; workplace: Workplace } {
    const home = field.loadStructure('house', 4, 4, 'h') as House;
    const workplace = field.loadStructure('work', 10, 10, 'w') as Workplace;
    const person = field.loadPerson(72, 72);
    person.social.setHome(home);
    person.social.setAge(30); // adults drive; minors walk (task 058)
    person.work.setJob({ title: 'Clerk', salary: 1000, requirements: ['assist_customers'], shiftStart: 540, shiftEnd: 1020 });
    person.work.setWorkplace(workplace);
    return { person, home, workplace };
}

// Since task 046 the per-person shift loop is Brain-driven: a work-obligation intent starts the job's work
// Action, whose location requirement requests a transition through the execution boundary; LiveWorld then
// drives THIS commute machinery. These tests exercise the live machinery end-to-end at the boundary seam.
describe('the live commute machinery behind the execution boundary', () => {
    test('a requested transition spawns a controlled car and stays pending until physical arrival', () => {
        const { city, field } = makeWorld();
        const { person, workplace } = employ(field);
        person.social.setPersonId('p1');

        const handle = city.getWorld().requestTransition('p1', { kind: 'building', key: workplace.getIdentifier() }, 10, null);
        expect(handle.status).toBe('pending');
        expect(field.getVehicles()).toHaveLength(0); // not yet departed (LP-11 departure spreading)
        city.getWorld().pump(10); // minute-less pump: departures flush immediately
        expect(field.getVehicles()).toHaveLength(1);
        expect(field.getVehicles()[0]!.isControlled()).toBe(true);
        expect(person.getVehicle()).not.toBeNull();
        expect(person.isIdle()).toBe(false); // now commuting

        // The minute cadence pumps pending handles; no arrival yet → still pending.
        city.handleCommute(timeAt(10, 1));
        expect(handle.status).toBe('pending');

        // The visual layer lands the person → the next pump resolves the handle.
        person.setCurrentBuilding(workplace);
        city.handleCommute(timeAt(10, 2));
        expect(handle.status).toBe('arrived');
    });

    test('the commute car materializes ON the street in front of the origin, not inside the footprint (task 008 spec)', () => {
        const { city, field } = makeWorld();
        const { person, home, workplace } = employ(field);
        person.social.setPersonId('p1');
        // A road flush above the home (home covers rows 3-5 / cols 3-5; the road rows 0-2 / cols 3-5).
        field.loadStructure('road', 1, 4, 'r');

        city.getWorld().requestTransition('p1', { kind: 'building', key: workplace.getIdentifier() }, 10, null);
        city.getWorld().pump(10); // flush the deferred departure (LP-11)

        const vehicle = field.getVehicles()[0]!;
        const spot = { x: vehicle.getPosition()!.x, y: vehicle.getPosition()!.y };
        const spotTile = { row: Math.floor(spot.y / 16), col: Math.floor(spot.x / 16) };
        // On the street: the car's tile is a Road cell on the ring outside the home footprint.
        expect(field.getTile(spotTile.row, spotTile.col)).toBeInstanceOf(Road);
        // And NOT at the entrance (which sits inside the home's own footprint).
        const entrance = home.getEntrance()!;
        expect(spot).not.toEqual({ x: entrance.x, y: entrance.y });
    });

    test('a minor commutes on foot: no car is spawned, and arrival still resolves the handle (task 058)', () => {
        const { city, field } = makeWorld();
        const { person, workplace } = employ(field);
        person.social.setPersonId('p1');
        person.social.setAge(10); // children don't drive

        const handle = city.getWorld().requestTransition('p1', { kind: 'building', key: workplace.getIdentifier() }, 10, null);
        city.getWorld().pump(10); // flush the deferred departure (LP-11)
        expect(handle.status).toBe('pending');
        expect(field.getVehicles()).toHaveLength(0); // walking — no commute car
        expect(person.getVehicle()).toBeNull();
        expect(person.isIdle()).toBe(false); // travelling on foot

        person.setCurrentBuilding(workplace);
        city.handleCommute(timeAt(10, 2));
        expect(handle.status).toBe('arrived');
    });

    test('going home resolves immediately when already home (like bootstrap)', () => {
        const { city, field } = makeWorld();
        const { person, home } = employ(field);
        person.social.setPersonId('p1');
        person.setCurrentBuilding(home);

        const handle = city.getWorld().requestTransition('p1', { kind: 'home' }, 5, null);
        expect(handle.status).toBe('arrived');
        expect(field.getVehicles()).toHaveLength(0); // no commute needed
    });

    test('unknown people cancel instead of crashing', () => {
        const { city, field } = makeWorld();
        employ(field); // person exists but with a different (absent) pool id
        const handle = city.getWorld().requestTransition('ghost', { kind: 'home' }, 5, null);
        expect(handle.status).toBe('cancelled');
        expect(field.getVehicles()).toHaveLength(0);
    });
});

// W8 — sprite & travel truth (proposal simulation-aliveness-3 P0-2): the vehicle lifecycle is owned by the
// transition, re-plans never orphan cars, and the travel machine stops when its intent dies.
describe('W8: the vehicle lifecycle and coherent travel aborts', () => {
    test('a mid-flight re-plan despawns the old car instead of orphaning it (the 148-car leak)', () => {
        const { city, field } = makeWorld();
        const { person, workplace } = employ(field);
        person.social.setPersonId('p1');

        city.getWorld().requestTransition('p1', { kind: 'building', key: workplace.getIdentifier() }, 10, null);
        city.getWorld().pump(10);
        expect(field.getVehicles()).toHaveLength(1);
        const firstCar = field.getVehicles()[0]!;
        firstCar.board(); // simulate the commuter mid-drive (occupant flag set)

        // The re-plan: a second commute begins while the first is in flight.
        city.getWorld().requestTransition('p1', { kind: 'home' }, 11, null);
        city.getWorld().pump(11);

        // ONE car on the field — the old one despawned WITH its occupant flag cleared (no phantom driver).
        expect(field.getVehicles()).toHaveLength(1);
        expect(field.getVehicles()[0]).not.toBe(firstCar);
        expect(firstCar.isOccupied()).toBe(false);
    });

    test('cancelTransition parks the body and despawns the car — the trip stops with the intent', () => {
        const { city, field } = makeWorld();
        const { person, workplace } = employ(field);
        person.social.setPersonId('p1');

        const handle = city.getWorld().requestTransition('p1', { kind: 'building', key: workplace.getIdentifier() }, 10, null);
        city.getWorld().pump(10);
        expect(field.getVehicles()).toHaveLength(1);
        expect(person.isIdle()).toBe(false);

        city.getWorld().cancelTransition(handle.id, 'p1');
        expect(handle.status).toBe('cancelled');
        expect(field.getVehicles()).toHaveLength(0);
        expect(person.isIdle()).toBe(true);
        expect(person.getVehicle()).toBeNull();
    });

    test('abortTravel steps a boarded person out visible at the car, never leaves them hidden', () => {
        const { city, field } = makeWorld();
        const { person, workplace } = employ(field);
        person.social.setPersonId('p1');

        city.getWorld().requestTransition('p1', { kind: 'building', key: workplace.getIdentifier() }, 10, null);
        city.getWorld().pump(10);
        const car = person.getVehicle()!;
        car.board();
        person.setIndoors(true); // boarded: hidden "inside" the car (the EnteringCar state)

        person.abortTravel();
        expect(person.isIndoors()).toBe(false); // stepped out where the car stood
        expect(person.isIdle()).toBe(true);
        expect(field.getVehicles()).toHaveLength(0);
        expect(car.isOccupied()).toBe(false);
    });

    test('leaving a building CLEARS currentBuilding — no instant false arrival for a return trip', () => {
        const { city, field } = makeWorld();
        const { person, home, workplace } = employ(field);
        person.social.setPersonId('p1');
        field.loadStructure('road', 1, 4, 'r');
        person.setCurrentBuilding(home);
        person.setIndoors(true);

        city.getWorld().requestTransition('p1', { kind: 'building', key: workplace.getIdentifier() }, 10, null);
        city.getWorld().pump(10);
        // One movement frame: the travel machine runs ExitingBuilding — the person has LEFT home.
        field.update({ time: 0, timeDelta: 16 });
        expect(person.getCurrentBuilding()).toBeNull();

        // A home transition requested mid-street must NOT resolve as already-arrived.
        const homeward = city.getWorld().requestTransition('p1', { kind: 'home' }, 11, null);
        expect(homeward.status).toBe('pending');
    });
});

// W8 follow-up (live-found): materialization, loads and logical relocations set `indoors` but never
// `currentBuilding`, and LiveWorld's identity-only arrival check could then never pass — the first located
// action ghost-commuted to the house the person was already inside (the sprite popping visible "on the
// house"), and a person parked inside a building with a null link deadlocked every located action (a
// pending 'home' handle 12 sim-hours old on a man standing in his own living room, sleep waiting all night).
describe('W8 follow-up: placement truth & arrival healing', () => {
    test('a located request from a person indoors inside the destination resolves immediately — no ghost commute', () => {
        const { city, field } = makeWorld();
        const home = field.loadStructure('house', 4, 4, 'h') as House;
        const person = field.loadPerson(72, 72); // pixel inside the 3x3 footprint
        person.social.setHome(home);
        person.social.setPersonId('p1');
        person.setIndoors(true); // the materialization/load state: indoors, currentBuilding never set
        expect(person.getCurrentBuilding()).toBeNull();

        const handle = city.getWorld().requestTransition('p1', { kind: 'home' }, 10, null);
        expect(handle.status).toBe('arrived');
        city.getWorld().pump(10);
        expect(field.getVehicles()).toHaveLength(0); // nobody drives to the house they are already inside
        expect(person.getCurrentBuilding()).toBe(home); // the link is healed on resolution
    });

    test('the pump resolves a pending handle for a person parked indoors at the target with a null link', () => {
        const { city, field } = makeWorld();
        const home = field.loadStructure('house', 4, 4, 'h') as House;
        const person = field.loadPerson(300, 300); // outdoors, far from home
        person.social.setHome(home);
        person.social.setAge(30);
        person.social.setPersonId('p1');

        const handle = city.getWorld().requestTransition('p1', { kind: 'home' }, 10, null);
        expect(handle.status).toBe('pending');
        city.getWorld().pump(10); // departs (commute starts)

        // A logical relocation parks them INSIDE the house without the link — the pre-fix deadlock state.
        person.abortTravel();
        person.setPosition(72, 72);
        person.setIndoors(true);
        expect(person.getCurrentBuilding()).toBeNull();

        city.getWorld().pump(11);
        expect(handle.status).toBe('arrived');
        expect(person.getCurrentBuilding()).toBe(home);
    });

    test('stepping outside lands on the curb of the connected street, not the entrance pixel', () => {
        const { city, field } = makeWorld();
        const home = field.loadStructure('house', 4, 4, 'h') as House;
        field.loadStructure('road', 4, 7, 'r');
        const person = field.loadPerson(72, 72);
        person.social.setHome(home);
        person.social.setPersonId('p1');
        person.setIndoors(true);
        person.setCurrentBuilding(home);

        const handle = city.getWorld().requestTransition('p1', { kind: 'outside' }, 10, null);
        expect(handle.status).toBe('arrived');
        expect(person.isIndoors()).toBe(false);
        expect(person.getCurrentBuilding()).toBeNull();
        // The body stands on the street footprint (the curb), not inside the house sprite.
        const position = person.getPosition()!;
        expect(field.getTile(Math.floor(position.y / 16), Math.floor(position.x / 16))).toBeInstanceOf(Road);
    });
});
