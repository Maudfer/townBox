import City from 'game/City';
import Clock from 'game/Clock';
import EventEngine from 'game/events/EventEngine';
import CityIncidents from 'game/economy/CityIncidents';
import Economy from 'game/economy/Economy';
import GameManager from 'game/GameManager';
import Population from 'game/population/Population';
import Field from 'game/world/Field';
import economyConfig from 'json/economy.json';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { PixelPosition, TilePosition } from 'types/Position';
import { Genders } from 'types/Social';

// The justice loop (task 099 / proposal G4): the police day sweep resolves witnessed incidents (fine through
// the conserved ledger + got_caught on the record + the case closed), unwitnessed crimes are unknowable and
// go cold, and a town with MEASURED zero police coverage never resolves anything — the ledger's consequence.

const TPY = 8640;
const HOUR_MS = 60 * 60 * 1000 / 24;
const TICK_NOW = 40 * TPY;
const FINE = (economyConfig as { crimeFineAmount: number }).crimeFineAmount;

function gen(id: string, ageYears: number): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: TICK_NOW - ageYears * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function makeGame() {
    const rows = 40;
    const cols = 40;
    const population = new Population();
    const clock = new Clock();
    const economy = new Economy();
    const eventEngine = new EventEngine();
    const incidents = new CityIncidents();
    const game = {
        field: null,
        population,
        clock,
        economy,
        eventEngine,
        incidents,
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
    return { game, field, population, clock, economy, city, eventEngine, incidents };
}

function loadPeople(world: ReturnType<typeof makeGame>, ids: string[]): void {
    const people: Record<string, GenPerson> = {};
    for (const id of ids) {
        people[id] = gen(id, 30);
    }
    const state: PopulationState = { worldSeed: 3, people, drawSeed: 0, placedIds: [], nextSeq: 10, lastSimulatedYear: 0 };
    world.population.loadState(state);
    world.clock.setElapsedMs(TICK_NOW * HOUR_MS);
    ids.forEach((id, index) => {
        world.field.loadPerson(100 + index * 5, 100).social.setPersonId(id);
    });
}

describe('the police day sweep', () => {
    test('a witnessed incident resolves: fine (conserved), got_caught on the record, case closed', () => {
        const world = makeGame();
        loadPeople(world, ['thief']);
        world.economy.adjustPerson('thief', 500);
        world.incidents.report('shoplifting', TICK_NOW, 'building:5-5', 'thief', 3);
        const totalBefore = world.economy.grandTotal();

        // Unmeasured coverage reads neutral (0.5) — enough for the sweep to work the case. Chance/day ≈
        // 0.12 × 0.5 × 3 = 0.18 → over 25 in-game days the deterministic stream lands a conviction.
        let convicted = false;
        for (let day = 1; day <= 25 && !convicted; day++) {
            world.city.runPoliceWork(TICK_NOW + day * 24, TPY);
            convicted = !world.incidents.isWanted('thief');
        }
        expect(convicted).toBe(true);
        expect(world.incidents.open()).toHaveLength(0);
        expect(world.economy.getPersonBalance('thief')).toBe(500 - FINE);
        expect(world.economy.grandTotal()).toBeCloseTo(totalBefore, 6); // the fine is external-mirrored
        expect(world.eventEngine.getPersonLog('thief').some(e => e.kind === 'event' && e.defId === 'got_caught')).toBe(true);
    });

    test('an unwitnessed crime is unknowable: never resolved, eventually cold', () => {
        const world = makeGame();
        loadPeople(world, ['sneak']);
        world.incidents.report('pickpocketing', TICK_NOW, 'outside', 'sneak', 0);
        for (let day = 1; day <= 40; day++) {
            world.city.runPoliceWork(TICK_NOW + day * 24, TPY);
        }
        expect(world.eventEngine.getPersonLog('sneak')).toHaveLength(0);
        expect(world.incidents.all()[0]!.status).toBe('cold'); // the trail expired
    });

    test('measured ZERO police coverage: nothing ever resolves — the coverage consequence', () => {
        const world = makeGame();
        loadPeople(world, ['thief', 'bystander']);
        world.city.recomputeServices(TICK_NOW); // a real town with people and NO police station → coverage 0
        world.incidents.report('shoplifting', TICK_NOW, 'building:5-5', 'thief', 3);
        for (let day = 1; day <= 25; day++) {
            world.city.runPoliceWork(TICK_NOW + day * 24, TPY);
        }
        expect(world.eventEngine.getPersonLog('thief').some(e => e.kind === 'event' && e.defId === 'got_caught')).toBe(false);
        // Still open until the cold sweep catches up — but never RESOLVED.
        expect(world.incidents.all()[0]!.status).not.toBe('resolved');
    });
});
