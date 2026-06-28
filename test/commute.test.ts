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

describe('City.handleCommute', () => {
    test('dispatches an employed resident to work during shift hours, spawning a controlled car', () => {
        const { city, field } = makeWorld();
        const { person } = employ(field);

        expect(person.isIdle()).toBe(true);
        expect(field.getVehicles()).toHaveLength(0);

        city.handleCommute(timeAt(10, 0)); // 600 min, within 540–1020

        expect(field.getVehicles()).toHaveLength(1);
        expect(field.getVehicles()[0]!.isControlled()).toBe(true);
        expect(person.getVehicle()).not.toBeNull();
        expect(person.isIdle()).toBe(false); // now commuting
    });

    test('sends a resident at work back home after the shift ends', () => {
        const { city, field } = makeWorld();
        const { person, workplace } = employ(field);
        person.setCurrentBuilding(workplace); // simulate being at work

        city.handleCommute(timeAt(18, 30)); // 1110 min, after shift end

        expect(field.getVehicles()).toHaveLength(1);
        expect(person.isIdle()).toBe(false);
    });

    test('does not dispatch when already where they should be', () => {
        const { city, field } = makeWorld();
        const { person } = employ(field); // at home (currentBuilding null), off-shift

        city.handleCommute(timeAt(3, 0)); // pre-dawn, should be home — and is

        expect(field.getVehicles()).toHaveLength(0);
        expect(person.isIdle()).toBe(true);
    });

    test('ignores unemployed residents', () => {
        const { city, field } = makeWorld();
        field.loadStructure('house', 4, 4, 'h');
        const person = field.loadPerson(72, 72);
        // no job / workplace

        city.handleCommute(timeAt(10, 0));

        expect(field.getVehicles()).toHaveLength(0);
        expect(person.isIdle()).toBe(true);
    });
});
