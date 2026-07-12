import PathFinder from 'game/agents/PathFinder';
import Building from 'game/world/Building';
import Field from 'game/world/Field';
import Road from 'game/world/Road';
import Soil from 'game/world/Soil';
import Tile from 'game/world/Tile';
import { TilePosition } from 'types/Position';

// PathFinder only touches field.matrix, field.isValidPosition() and field.getTile() (see
// game/agents/PathFinder.ts), so a lightweight fake stands in for the full Field/GameManager wiring and
// gives full control over the fine-tile grid the A* search walks.
type FakeField = Pick<Field, 'matrix' | 'isValidPosition' | 'getTile'>;

// Builds a 1-tile-per-footprint grid from an ASCII layout: 'R' = road, '.' = soil (blocks the search
// unless it IS the destination), 'B' = a 1x1 building footprint (its own distinct instance per cell,
// i.e. NOT a multi-cell footprint — see the dedicated footprint-collapsing tests below for that).
//
// A real Field's matrix only has entries for its actual rows (see the dedicated edge-case test below for
// why that matters), so this pads one extra out-of-bounds row above/below with empty row objects — enough
// for `matrix[row]` to exist (no crash) while `isValidPosition` still correctly rejects it, exactly like a
// caller who queries just past a real Field's edge would see.
function buildGrid(layout: string[]): { field: FakeField; tileAt: (row: number, col: number) => Tile } {
    const rows = layout.length;
    const cols = layout[0]!.length;
    const matrix: { [row: number]: { [col: number]: Tile } } = {};

    for (let row = 0; row < rows; row++) {
        matrix[row] = {};
        const line = layout[row]!;
        for (let col = 0; col < cols; col++) {
            const char = line[col];
            let tile: Tile;
            if (char === 'R') {
                tile = new Road(row, col, null);
            } else if (char === 'B') {
                tile = new Building(row, col, null);
            } else {
                tile = new Soil(row, col, 'grass');
            }
            matrix[row]![col] = tile;
        }
    }
    matrix[-1] = {};
    matrix[rows] = {};

    const field: FakeField = {
        matrix: matrix as unknown as Field['matrix'],
        isValidPosition: (row: number, col: number) => row >= 0 && row < rows && col >= 0 && col < cols,
        getTile: (row: number, col: number) => matrix[row]?.[col] ?? null,
    };

    return { field, tileAt: (row: number, col: number) => matrix[row]![col]! };
}

// Stamps a single multi-cell structure across a footprint (every cell references the SAME instance, as
// Field.stampFootprint does), backed by an otherwise-soil grid. Mirrors the pattern used in
// test/world/tileFootprint.test.ts for the "reach a building via its footprint" case.
function stampField(structures: Tile[], rows: number, cols: number, footprintTiles: number): FakeField {
    const matrix: { [row: number]: { [col: number]: Tile } } = {};
    for (let row = 0; row < rows; row++) {
        matrix[row] = {};
        for (let col = 0; col < cols; col++) {
            matrix[row]![col] = new Soil(row, col, 'grass');
        }
    }
    matrix[-1] = {};
    matrix[rows] = {};

    for (const structure of structures) {
        for (const cell of structure.getFootprintCells(footprintTiles)) {
            if (cell === null || cell.row < 0 || cell.row >= rows || cell.col < 0 || cell.col >= cols) {
                continue;
            }
            matrix[cell.row]![cell.col] = structure;
        }
    }

    return {
        matrix: matrix as unknown as Field['matrix'],
        isValidPosition: (row: number, col: number) => row >= 0 && row < rows && col >= 0 && col < cols,
        getTile: (row: number, col: number) => matrix[row]?.[col] ?? null,
    };
}

