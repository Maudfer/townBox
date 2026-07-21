import GameManager from 'game/GameManager';
import Field from 'game/world/Field';
import House from 'game/world/House';
import Road from 'game/world/Road';
import Soil from 'game/world/Soil';
import Workplace from 'game/world/Workplace';
import { Tool } from 'types/Cursor';
import { BuildEvent } from 'types/Events';
import { PixelPosition, TilePosition } from 'types/Position';

type Emitted = { event: string; payload: unknown };

function makeGame(rows: number, cols: number, opts: { withCity?: boolean; nullPixelCenter?: boolean } = {}) {
    const emitted: Emitted[] = [];
    const demolishHouse = jest.fn();
    const demolishWorkplace = jest.fn();

    const game = {
        gridParams: {
            rows, cols,
            cells: { width: 16, height: 16 },
            footprint: { tiles: 3, width: 48, height: 48 },
        },
        toolbelt: { soil: 'grass', road: 'road', house: 'house_1x1', work: 'work_1x1', select: '', bulldoze: '' },
        emit: (event: string, payload: unknown) => { emitted.push({ event, payload }); },
        on: () => {},
        tileToPixelPosition: (position: TilePosition) => {
            if (opts.nullPixelCenter) return null;
            return position === null ? null : { x: position.col * 16 + 8, y: position.row * 16 + 8 };
        },
        pixelToTilePosition: (pixel: PixelPosition) => {
            if (pixel === null) return null;
            const row = Math.floor(pixel.y / 16);
            const col = Math.floor(pixel.x / 16);
            return row < 0 || row >= rows || col < 0 || col >= cols ? null : { row, col };
        },
        city: opts.withCity ? { demolishHouse, demolishWorkplace } : undefined,
    } as unknown as GameManager;

    const field = new Field(game, rows, cols);
    // The constructor stamps the whole grid with grass and emits a tileSpawned per footprint; tests care
    // about what THEIR actions emit, so drop that initial noise from the recorded log.
    emitted.length = 0;
    return { game, field, emitted, demolishHouse, demolishWorkplace };
}

function buildEvent(tool: Tool, position: TilePosition): BuildEvent {
    return { tool, position };
}

