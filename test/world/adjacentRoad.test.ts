import GameManager from 'game/GameManager';
import Building from 'game/world/Building';
import Field from 'game/world/Field';
import Road from 'game/world/Road';
import { PixelPosition, TilePosition } from 'types/Position';

// Field.getAdjacentRoadTile (task 008 commute spec): the street spot "in front of" a building — the road cell
// on the ring just outside its footprint closest to the entrance. Commute cars materialize and park there
// (cars live on the street, never inside a footprint).

function makeField(rows = 40, cols = 40): Field {
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
        emitSingle: () => {},
        on: () => {},
        toolbelt: {},
    } as unknown as GameManager;

    const field = new Field(game, rows, cols);
    (game as unknown as { field: Field }).field = field;
    return field;
}

describe('Field.getAdjacentRoadTile', () => {
    test('returns a ring road cell for a building flush against a road', () => {
        const field = makeField();
        field.loadStructure('road', 1, 4, 'r');                        // rows 0-2, cols 3-5
        const house = field.loadStructure('house', 4, 4, 'h') as Building; // rows 3-5, cols 3-5 — flush below

        const spot = field.getAdjacentRoadTile(house);
        expect(spot).not.toBeNull();
        // The spot is genuinely ON the street (a road cell)...
        expect(field.getTile(spot!.row, spot!.col)).toBeInstanceOf(Road);
        // ...on the ring just outside the house footprint (row 2, the road's bottom edge).
        expect(spot!.row).toBe(2);
        expect(spot!.col).toBeGreaterThanOrEqual(3);
        expect(spot!.col).toBeLessThanOrEqual(5);
    });

    test('prefers the ring road cell closest to the entrance', () => {
        const field = makeField();
        // Roads BOTH above and left of the house; the entrance sits at the footprint's bottom-center, which
        // is closer to the left road's bottom cells than to the top road.
        field.loadStructure('road', 1, 4, 'r');  // above: rows 0-2, cols 3-5
        field.loadStructure('road', 4, 1, 'r');  // left:  rows 3-5, cols 0-2
        const house = field.loadStructure('house', 4, 4, 'h') as Building; // rows 3-5, cols 3-5

        const spot = field.getAdjacentRoadTile(house)!;
        expect(field.getTile(spot.row, spot.col)).toBeInstanceOf(Road);
        // Entrance is bottom-center (row 5-ish, col 4): the left road's (5,2) cell is nearer than the top
        // road's row-2 cells, so the left road must win.
        expect(spot.col).toBe(2);
        expect(spot.row).toBe(5);
    });

    test('returns null when the building has no adjacent road (legacy/test worlds)', () => {
        const field = makeField();
        const house = field.loadStructure('house', 10, 10, 'h') as Building;
        expect(field.getAdjacentRoadTile(house)).toBeNull();
    });
});
