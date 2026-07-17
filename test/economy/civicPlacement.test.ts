import City from 'game/City';
import Clock from 'game/Clock';
import EventEngine from 'game/events/EventEngine';
import Economy from 'game/economy/Economy';
import GameManager from 'game/GameManager';
import SkillBook from 'game/skills/SkillBook';
import Population from 'game/population/Population';
import Field from 'game/world/Field';
import Workplace from 'game/world/Workplace';
import businessesConfig from 'json/businesses.json';
import { BusinessBlueprintTable } from 'types/Business';
import { GenPerson } from 'types/Genealogy';
import { PixelPosition, TilePosition } from 'types/Position';
import { Genders } from 'types/Social';

// Civic placement (task 108): the construction menu's pinned blueprint instantiates EXACTLY that business,
// and civic blueprints (placement: 'civic') can NEVER enter the world any other way — not the generic
// demand-weighted draw, not re-occupancy, not entrepreneurship. The menu is their only spawn path.

const TPY = 8640;
const HOUR_MS = 60 * 60 * 1000 / 24;
const TICK_NOW = 40 * TPY;
const BLUEPRINTS = businessesConfig as unknown as BusinessBlueprintTable;
const CIVIC = Object.entries(BLUEPRINTS).filter(([, blueprint]) => blueprint.placement === 'civic').map(([key]) => key);

function gen(id: string): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: TICK_NOW - 30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function makeGame() {
    const rows = 60;
    const cols = 60;
    const population = new Population();
    const clock = new Clock();
    const economy = new Economy();
    const eventEngine = new EventEngine();
    const skillBook = new SkillBook();
    const game = {
        field: null,
        population,
        clock,
        economy,
        eventEngine,
        skillBook,
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
    (game as unknown as { city: City }).city = city;
    return { game, field, population, clock, economy, city, skillBook };
}

describe('the pinned path (the menu)', () => {
    test('a pinned placement instantiates exactly that blueprint — and the pin is consumed', () => {
        const world = makeGame();
        world.population.loadState({ worldSeed: 5, people: {}, drawSeed: 0, placedIds: [], nextSeq: 0, lastSimulatedYear: 0 });
        const lot = world.field.loadStructure('work', 10, 10, 'civic_police_station') as Workplace;
        lot.setPendingBlueprint('police_station');
        world.city.setupBusiness(lot);
        expect(lot.getBusiness()!.blueprintKey).toBe('police_station');
        expect(lot.takePendingBlueprint()).toBeNull(); // consumed at setup
    });
});

describe('the excluded paths', () => {
    test('civic blueprints never come out of the generic draw — empty towns or demand-weighted alike', () => {
        expect(CIVIC.length).toBeGreaterThanOrEqual(5);
        const world = makeGame();
        const people: Record<string, GenPerson> = {};
        for (let index = 0; index < 25; index++) {
            people[`p${index}`] = gen(`p${index}`);
        }
        world.population.loadState({ worldSeed: 77, people, drawSeed: 0, placedIds: [], nextSeq: 30, lastSimulatedYear: 0 });
        world.clock.setElapsedMs(TICK_NOW * HOUR_MS);
        for (let index = 0; index < 25; index++) {
            world.field.loadPerson(100 + index * 5, 100).social.setPersonId(`p${index}`);
        }
        // 60 lots across the map: the weighted first draw runs for every one (population present).
        const drawn = new Set<string>();
        for (let index = 0; index < 60; index++) {
            const row = 4 + Math.floor(index / 8) * 6;
            const col = 4 + (index % 8) * 6;
            const lot = world.field.loadStructure('work', col, row, 'building_1x1x2_2') as Workplace;
            world.city.setupBusiness(lot);
            drawn.add(lot.getBusiness()!.blueprintKey);
        }
        for (const civicKey of CIVIC) {
            expect(drawn.has(civicKey)).toBe(false);
        }
        expect(drawn.size).toBeGreaterThan(3); // the draw still varies — only the civic set is fenced off
    });

    test('a founder qualified ONLY for civic trades never founds anything', () => {
        const world = makeGame();
        const people = { officer: gen('officer') };
        world.population.loadState({ worldSeed: 9, people, drawSeed: 0, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 });
        world.clock.setElapsedMs(TICK_NOW * HOUR_MS);
        world.field.loadPerson(120, 120).social.setPersonId('officer');
        // Strictly qualified for police work, rich, unemployed — and the town has demand + a vacant lot.
        world.skillBook.grantWithPrerequisites('officer', 'patrol_premises', 40, TICK_NOW, 'test');
        world.skillBook.grantWithPrerequisites('officer', 'de_escalate_conflicts', 40, TICK_NOW, 'test');
        world.economy.adjustPerson('officer', 5000);
        const lot = world.field.loadStructure('work', 10, 10, 'building_1x1x2_2') as Workplace;
        for (let month = 1; month <= 12; month++) {
            world.city.processMonthlyEconomy(TICK_NOW + month * 720);
        }
        const business = lot.getBusiness();
        // Re-occupancy may fill the lot generically, but no CIVIC business ever appears, and the officer
        // never self-hired into a founding (nobody founds a police department).
        if (business) {
            expect(CIVIC).not.toContain(business.blueprintKey);
        }
        const person = world.field.getPeople().find(p => p.social.getPersonId() === 'officer')!;
        const foundedByThem = business !== null && person.work.getWorkplace() === lot;
        expect(foundedByThem).toBe(false);
    });
});