describe('Field.build', () => {
    test('returns without building when the event carries no position', () => {
        const { field, emitted } = makeGame(15, 15);
        field.build(buildEvent(Tool.Soil, null));
        expect(emitted).toEqual([]);
    });

    test('builds a road (snapped to the supertile grid) and emits tileSpawned + roadBuilt', () => {
        const { field, emitted } = makeGame(15, 15);
        field.build(buildEvent(Tool.Road, { row: 7, col: 7 }));

        const tile = field.getTile(7, 7);
        expect(tile).toBeInstanceOf(Road);
        expect(emitted.some(e => e.event === 'tileSpawned' && e.payload === tile)).toBe(true);
        expect(emitted.some(e => e.event === 'roadBuilt' && e.payload === tile)).toBe(true);
    });

    test('builds a house flush against a road and emits houseBuilt', () => {
        const { field, emitted } = makeGame(15, 15);
        field.build(buildEvent(Tool.Road, { row: 7, col: 7 }));
        field.build(buildEvent(Tool.House, { row: 10, col: 7 }));

        const tile = field.getTile(10, 7);
        expect(tile).toBeInstanceOf(House);
        expect(emitted.some(e => e.event === 'houseBuilt' && e.payload === tile)).toBe(true);
    });

    test('builds a workplace flush against a road and emits workplaceBuilt', () => {
        const { field, emitted } = makeGame(15, 15);
        field.build(buildEvent(Tool.Road, { row: 7, col: 7 }));
        field.build(buildEvent(Tool.Work, { row: 10, col: 7 }));

        const tile = field.getTile(10, 7);
        expect(tile).toBeInstanceOf(Workplace);
        expect(emitted.some(e => e.event === 'workplaceBuilt' && e.payload === tile)).toBe(true);
    });

    // Regression (live-play finding, 2026-07-20): a road/building placed on a supertile anchor shares its key
    // with the grass footprint it overwrites (grass sits on the same 3k+1 grid). destroyStructure deleted that
    // shared key AFTER the structure registered it, so roadAnchors/destinations came up permanently EMPTY for
    // grid-aligned structures — V2's ambulatory street roam silently had NO road targets. The fix registers
    // the anchor after the overwritten-grass teardown.
    test('a road placed on a supertile anchor survives the grass teardown and registers in roadAnchors', () => {
        const { field } = makeGame(15, 15);
        field.build(buildEvent(Tool.Road, { row: 7, col: 7 }));
        expect([...(field as unknown as { roadAnchors: Set<string> }).roadAnchors]).toContain('7-7');
    });

    test('a building placed on a supertile anchor survives the grass teardown and registers in destinations', () => {
        const { field } = makeGame(15, 15);
        field.build(buildEvent(Tool.Road, { row: 7, col: 7 }));
        field.build(buildEvent(Tool.House, { row: 10, col: 7 }));
        expect([...(field as unknown as { destinations: Set<string> }).destinations]).toContain('10-7');
    });

    test('rejects an invalid building placement (not flush against a road)', () => {
        const { field, emitted } = makeGame(15, 15);
        const before = emitted.length;

        field.build(buildEvent(Tool.House, { row: 1, col: 1 }));

        expect(emitted.length).toBe(before);
        expect(field.getTile(1, 1)).toBeInstanceOf(Soil);
    });

    test('rebuilding the same structure type on the same tile is a no-op', () => {
        const { field, emitted } = makeGame(15, 15);
        field.build(buildEvent(Tool.Road, { row: 7, col: 7 }));
        const afterFirstBuild = emitted.length;

        field.build(buildEvent(Tool.Road, { row: 7, col: 7 }));

        expect(emitted.length).toBe(afterFirstBuild);
    });

    test('returns without building when the pixel center cannot be resolved', () => {
        const { field, emitted } = makeGame(15, 15, { nullPixelCenter: true });
        field.build(buildEvent(Tool.Soil, { row: 1, col: 1 }));
        expect(emitted).toEqual([]);
    });

    test('returns without building when the road-grid snap itself resolves to null (defensive guard)', () => {
        const { field, emitted } = makeGame(15, 15);
        jest.spyOn(field, 'snapToRoadGrid').mockReturnValue(null);

        field.build(buildEvent(Tool.Road, { row: 7, col: 7 }));

        expect(emitted).toEqual([]);
    });

    test('throws when the resolved tile position is outside the matrix', () => {
        const { field } = makeGame(15, 15);
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        expect(() => field.build(buildEvent(Tool.Soil, { row: 999, col: 999 }))).toThrow(/Invalid tile to build on/);

        errorSpy.mockRestore();
    });

    test('throws for a tool with no build handler', () => {
        const { field } = makeGame(15, 15);
        expect(() => field.build(buildEvent(Tool.Select, { row: 1, col: 1 }))).toThrow(/Invalid tool to build/);
    });
});

