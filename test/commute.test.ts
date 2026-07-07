import Field from '../src/app/game/Field';
import House from '../src/app/game/House';
import Workplace from '../src/app/game/Workplace';
import City from '../src/app/game/City';
import Person from '../src/app/game/Person';
import GameManager from '../src/app/game/GameManager';

import { PixelPosition, TilePosition } from '../src/types/Position';
import { TimeChangedEvent } from '../src/types/Time';
import { JobRequirements } from '../src/types/Work';

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
    person.work.setJob({ title: 'Clerk', salary: 1000, requirements: [JobRequirements.RetailSkill], shiftStart: 540, shiftEnd: 1020 });
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
