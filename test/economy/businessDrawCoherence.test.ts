import City from 'game/City';
import GameManager from 'game/GameManager';
import Population from 'game/population/Population';
import Field from 'game/world/Field';
import Workplace from 'game/world/Workplace';
import { BusinessBlueprintTable } from 'types/Business';
import { PopulationState } from 'types/Genealogy';
import { PixelPosition, TilePosition } from 'types/Position';
import businessesConfig from 'json/businesses.json';

const BUSINESS_BLUEPRINTS = businessesConfig as unknown as BusinessBlueprintTable;

// Business draw coherence (task 123): the generic work-lot draw must never place a civic building
// (police/fire/hospital/…) OR a non-commercial amenity (beach/cemetery/park) — the audit drew a BEACH
// between the bar and the bakery — and it should spread across demand categories rather than stacking a
// second supermarket/school while others sit empty. Amenities stay placeable via the construction menu.

function makeWorld(worldSeed: number): { city: City; field: Field } {
    const rows = 60;
    const cols = 60;
    const population = new Population();
    const state: PopulationState = { worldSeed, people: {}, drawSeed: 0, placedIds: [], nextSeq: 0, lastSimulatedYear: 0 };
    population.loadState(state);

    const game = {
        field: null,
        population,
        inventory: null,
        clock: null,
        gridParams: { rows, cols, cells: { width: 16, height: 16 }, footprint: { tiles: 3, width: 48, height: 48 } },
        tileToPixelPosition: (position: TilePosition) => (position === null ? null : { x: position.col * 16 + 8, y: position.row * 16 + 8 }),
        pixelToTilePosition: (pixel: PixelPosition) => (pixel === null ? null : { row: Math.floor(pixel.y / 16), col: Math.floor(pixel.x / 16) }),
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

const AMENITY = new Set(['beach', 'cemetery', 'park']);
const CIVIC = new Set(Object.keys(BUSINESS_BLUEPRINTS).filter(k => BUSINESS_BLUEPRINTS[k]!.placement === 'civic'));

// Places a work lot at a distinct anchor per index and returns its drawn blueprint key.
function drawAt(city: City, field: Field, index: number): string {
    const row = 4 + (index % 12) * 4;
    const col = 4 + Math.floor(index / 12) * 4;
    const workplace = field.loadStructure('work', row, col, 'building_1x1x1_1') as Workplace;
    city.setupBusiness(workplace);
    return workplace.getBusiness()!.blueprintKey;
}

describe('business draw coherence (task 123)', () => {
    test('the generic draw never places an amenity (beach/cemetery/park) across many lots and seeds', () => {
        const drawn = new Set<string>();
        for (const seed of [1, 42, 777, 20260720]) {
            const { city, field } = makeWorld(seed);
            for (let i = 0; i < 24; i++) {
                drawn.add(drawAt(city, field, i));
            }
        }
        for (const key of AMENITY) {
            expect(drawn.has(key)).toBe(false);
        }
        // And the draw is still lively — a healthy spread of real businesses can appear.
        expect(drawn.size).toBeGreaterThan(4);
    });

    test('the generic draw never places a civic building (fencing untouched)', () => {
        const drawn = new Set<string>();
        for (const seed of [3, 99, 12345]) {
            const { city, field } = makeWorld(seed);
            for (let i = 0; i < 24; i++) {
                drawn.add(drawAt(city, field, i));
            }
        }
        for (const key of CIVIC) {
            expect(drawn.has(key)).toBe(false);
        }
    });

    test('sequential placements spread across demand categories instead of stacking', () => {
        const { city, field } = makeWorld(20260720);
        // A real population so demand (and category deficits) is positive — the weighted draw engages.
        for (let i = 0; i < 60; i++) {
            field.loadPerson(100 + i, 100 + i);
        }
        const categories: string[] = [];
        for (let i = 0; i < 10; i++) {
            const key = drawAt(city, field, i);
            categories.push(BUSINESS_BLUEPRINTS[key]!.category);
        }
        const distinct = new Set(categories);
        // The unrepresented-category boost keeps the town from collapsing into one or two categories.
        expect(distinct.size).toBeGreaterThanOrEqual(4);
        // No single category hogs the whole town.
        const maxInOneCategory = Math.max(...[...distinct].map(c => categories.filter(x => x === c).length));
        expect(maxInOneCategory).toBeLessThan(categories.length);
    });

    test('an amenity is still placeable through a construction-menu pin', () => {
        const { city, field } = makeWorld(5);
        const workplace = field.loadStructure('work', 10, 10, 'building_1x1x1_1') as Workplace;
        workplace.setPendingBlueprint('beach');
        city.setupBusiness(workplace);
        expect(workplace.getBusiness()!.blueprintKey).toBe('beach');
    });
});