describe('Field.bulldoze', () => {
    test('returns without demolishing when the event carries no position', () => {
        const { field, emitted } = makeGame(15, 15, { withCity: true });
        field.bulldoze(buildEvent(Tool.Bulldoze, null));
        expect(emitted).toEqual([]);
    });

    test('demolishes a house through City.demolishHouse before converting the lot to soil', () => {
        const { field, demolishHouse, demolishWorkplace } = makeGame(15, 15, { withCity: true });
        field.build(buildEvent(Tool.Road, { row: 7, col: 7 }));
        field.build(buildEvent(Tool.House, { row: 10, col: 7 }));
        const house = field.getTile(10, 7);

        field.bulldoze(buildEvent(Tool.Bulldoze, { row: 10, col: 7 }));

        expect(demolishHouse).toHaveBeenCalledWith(house);
        expect(demolishWorkplace).not.toHaveBeenCalled();
        expect(field.getTile(10, 7)).toBeInstanceOf(Soil);
    });

    test('demolishes a workplace through City.demolishWorkplace', () => {
        const { field, demolishHouse, demolishWorkplace } = makeGame(15, 15, { withCity: true });
        field.build(buildEvent(Tool.Road, { row: 7, col: 7 }));
        field.build(buildEvent(Tool.Work, { row: 10, col: 7 }));
        const workplace = field.getTile(10, 7);

        field.bulldoze(buildEvent(Tool.Bulldoze, { row: 10, col: 7 }));

        expect(demolishWorkplace).toHaveBeenCalledWith(workplace);
        expect(demolishHouse).not.toHaveBeenCalled();
        expect(field.getTile(10, 7)).toBeInstanceOf(Soil);
    });

    test('bulldozing a road (or anything else) never calls the demolish hooks', () => {
        const { field, demolishHouse, demolishWorkplace } = makeGame(15, 15, { withCity: true });
        field.build(buildEvent(Tool.Road, { row: 7, col: 7 }));

        field.bulldoze(buildEvent(Tool.Bulldoze, { row: 7, col: 7 }));

        expect(demolishHouse).not.toHaveBeenCalled();
        expect(demolishWorkplace).not.toHaveBeenCalled();
        expect(field.getTile(7, 7)).toBeInstanceOf(Soil);
    });

    test('tolerates a missing City reference (optional chaining)', () => {
        const { field } = makeGame(15, 15, { withCity: false });
        field.build(buildEvent(Tool.Road, { row: 7, col: 7 }));
        field.build(buildEvent(Tool.House, { row: 10, col: 7 }));

        expect(() => field.bulldoze(buildEvent(Tool.Bulldoze, { row: 10, col: 7 }))).not.toThrow();
        expect(field.getTile(10, 7)).toBeInstanceOf(Soil);
    });
});

describe('Field.handleTileClick', () => {
    test('dispatches build tools (Road/Soil/House/Work) to build()', () => {
        const { field } = makeGame(15, 15);
        field.handleTileClick(buildEvent(Tool.Road, { row: 7, col: 7 }));
        expect(field.getTile(7, 7)).toBeInstanceOf(Road);
    });

    test('dispatches Bulldoze to bulldoze()', () => {
        const { field, demolishHouse } = makeGame(15, 15, { withCity: true });
        field.build(buildEvent(Tool.Road, { row: 7, col: 7 }));
        field.build(buildEvent(Tool.House, { row: 10, col: 7 }));

        field.handleTileClick(buildEvent(Tool.Bulldoze, { row: 10, col: 7 }));

        expect(demolishHouse).toHaveBeenCalled();
        expect(field.getTile(10, 7)).toBeInstanceOf(Soil);
    });

    test('throws for the Select tool (routed through Field.selectAt instead)', () => {
        const { field } = makeGame(15, 15);
        expect(() => field.handleTileClick(buildEvent(Tool.Select, { row: 1, col: 1 }))).toThrow(/Invalid tool to handle click/);
    });
});

