import City from 'game/City';
import GameManager from 'game/GameManager';
import Inventory from 'game/objects/Inventory';
import Population from 'game/population/Population';
import Field from 'game/world/Field';
import Workplace from 'game/world/Workplace';
import { PopulationState } from 'types/Genealogy';
import { PixelPosition, TilePosition } from 'types/Position';

function makeWorld(worldSeed: number, inventory: Inventory | null = null): { city: City; field: Field } {
    const rows = 30;
    const cols = 30;
    const population = new Population();
    const state: PopulationState = { worldSeed, people: {}, drawSeed: 0, placedIds: [], nextSeq: 0, lastSimulatedYear: 0 };
    population.loadState(state);

    const game = {
        field: null,
        population,
        inventory,
        clock: null,
        gridParams: { rows, cols, cells: { width: 16, height: 16 }, footprint: { tiles: 3, width: 48, height: 48 } },
        tileToPixelPosition: (position: TilePosition) => (position === null ? null : { x: position.col * 16 + 8, y: position.row * 16 + 8 }),
        pixelToTilePosition: (pixel: PixelPosition) => {
            if (pixel === null) {
                return null;
            }
            return { row: Math.floor(pixel.y / 16), col: Math.floor(pixel.x / 16) };
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

describe('City.setupBusiness', () => {
    test('assigns a generated business with open positions to a placed workplace', () => {
        const { city, field } = makeWorld(123);
        const workplace = field.loadStructure('work', 10, 10, 'building_1x1x2_2') as Workplace;

        city.setupBusiness(workplace);

        const business = workplace.getBusiness();
        expect(business).not.toBeNull();
        expect(business!.positions.length).toBeGreaterThan(0);
        expect(business!.lineOfWork.length).toBeGreaterThan(0);
        // Every open position is offered for hiring.
        expect(business!.positions[0]!.shiftStart).toBeLessThan(business!.positions[0]!.shiftEnd);
    });

    test('is deterministic per world seed + location', () => {
        const a = makeWorld(123);
        const b = makeWorld(123);
        const workplaceA = a.field.loadStructure('work', 10, 10, 'building_1x1x2_2') as Workplace;
        const workplaceB = b.field.loadStructure('work', 10, 10, 'building_1x1x2_2') as Workplace;

        a.city.setupBusiness(workplaceA);
        b.city.setupBusiness(workplaceB);

        const businessA = workplaceA.getBusiness()!;
        const businessB = workplaceB.getBusiness()!;
        expect(businessA.blueprintKey).toBe(businessB.blueprintKey);
        expect(businessA.name).toBe(businessB.name);
        expect(businessA.size).toBe(businessB.size);
        expect(businessA.positions).toEqual(businessB.positions);
    });

    test('different locations can yield different businesses', () => {
        const { city, field } = makeWorld(123);
        const here = field.loadStructure('work', 4, 4, 'building_1x1x2_2') as Workplace;
        const there = field.loadStructure('work', 22, 22, 'building_1x1x2_2') as Workplace;

        city.setupBusiness(here);
        city.setupBusiness(there);

        // Seeds differ by anchor key, so the generated identities are independent (names almost certainly differ).
        expect(here.getBusiness()!.name).not.toBe(there.getBusiness()!.name);
    });
});

// H1 (task 076): objects must be generated AT PLACEMENT, not only via the save/load sweep. Before the fix a
// fresh session's buildings were empty, so every object-grounded action was unreachable until a round-trip.
describe('contextual object generation at placement (H1)', () => {
    test('a freshly placed business is filled with contextual objects immediately (no save/load)', () => {
        const inventory = new Inventory();
        const { city, field } = makeWorld(123, inventory);
        const workplace = field.loadStructure('work', 10, 10, 'building_1x1x2_2') as Workplace;

        expect(workplace.isObjectsGenerated()).toBe(false);
        city.setupBusiness(workplace);

        const key = workplace.getIdentifier();
        expect(inventory.instancesAtLocation(`building:${key}`).length).toBeGreaterThan(0);
        expect(workplace.isObjectsGenerated()).toBe(true);
    });

    test('placement fill is idempotent — re-running setup does not double-fill', () => {
        const inventory = new Inventory();
        const { city, field } = makeWorld(123, inventory);
        const workplace = field.loadStructure('work', 10, 10, 'building_1x1x2_2') as Workplace;

        city.setupBusiness(workplace);
        const key = workplace.getIdentifier();
        const count = inventory.instancesAtLocation(`building:${key}`).length;

        // Simulate a stray re-setup (e.g. a second workplaceBuilt): the flag guards against a double-fill.
        city.setupBusiness(workplace);
        expect(inventory.instancesAtLocation(`building:${key}`).length).toBe(count);
    });
    // (Generator determinism per seed+anchor is covered by objectGeneration.test.ts on the pure function.)
});