describe('PathFinder A*', () => {
    test('finds a straight path along a road strip', () => {
        const { field, tileAt } = buildGrid(['RRRRR']);
        const pathFinder = new PathFinder(field as unknown as Field);

        const path = pathFinder.findPath({ row: 0, col: 0 }, { row: 0, col: 4 });

        expect(path).toEqual([tileAt(0, 1), tileAt(0, 2), tileAt(0, 3), tileAt(0, 4)]);
    });

    test('start === goal returns an empty path (nothing to walk)', () => {
        const { field } = buildGrid(['RRR']);
        const pathFinder = new PathFinder(field as unknown as Field);

        const path = pathFinder.findPath({ row: 0, col: 1 }, { row: 0, col: 1 });

        expect(path).toEqual([]);
    });

    test('routes around an obstacle to the shortest detour', () => {
        // A 3x3 block with the center blocked by soil; the road forms a ring around it.
        const { field, tileAt } = buildGrid([
            'RRR',
            'R.R',
            'RRR',
        ]);
        const pathFinder = new PathFinder(field as unknown as Field);

        const path = pathFinder.findPath({ row: 0, col: 0 }, { row: 2, col: 2 });

        // Manhattan distance from (0,0) to (2,2) is 4; going around the blocked center costs exactly 4
        // steps too (e.g. via the top-right or bottom-left corner), so the detour is still optimal.
        expect(path.length).toBe(4);
        expect(path[path.length - 1]).toBe(tileAt(2, 2));
        // Every step must be a road tile (never the blocked soil center).
        for (const tile of path) {
            expect(tile).toBeInstanceOf(Road);
        }
    });

    test('returns an empty path when the goal is unreachable', () => {
        const { field } = buildGrid([
            'RR.R',
        ]);
        const pathFinder = new PathFinder(field as unknown as Field);

        const path = pathFinder.findPath({ row: 0, col: 0 }, { row: 0, col: 3 });

        expect(path).toEqual([]);
    });

    test('throws on a null/undefined start or goal', () => {
        const { field } = buildGrid(['RRR']);
        const pathFinder = new PathFinder(field as unknown as Field);

        expect(() => pathFinder.findPath(null as unknown as TilePosition, { row: 0, col: 1 })).toThrow();
        expect(() => pathFinder.findPath({ row: 0, col: 0 }, null as unknown as TilePosition)).toThrow();
    });

    test('a road reaches a building anchor through the building footprint, collapsing repeated footprint cells', () => {
        const roadA = new Road(1, 1, null);       // covers rows 0-2, cols 0-2
        const building = new Building(1, 4, null); // covers rows 0-2, cols 3-5 (anchor at 1-4)

        const field = stampField([roadA, building], 3, 6, 3);
        const pathFinder = new PathFinder(field as unknown as Field);

        const start: TilePosition = { row: 1, col: 0 };
        const goal: TilePosition = { row: 1, col: 4 }; // the building's anchor cell
        const path = pathFinder.findPath(start, goal);

        // Four fine cells of the building footprint are crossed (cols 3..4 across 3 rows worth of search),
        // but since they all reference the SAME instance the reconstructed path collapses to one entry.
        expect(path).toEqual([roadA, building]);
        expect(path[path.length - 1]).toBe(building);
    });

    test('adjacent same-footprint road cells collapse into a single step', () => {
        const roadA = new Road(1, 1, null); // covers rows 0-2, cols 0-2
        const roadB = new Road(1, 4, null); // covers rows 0-2, cols 3-5

        const field = stampField([roadA, roadB], 3, 6, 3);
        const pathFinder = new PathFinder(field as unknown as Field);

        const path = pathFinder.findPath({ row: 1, col: 0 }, { row: 1, col: 4 });

        expect(path).toEqual([roadA, roadB]);
    });

    test('a start on the grid west edge does not crash (an out-of-bounds column is simply filtered out)', () => {
        // Deliberately UNPADDED, exactly how a real Field's matrix is populated (only real rows exist as
        // keys) — using the MIDDLE row of a 3-row grid so north/south neighbors stay in-bounds and only
        // the column edge (west of col 0) is exercised. `matrix[row]` still exists for any real row, so an
        // out-of-bounds column returns `undefined` and is filtered out without crashing (see the row-edge
        // case just below, which is NOT safe the same way).
        const road10 = new Road(1, 0, null);
        const road11 = new Road(1, 1, null);
        const road12 = new Road(1, 2, null);
        const matrix: { [row: number]: { [col: number]: Tile } } = {
            0: {}, 1: { 0: road10, 1: road11, 2: road12 }, 2: {},
        };
        const field: FakeField = {
            matrix: matrix as unknown as Field['matrix'],
            isValidPosition: (row: number, col: number) => row >= 0 && row < 3 && col >= 0 && col < 3,
            getTile: (row: number, col: number) => matrix[row]?.[col] ?? null,
        };
        const pathFinder = new PathFinder(field as unknown as Field);

        expect(() => pathFinder.findPath({ row: 1, col: 0 }, { row: 1, col: 2 })).not.toThrow();
    });

    // A north/south neighbor lookup used to index `field.matrix[row]` BEFORE `isValidPosition` was
    // consulted. A real Field's matrix only has entries for rows [0, rows), so probing the out-of-bounds
    // north neighbor of a row-0 start (or the south neighbor of the last row) threw a TypeError instead of
    // being filtered out like an out-of-bounds column is. The fix bounds-checks the row before indexing;
    // these two tests use UNPADDED matrices (only real rows exist, exactly like a real Field's top/bottom
    // edge) to prove the edge is now filtered and the search still routes normally.
    test('a start on the grid top edge filters the out-of-bounds north neighbor and still finds a path', () => {
        const road00 = new Road(0, 0, null);
        const road01 = new Road(0, 1, null);
        const road02 = new Road(0, 2, null);
        // Only row 0 exists in the matrix — no row -1 — just like a real Field's top edge.
        const matrix: { [row: number]: { [col: number]: Tile } } = { 0: { 0: road00, 1: road01, 2: road02 } };
        const field: FakeField = {
            matrix: matrix as unknown as Field['matrix'],
            isValidPosition: (row: number, col: number) => row >= 0 && row < 1 && col >= 0 && col < 3,
            getTile: (row: number, col: number) => matrix[row]?.[col] ?? null,
        };
        const pathFinder = new PathFinder(field as unknown as Field);

        let path: Tile[] = [];
        expect(() => { path = pathFinder.findPath({ row: 0, col: 0 }, { row: 0, col: 2 }); }).not.toThrow();
        expect(path).toEqual([road01, road02]);
    });

    test('a start on the grid bottom edge filters the out-of-bounds south neighbor and still finds a path', () => {
        // A 3-row road grid where only rows 0..2 exist (no row 3), just like a real Field's bottom edge.
        // Starting on the last row (row 2) probes a south neighbor on row 3, which must be filtered.
        const roads: { [row: number]: { [col: number]: Road } } = {};
        for (let row = 0; row < 3; row++) {
            roads[row] = {};
            for (let col = 0; col < 3; col++) {
                roads[row]![col] = new Road(row, col, null);
            }
        }
        const matrix = roads as unknown as { [row: number]: { [col: number]: Tile } };
        const field: FakeField = {
            matrix: matrix as unknown as Field['matrix'],
            isValidPosition: (row: number, col: number) => row >= 0 && row < 3 && col >= 0 && col < 3,
            getTile: (row: number, col: number) => matrix[row]?.[col] ?? null,
        };
        const pathFinder = new PathFinder(field as unknown as Field);

        let path: Tile[] = [];
        expect(() => { path = pathFinder.findPath({ row: 2, col: 0 }, { row: 2, col: 2 }); }).not.toThrow();
        // Straight along the bottom row: (2,0) -> (2,1) -> (2,2).
        expect(path).toEqual([roads[2]![1], roads[2]![2]]);
    });
});