describe('Field.selectAt', () => {
    test('returns without emitting for a null pixel position', () => {
        const { field, emitted } = makeGame(15, 15);
        field.selectAt(null);
        expect(emitted).toEqual([]);
    });

    test('emits HouseSelected for a house tile', () => {
        const { field, emitted } = makeGame(15, 15);
        field.build(buildEvent(Tool.Road, { row: 7, col: 7 }));
        field.build(buildEvent(Tool.House, { row: 10, col: 7 }));
        const house = field.getTile(10, 7);

        field.selectAt({ x: 7 * 16 + 8, y: 10 * 16 + 8 });

        expect(emitted.some(e => e.event === 'HouseSelected' && e.payload === house)).toBe(true);
    });

    test('emits WorkplaceSelected for a workplace tile', () => {
        const { field, emitted } = makeGame(15, 15);
        field.build(buildEvent(Tool.Road, { row: 7, col: 7 }));
        field.build(buildEvent(Tool.Work, { row: 10, col: 7 }));
        const workplace = field.getTile(10, 7);

        field.selectAt({ x: 7 * 16 + 8, y: 10 * 16 + 8 });

        expect(emitted.some(e => e.event === 'WorkplaceSelected' && e.payload === workplace)).toBe(true);
    });

    test('emits neither selection event for a road/soil tile', () => {
        const { field, emitted } = makeGame(15, 15);
        field.build(buildEvent(Tool.Road, { row: 7, col: 7 }));

        field.selectAt({ x: 7 * 16 + 8, y: 7 * 16 + 8 });

        expect(emitted.some(e => e.event === 'HouseSelected' || e.event === 'WorkplaceSelected')).toBe(false);
    });

    test('a visible person under the cursor takes priority over the tile', () => {
        const { field, emitted } = makeGame(15, 15);
        field.build(buildEvent(Tool.Road, { row: 7, col: 7 }));
        field.build(buildEvent(Tool.House, { row: 10, col: 7 }));
        const person = field.loadPerson(7 * 16 + 8, 10 * 16 + 8);

        field.selectAt({ x: 7 * 16 + 8, y: 10 * 16 + 8 });

        expect(emitted.some(e => e.event === 'PersonSelected' && e.payload === person)).toBe(true);
        expect(emitted.some(e => e.event === 'HouseSelected')).toBe(false);
    });

    test('returns without emitting when the pixel maps outside the grid', () => {
        const { field, emitted } = makeGame(15, 15);
        field.selectAt({ x: -1000, y: -1000 });
        expect(emitted).toEqual([]);
    });
});

describe('Field.getStructures', () => {
    test('returns each placed structure exactly once, excluding soil', () => {
        const { field } = makeGame(15, 15);
        field.build(buildEvent(Tool.Road, { row: 7, col: 7 }));
        field.build(buildEvent(Tool.House, { row: 10, col: 7 }));

        const structures = field.getStructures();

        expect(structures).toHaveLength(2);
        expect(structures.some(s => s instanceof Road)).toBe(true);
        expect(structures.some(s => s instanceof House)).toBe(true);
        expect(structures.some(s => s instanceof Soil)).toBe(false);
    });

    test('tolerates a corrupted/missing matrix row or cell (defensive guards)', () => {
        const { field } = makeGame(15, 15);
        field.build(buildEvent(Tool.Road, { row: 7, col: 7 }));

        // Simulate corruption: an entirely missing row, and a missing cell within an existing row.
        delete (field.matrix as unknown as Record<number, unknown>)[3];
        delete (field.matrix[5] as unknown as Record<number, unknown>)[3];

        expect(() => field.getStructures()).not.toThrow();
        expect(field.getStructures().some(s => s instanceof Road)).toBe(true);
    });

    test('returns an empty array on a freshly-grassed field', () => {
        const { field } = makeGame(15, 15);
        expect(field.getStructures()).toEqual([]);
    });
});

