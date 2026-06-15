import Tile from '../src/app/game/Tile';
import Soil from '../src/app/game/Soil';
import Road from '../src/app/game/Road';
import Building from '../src/app/game/Building';
import Person from '../src/app/game/Person';
import PathFinder from '../src/app/game/PathFinder';
import Field from '../src/app/game/Field';

import { CellParams } from '../src/types/Grid';
import { TilePosition } from '../src/types/Position';

const FOOTPRINT_TILES = 3;
const FOOTPRINT: CellParams = { width: 48, height: 48 };

describe('Tile footprint model', () => {
    test('a 3x3 footprint covers the 9 cells centered on the anchor', () => {
        const tile = new Soil(4, 4, 'grass');
        const cells = tile.getFootprintCells(FOOTPRINT_TILES);

        const keys = cells
            .filter((cell): cell is { row: number; col: number } => cell !== null)
            .map(cell => `${cell.row}-${cell.col}`)
            .sort();

        expect(cells).toHaveLength(9);
        expect(keys).toEqual([
            '3-3', '3-4', '3-5',
            '4-3', '4-4', '4-5',
            '5-3', '5-4', '5-5',
        ].sort());
    });

    test('a single-tile footprint is just the anchor cell', () => {
        const tile = new Soil(7, 2, 'grass');
        const cells = tile.getFootprintCells(1);

        expect(cells).toEqual([{ row: 7, col: 2 }]);
    });
});

describe('Depth/layering derives from the footprint anchor row', () => {
    test('soil, road and building keep their relative depth ordering', () => {
        const soil = new Soil(10, 10, 'grass');
        const road = new Road(10, 10, null);
        const building = new Building(10, 10, null);

        expect(soil.calculateDepth()).toBe(0);
        expect(road.calculateDepth()).toBe(100);
        expect(building.calculateDepth()).toBe(110);
        expect(soil.calculateDepth()).toBeLessThan(road.calculateDepth());
        expect(road.calculateDepth()).toBeLessThan(building.calculateDepth());
    });

    test('a mover below a building renders in front, above it renders behind', () => {
        const building = new Building(10, 10, null);

        const personBelow = new Person(0, 0);
        personBelow.updateDepth(new Soil(13, 10, 'grass')); // road footprint just below

        const personAbove = new Person(0, 0);
        personAbove.updateDepth(new Soil(7, 10, 'grass')); // road footprint just above

        expect(personBelow.getDepth()).toBeGreaterThan(building.calculateDepth());
        expect(personAbove.getDepth()).toBeLessThan(building.calculateDepth());
    });
});

describe('Waypoints and entrances are computed at footprint scale', () => {
    test('road curb insets sit 4px inside the 48px footprint', () => {
        const road = new Road(5, 5, null);
        road.calculateCurb(FOOTPRINT, { x: 100, y: 100 });

        const curb = road.getCurb();
        expect(curb).not.toBeNull();
        expect(curb!.topLeft).toEqual({ x: 80, y: 80 });
        expect(curb!.topRight).toEqual({ x: 120, y: 80 });
        expect(curb!.bottomLeft).toEqual({ x: 80, y: 120 });
        expect(curb!.bottomRight).toEqual({ x: 120, y: 120 });
    });

    test('road lane insets sit 13px inside the 48px footprint', () => {
        const road = new Road(5, 5, null);
        road.calculateLanes(FOOTPRINT, { x: 100, y: 100 });

        const lane = road.getLane();
        expect(lane).not.toBeNull();
        expect(lane!.topLeft).toEqual({ x: 89, y: 89 });
        expect(lane!.bottomRight).toEqual({ x: 111, y: 111 });
    });

    test('building entrance sits just below the footprint center', () => {
        const building = new Building(5, 5, null);
        building.calculateEntrance(FOOTPRINT, { x: 100, y: 100 });

        // center.y + footprintHeight/2 - 5 = 100 + 24 - 5
        expect(building.getEntrance()).toEqual({ x: 100, y: 119 });
    });
});

describe('PathFinder operates on the fine grid but returns footprint-level steps', () => {
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

    test('consecutive cells of the same road footprint collapse into one step', () => {
        const roadA = new Road(1, 1, null); // covers rows 0-2, cols 0-2
        const roadB = new Road(1, 4, null); // covers rows 0-2, cols 3-5 (adjacent to roadA)

        const field = stampField([roadA, roadB], 3, 6);
        const pathFinder = new PathFinder(field);

        const start: TilePosition = { row: 1, col: 0 };
        const goal: TilePosition = { row: 1, col: 4 };
        const path = pathFinder.findPath(start, goal);

        // Four fine cells are traversed (cols 1..4) but they belong to only two footprints.
        expect(path).toEqual([roadA, roadB]);
    });

    test('a road can reach a building anchor through the building footprint', () => {
        const roadA = new Road(1, 1, null);      // covers rows 0-2, cols 0-2
        const building = new Building(1, 4, null); // covers rows 0-2, cols 3-5

        const field = stampField([roadA, building], 3, 6);
        const pathFinder = new PathFinder(field);

        const start: TilePosition = { row: 1, col: 0 };
        const goal: TilePosition = { row: 1, col: 4 }; // building anchor
        const path = pathFinder.findPath(start, goal);

        expect(path.length).toBeGreaterThan(0);
        expect(path[path.length - 1]).toBe(building);
        expect(path).toEqual([roadA, building]);
    });
});
