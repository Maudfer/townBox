import City from 'game/City';
import Clock from 'game/Clock';
import GameManager from 'game/GameManager';
import Person from 'game/agents/Person';
import Population from 'game/population/Population';
import Field from 'game/world/Field';
import House from 'game/world/House';
import Workplace from 'game/world/Workplace';
import { GenPerson, PersonId, PersonTable } from 'types/Genealogy';
import { PixelPosition, TilePosition } from 'types/Position';
import { Genders, Gender } from 'types/Social';

// Migration (W1 / proposal simulation-aliveness-3 P0-3): a town whose adults are all employed, whose
// businesses hold real openings, and which has a vacant home ATTRACTS one household per day — through the
// normal setupHousehold path. These tests pin the three gates; the draw itself is setupHousehold's own
// covered machinery (spied here, not re-run).

const TPY = 360;
const HOUR_MS = 3_600_000;

function gen(id: string, gender: Gender, ageYears: number, tickNow: number): GenPerson {
    return {
        id, firstName: id, familyName: 'Fam', gender,
        birthTick: tickNow - ageYears * TPY, deathTick: null,
        fatherId: null, motherId: null, partnerships: [],
    };
}

function makeGame(rows: number, cols: number): { field: Field; population: Population; city: City } {
    const population = new Population();
    const clock = new Clock();
    const game = {
        field: null, population, clock,
        gridParams: { rows, cols, cells: { width: 16, height: 16 }, footprint: { tiles: 3, width: 48, height: 48 } },
        tileToPixelPosition: (p: TilePosition) => (p === null ? null : { x: p.col * 16 + 8, y: p.row * 16 + 8 }),
        pixelToTilePosition: (p: PixelPosition) => {
            if (p === null) { return null; }
            const row = Math.floor(p.y / 16);
            const col = Math.floor(p.x / 16);
            return row < 0 || row >= rows || col < 0 || col >= cols ? null : { row, col };
        },
        emit: () => {}, emitSingle: () => {}, on: () => {}, toolbelt: {},
    } as unknown as GameManager;
    const field = new Field(game, rows, cols);
    (game as unknown as { field: Field }).field = field;
    const city = new City(game);
    (game as unknown as { city: City }).city = city;
    clock.setElapsedMs(40 * TPY * HOUR_MS);
    return { field, population, city };
}

function loadState(population: Population, people: PersonTable, placedIds: PersonId[]): void {
    population.loadState({ worldSeed: 7, people, drawSeed: 0, placedIds, nextSeq: Object.keys(people).length, lastSimulatedYear: 0 });
}

function employAt(field: Field, home: House, workplace: Workplace, id: string): Person {
    const person = field.loadPerson(72, 72);
    person.social.setPersonId(id);
    person.social.setHome(home);
    home.addResident(person);
    person.work.setJob({ title: 'Clerk', salary: 1000, requirements: [], shiftStart: 540, shiftEnd: 1020 });
    person.work.setWorkplace(workplace);
    return person;
}

type MigratableCity = { runMigration(tick: number, tpy: number): void };

function town(openPositions: number, vacantHouse: boolean): { city: City; field: Field; population: Population; spy: jest.SpyInstance } {
    const tickNow = 40 * TPY;
    const { field, population, city } = makeGame(60, 60);
    const worker = gen('a', Genders.Female, 40, tickNow);
    loadState(population, { a: worker }, ['a']);
    const home = field.loadStructure('house', 4, 4, 'h') as House;
    const shop = field.loadStructure('work', 7, 7, 'w') as Workplace;
    shop.setBusiness({
        blueprintKey: 'supermarket', name: 'Mart', lineOfWork: 'Retail', size: 1,
        positions: Array.from({ length: openPositions }, () => ({ title: 'Clerk', salary: 1000, requirements: [], shiftStart: 540, shiftEnd: 1020 })),
    });
    employAt(field, home, shop, 'a');
    if (vacantHouse) {
        field.loadStructure('house', 16, 16, 'h2');
    }
    const spy = jest.spyOn(city, 'setupHousehold').mockResolvedValue(undefined);
    return { city, field, population, spy };
}

describe('W1: the migration gates', () => {
    afterEach(() => jest.restoreAllMocks());

    test('full employment + open positions + a vacant home → one household draw', () => {
        const { city, spy } = town(4, true);
        (city as unknown as MigratableCity).runMigration(40 * TPY, TPY);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    test('an unemployed local blocks migration (locals first)', () => {
        const { city, field, population, spy } = town(4, true);
        const tickNow = 40 * TPY;
        const idle = gen('b', Genders.Male, 30, tickNow);
        population.getPeople()['b'] = idle;
        const person = field.loadPerson(80, 80);
        person.social.setPersonId('b'); // adult, no job
        (city as unknown as MigratableCity).runMigration(tickNow, TPY);
        expect(spy).not.toHaveBeenCalled();
    });

    test('too few openings is not a shortage — no draw', () => {
        const { city, spy } = town(2, true);
        (city as unknown as MigratableCity).runMigration(40 * TPY, TPY);
        expect(spy).not.toHaveBeenCalled();
    });

    test('no vacant home, no draw (build first)', () => {
        const { city, spy } = town(4, false);
        (city as unknown as MigratableCity).runMigration(40 * TPY, TPY);
        expect(spy).not.toHaveBeenCalled();
    });
});