describe('Field.loadStructure', () => {
    test('places a road from a saved assetName without re-triggering roadBuilt', () => {
        const { field, emitted } = makeGame(15, 15);
        const before = emitted.length;

        const structure = field.loadStructure('road', 7, 7, 'road_1111');

        expect(structure).toBeInstanceOf(Road);
        expect((structure as Road).getAssetName()).toBe('road_1111');
        expect(emitted.slice(before)).toEqual([{ event: 'tileSpawned', payload: structure }]);
        expect(emitted.some(e => e.event === 'roadBuilt')).toBe(false);
    });

    test('places a house from a save without re-triggering houseBuilt', () => {
        const { field, emitted } = makeGame(15, 15);
        const structure = field.loadStructure('house', 7, 7, 'house_1x1');

        expect(structure).toBeInstanceOf(House);
        expect(emitted.some(e => e.event === 'houseBuilt')).toBe(false);
    });

    test('places a workplace from a save without re-triggering workplaceBuilt', () => {
        const { field, emitted } = makeGame(15, 15);
        const structure = field.loadStructure('work', 7, 7, 'work_1x1');

        expect(structure).toBeInstanceOf(Workplace);
        expect(emitted.some(e => e.event === 'workplaceBuilt')).toBe(false);
    });

    test('returns null for an unrecognized structure type', () => {
        const { field } = makeGame(15, 15);
         
        expect(field.loadStructure('bogus' as any, 1, 1, null)).toBeNull();
    });

    test('skips curb/lane computation when the pixel center cannot be resolved', () => {
        const { field } = makeGame(15, 15, { nullPixelCenter: true });
        const road = field.loadStructure('road', 7, 7, 'road_1111') as Road;

        expect(road.getCurb()).toBeNull();
        expect(road.getLane()).toBeNull();
    });
});

describe('Field person/vehicle registry (save/load support)', () => {
    test('loadPerson registers the person, resolves depth, and emits personSpawned', () => {
        const { field, emitted } = makeGame(15, 15);
        const person = field.loadPerson(24, 24);

        expect(field.getPeople()).toContain(person);
        expect(emitted.some(e => e.event === 'personSpawned' && e.payload === person)).toBe(true);
    });

    test('loadPerson still registers the person when the pixel is out of grid bounds', () => {
        const { field } = makeGame(15, 15);
        const person = field.loadPerson(-1000, -1000);
        expect(field.getPeople()).toContain(person);
    });

    test('removePerson destroys the sprite asset (if any) and drops them from the roster', () => {
        const { field } = makeGame(15, 15);
        const person = field.loadPerson(24, 24);
        const fakeAsset = { destroy: jest.fn() };
         
        person.setAsset(fakeAsset as any);

        field.removePerson(person);

        expect(field.getPeople()).not.toContain(person);
        expect(fakeAsset.destroy).toHaveBeenCalled();
    });

    test('removePerson on someone not tracked is a no-op', () => {
        const { field } = makeGame(15, 15);
        const stray = field.loadPerson(24, 24);
        field.removePerson(stray);
        expect(() => field.removePerson(stray)).not.toThrow();
    });

    test('loadVehicle registers the vehicle, resolves depth, and emits vehicleSpawned', () => {
        const { field, emitted } = makeGame(15, 15);
        const vehicle = field.loadVehicle(24, 24);

        expect(field.getVehicles()).toContain(vehicle);
        expect(emitted.some(e => e.event === 'vehicleSpawned' && e.payload === vehicle)).toBe(true);
    });

    test('loadVehicle still registers the vehicle when the pixel is out of grid bounds', () => {
        const { field } = makeGame(15, 15);
        const vehicle = field.loadVehicle(-1000, -1000);
        expect(field.getVehicles()).toContain(vehicle);
    });

    test('removeVehicle destroys the sprite asset (if any) and drops it from the roster', () => {
        const { field } = makeGame(15, 15);
        const vehicle = field.loadVehicle(24, 24);
        const fakeAsset = { destroy: jest.fn() };
         
        vehicle.setAsset(fakeAsset as any);

        field.removeVehicle(vehicle);

        expect(field.getVehicles()).not.toContain(vehicle);
        expect(fakeAsset.destroy).toHaveBeenCalled();
    });

    test('removeVehicle on something not tracked is a no-op', () => {
        const { field } = makeGame(15, 15);
        const stray = field.loadVehicle(24, 24);
        field.removeVehicle(stray);
        expect(() => field.removeVehicle(stray)).not.toThrow();
    });
});

