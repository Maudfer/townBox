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
