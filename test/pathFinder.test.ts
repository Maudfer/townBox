import Tile from '../src/app/game/Tile';
import Road from '../src/app/game/Road';
import PathFinder from '../src/app/game/PathFinder';
import Field from '../src/app/game/Field';

import { TilePosition } from '../src/types/Position';

const FOOTPRINT_TILES = 3;

// Mirrors the stamping helper in tileFootprint.test.ts: build a Field-like object whose matrix only
// holds the stamped structures, so an out-of-bounds row simply has no entry (matrix[-1] === undefined).
function stampField(structures: Tile[], rows: number, cols: number): Field {
    const matrix: { [row: number]: { [col: number]: Tile } } = {};
    for (let row = 0; row < rows; row++) {
        matrix[row] = {};
    }

    for (const structure of structures) {
        for (const cell of structure.getFootprintCells(FOOTPRINT_TILES)) {
            if (cell === null || cell.row < 0 || cell.row >= rows || cell.col < 0 || cell.col >= cols) {
                continue;
            }
            matrix[cell.row]![cell.col] = structure;
        }
    }

    return {
        matrix,
        isValidPosition: (row: number, col: number) => row >= 0 && row < rows && col >= 0 && col < cols,
        getTile: (row: number, col: number) => matrix[row]?.[col] ?? null,
    } as unknown as Field;
}

describe('PathFinder handles grid-edge starts and goals without crashing', () => {
    test('a start on the grid top edge (row 0) finds a path instead of throwing', () => {
        // Two adjacent road footprints on rows 0-2. The anchors sit on row 1, but the top footprint cells
        // occupy row 0 — so expanding a node there probes a NORTH neighbor on row -1 (off the top edge).
        const roadA = new Road(1, 1, null); // covers rows 0-2, cols 0-2
        const roadB = new Road(1, 4, null); // covers rows 0-2, cols 3-5

        const field = stampField([roadA, roadB], 3, 6);
        const pathFinder = new PathFinder(field);

        const start: TilePosition = { row: 0, col: 1 }; // top edge — NORTH neighbor is row -1
        const goal: TilePosition = { row: 0, col: 4 };

        let path: Tile[] = [];
        expect(() => { path = pathFinder.findPath(start, goal); }).not.toThrow();

        // The off-top-edge neighbor is filtered out and A* still routes across the two footprints.
        expect(path).toEqual([roadA, roadB]);
    });

    test('a start on the grid bottom edge (last row) finds a path instead of throwing', () => {
        // Anchors on the last-but-one row so the footprint reaches the final grid row; the SOUTH neighbor
        // of a node on that final row is off the bottom edge.
        const rows = 3;
        const roadA = new Road(1, 1, null); // covers rows 0-2, cols 0-2 (row 2 is the last row)
        const roadB = new Road(1, 4, null); // covers rows 0-2, cols 3-5

        const field = stampField([roadA, roadB], rows, 6);
        const pathFinder = new PathFinder(field);

        const start: TilePosition = { row: rows - 1, col: 1 }; // bottom edge — SOUTH neighbor is row `rows`
        const goal: TilePosition = { row: rows - 1, col: 4 };

        let path: Tile[] = [];
        expect(() => { path = pathFinder.findPath(start, goal); }).not.toThrow();

        expect(path).toEqual([roadA, roadB]);
    });

    test('a single-footprint grid (every neighbor is off some edge) returns without crashing', () => {
        // One road filling a 3x3 grid: from its anchor every N/S/E/W probe eventually lands off an edge.
        const road = new Road(1, 1, null); // covers rows 0-2, cols 0-2 — the whole grid
        const field = stampField([road], 3, 3);
        const pathFinder = new PathFinder(field);

        const start: TilePosition = { row: 0, col: 0 }; // top-left corner: N and W neighbors are off-grid
        const goal: TilePosition = { row: 2, col: 2 };   // same footprint anchor collapses to one step

        let path: Tile[] = [];
        expect(() => { path = pathFinder.findPath(start, goal); }).not.toThrow();

        // Start and goal share the road's footprint, so the collapsed path is the single road step.
        expect(path).toEqual([road]);
    });
});