describe('Field.getNeighbors', () => {
    test('resolves the four footprint-adjacent neighbors', () => {
        const { field } = makeGame(15, 15);
        field.build(buildEvent(Tool.Road, { row: 7, col: 7 }));
        field.build(buildEvent(Tool.Road, { row: 4, col: 7 })); // above

        const road = field.getTile(7, 7)!;
        const neighbors = field.getNeighbors(road);

        expect(neighbors.top).toBe(field.getTile(4, 7));
        expect(neighbors.bottom).toBeInstanceOf(Soil);
        expect(neighbors.left).toBeInstanceOf(Soil);
        expect(neighbors.right).toBeInstanceOf(Soil);
    });

    test('a neighbor beyond the grid boundary resolves to null', () => {
        const { field } = makeGame(15, 15);
        const anchor = field.getTile(1, 1)!; // top-left-most anchor
        const neighbors = field.getNeighbors(anchor);

        expect(neighbors.top).toBeNull();
        expect(neighbors.left).toBeNull();
    });
});

describe('Field.getTile/setTile invalid input', () => {
    test('getTile logs and returns null for an out-of-range row', () => {
        const { field } = makeGame(15, 15);
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        expect(field.getTile(999, 0)).toBeNull();
        expect(errorSpy).toHaveBeenCalled();

        errorSpy.mockRestore();
    });

    test('getTile logs and returns null for an out-of-range col', () => {
        const { field } = makeGame(15, 15);
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        expect(field.getTile(5, 999)).toBeNull();
        expect(errorSpy).toHaveBeenCalled();

        errorSpy.mockRestore();
    });

    test('setTile logs and no-ops for an out-of-range row', () => {
        const { field } = makeGame(15, 15);
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        expect(() => field.setTile(999, 0, new Soil(999, 0, 'grass'))).not.toThrow();
        expect(errorSpy).toHaveBeenCalled();

        errorSpy.mockRestore();
    });
});

describe('Field.stampFootprint / refreshFootprint edge cases', () => {
    test('stampFootprint(null) is a no-op', () => {
        const { field, emitted } = makeGame(15, 15);
        const before = emitted.length;
        expect(() => field.stampFootprint(null as unknown as Soil)).not.toThrow();
        expect(emitted.length).toBe(before);
    });

    test('refreshFootprint(null) is a no-op', () => {
        const { field } = makeGame(15, 15);
        expect(() => field.refreshFootprint(null as unknown as Soil)).not.toThrow();
    });

    test('refreshFootprint does not re-emit tileSpawned when the asset name is unchanged', () => {
        const { field, emitted } = makeGame(15, 15);
        const tile = field.getTile(1, 1)!; // an isolated grass tile; neighbors never change its asset
        const before = emitted.length;

        field.refreshFootprint(tile);

        expect(emitted.length).toBe(before);
    });

    test('refreshFootprint re-emits tileSpawned when auto-tiling changes the asset', () => {
        const { field, emitted } = makeGame(15, 15);
        field.build(buildEvent(Tool.Road, { row: 7, col: 7 }));
        const road = field.getTile(7, 7) as Road;
        expect(road.getAssetName()).toBe('road_1100'); // no neighbors yet -> the "endpoint" bucket
        const before = emitted.length;

        // A road to the left gives the first road a single left-neighbor code ('0010'), which the auto-tiler
        // buckets into the distinct 'through' sprite ('0011') — a real, visible asset change.
        field.build(buildEvent(Tool.Road, { row: 7, col: 4 }));

        expect(road.getAssetName()).toBe('road_0011');
        expect(emitted.slice(before).some(e => e.event === 'tileSpawned' && e.payload === road)).toBe(true);
    });
});

describe('Field.getRows/getCols', () => {
    test('report the constructed grid dimensions', () => {
        const { field } = makeGame(12, 18);
        expect(field.getRows()).toBe(12);
        expect(field.getCols()).toBe(18);
    });
});

