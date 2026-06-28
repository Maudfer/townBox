import Field from '../src/app/game/Field';
import City from '../src/app/game/City';
import Workplace from '../src/app/game/Workplace';
import Population from '../src/app/game/Population';
import GameManager from '../src/app/game/GameManager';

import { PixelPosition, TilePosition } from '../src/types/Position';
import { PopulationState } from '../src/types/Genealogy';

function makeWorld(worldSeed: number): { city: City; field: Field } {
    const rows = 30;
    const cols = 30;
    const population = new Population();
    const state: PopulationState = { worldSeed, people: {}, drawSeed: 0, placedIds: [], nextSeq: 0, lastSimulatedYear: 0 };
    population.loadState(state);

    const game = {
        field: null,
        population,
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
