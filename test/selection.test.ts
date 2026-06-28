import Field from '../src/app/game/Field';
import GameManager from '../src/app/game/GameManager';
import { formatDay } from '../src/util/time';
import { PixelPosition, TilePosition } from '../src/types/Position';

function makeField(rows: number, cols: number): Field {
    const game = {
        field: null,
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
        on: () => {},
        setGameManager: () => {},
        toolbelt: {},
    } as unknown as GameManager;

    const field = new Field(game, rows, cols);
    (game as unknown as { field: Field }).field = field;
    return field;
}

describe('Field.findPersonAt (selection hit-test, task 026)', () => {
    test('picks a visible person within the radius', () => {
        const field = makeField(40, 40);
        const person = field.loadPerson(100, 100);
        expect(field.findPersonAt({ x: 105, y: 103 })).toBe(person); // ~5.8px away
    });

    test('returns null when no person is within the radius', () => {
        const field = makeField(40, 40);
        field.loadPerson(100, 100);
        expect(field.findPersonAt({ x: 200, y: 200 })).toBeNull();
    });

    test('ignores people who are indoors (hidden)', () => {
        const field = makeField(40, 40);
        const person = field.loadPerson(100, 100);
        person.setIndoors(true);
        expect(field.findPersonAt({ x: 101, y: 101 })).toBeNull();
    });

    test('picks the nearest among several candidates', () => {
        const field = makeField(40, 40);
        field.loadPerson(100, 100);
        const nearer = field.loadPerson(104, 104);
        expect(field.findPersonAt({ x: 103, y: 103 })).toBe(nearer);
    });
});

describe('formatDay (event-log dates, task 027)', () => {
    test('formats an absolute day index as a calendar date', () => {
        expect(formatDay(0)).toBe('Year 1, 01/01');
        expect(formatDay(30)).toBe('Year 1, 02/01');
        expect(formatDay(359)).toBe('Year 1, 12/30');
        expect(formatDay(360)).toBe('Year 2, 01/01');
    });
});