describe('Field.spawnPerson', () => {
    test('throws for a null pixel position', () => {
        const { field } = makeGame(15, 15);
        expect(() => field.spawnPerson(null)).toThrow(/Invalid pixel position to spawn person/);
    });

    test('throws when the pixel maps to no tile position', () => {
        const { field } = makeGame(15, 15);
        expect(() => field.spawnPerson({ x: -1000, y: -1000 })).toThrow(/Invalid tile position to spawn person/);
    });

    test('throws when the resolved tile position has no tile', () => {
        const { field } = makeGame(15, 15);
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(field, 'getTile').mockReturnValueOnce(null);

        expect(() => field.spawnPerson({ x: 24, y: 24 })).toThrow(/Invalid tile to spawn person/);

        errorSpy.mockRestore();
    });

    test('spawns, registers, and depth-updates a person on a valid pixel position', () => {
        const { field, emitted } = makeGame(15, 15);
        const person = field.spawnPerson({ x: 24, y: 24 });

        expect(field.getPeople()).toContain(person);
        expect(emitted.some(e => e.event === 'personSpawned' && e.payload === person)).toBe(true);
    });
});

describe('Field.spawnVehicle', () => {
    test('throws for a null pixel position', () => {
        const { field } = makeGame(15, 15);
        expect(() => field.spawnVehicle(null)).toThrow(/Invalid pixel position to spawn vehicle/);
    });

    test('throws when the pixel maps to no tile position', () => {
        const { field } = makeGame(15, 15);
        expect(() => field.spawnVehicle({ x: -1000, y: -1000 })).toThrow(/Invalid tile position to spawn vehicle/);
    });

    test('throws when the resolved tile position has no tile', () => {
        const { field } = makeGame(15, 15);
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(field, 'getTile').mockReturnValueOnce(null);

        expect(() => field.spawnVehicle({ x: 24, y: 24 })).toThrow(/Invalid tile to spawn vehicle/);

        errorSpy.mockRestore();
    });

    test('spawns, registers, and depth-updates a vehicle on a valid pixel position', () => {
        const { field, emitted } = makeGame(15, 15);
        const vehicle = field.spawnVehicle({ x: 24, y: 24 });

        expect(field.getVehicles()).toContain(vehicle);
        expect(emitted.some(e => e.event === 'vehicleSpawned' && e.payload === vehicle)).toBe(true);
    });
});

describe('Placement-resolution null-position guards (defensive API surface)', () => {
    test('resolvePlacement(tool, null) is invalid regardless of tool', () => {
        const { field } = makeGame(15, 15);
        expect(field.resolvePlacement(Tool.Road, null)).toEqual({ position: null, valid: false });
        expect(field.resolvePlacement(Tool.House, null)).toEqual({ position: null, valid: false });
    });

    test('snapToRoadGrid(null) returns null', () => {
        const { field } = makeGame(15, 15);
        expect(field.snapToRoadGrid(null)).toBeNull();
    });

    test('isValidBuildingPlacement(null) is false', () => {
        const { field } = makeGame(15, 15);
        expect(field.isValidBuildingPlacement(null)).toBe(false);
    });

    test('resolveBuildingPlacement(null) is invalid', () => {
        const { field } = makeGame(15, 15);
        expect(field.resolveBuildingPlacement(null)).toEqual({ position: null, valid: false });
    });
});

describe('Field.stampFootprint overwrite teardown (destroyStructure)', () => {
    test('destroys the overwritten structure\'s sprite asset and debug text when present', () => {
        const { field } = makeGame(15, 15);
        field.build(buildEvent(Tool.Road, { row: 7, col: 7 }));
        const road = field.getTile(7, 7) as Road;

        const fakeAsset = { destroy: jest.fn() };
        const fakeDebugText = { destroy: jest.fn() };
         
        road.setAsset(fakeAsset as any);
         
        road.setDebugText(fakeDebugText as any);

        // Overwrite the road's whole footprint directly with soil, orphaning it entirely.
        field.stampFootprint(new Soil(7, 7, 'grass'));

        expect(fakeAsset.destroy).toHaveBeenCalled();
        expect(fakeDebugText.destroy).toHaveBeenCalled();
        expect(field.getTile(7, 7)).toBeInstanceOf(Soil);
    });
});
