import City from 'game/City';
import Agenda from 'game/actions/Agenda';
import Clock from 'game/Clock';
import GameManager from 'game/GameManager';
import Person from 'game/agents/Person';
import Economy from 'game/economy/Economy';
import Population from 'game/population/Population';
import Field from 'game/world/Field';
import House from 'game/world/House';
import Soil from 'game/world/Soil';
import Workplace from 'game/world/Workplace';
import { Tool } from 'types/Cursor';
import { GenPerson, PersonId, PersonTable } from 'types/Genealogy';
import { HouseholdArrangements } from 'types/Household';
import { PixelPosition, TilePosition } from 'types/Position';
import { Genders, Gender } from 'types/Social';

const TPY = 360;
const HOUR_MS = 3_600_000;

function gen(id: string, gender: Gender, ageYears: number, tickNow: number, parents: { fatherId?: string; motherId?: string } = {}): GenPerson {
    return {
        id, firstName: id, familyName: 'Fam', gender,
        birthTick: tickNow - ageYears * TPY, deathTick: null,
        fatherId: parents.fatherId ?? null, motherId: parents.motherId ?? null, partnerships: [],
    };
}

function makeGame(rows: number, cols: number): { field: Field; population: Population; economy: Economy; city: City; game: GameManager } {
    const population = new Population();
    const clock = new Clock();
    const economy = new Economy();
    const toolbelt = { soil: 'soil', road: 'road', house: 'house', work: 'work', select: 'select', bulldoze: 'bulldoze' };
    const game = {
        field: null, population, clock, economy,
        gridParams: { rows, cols, cells: { width: 16, height: 16 }, footprint: { tiles: 3, width: 48, height: 48 } },
        tileToPixelPosition: (p: TilePosition) => (p === null ? null : { x: p.col * 16 + 8, y: p.row * 16 + 8 }),
        pixelToTilePosition: (p: PixelPosition) => {
            if (p === null) { return null; }
            const row = Math.floor(p.y / 16);
            const col = Math.floor(p.x / 16);
            return row < 0 || row >= rows || col < 0 || col >= cols ? null : { row, col };
        },
        emit: () => {}, emitSingle: () => {}, on: () => {}, toolbelt,
    } as unknown as GameManager;

    const field = new Field(game, rows, cols);
    (game as unknown as { field: Field }).field = field;
    const city = new City(game);
    (game as unknown as { city: City }).city = city;
    clock.setElapsedMs(40 * TPY * HOUR_MS);
    return { field, population, economy, city, game };
}

function loadState(population: Population, people: PersonTable, placedIds: PersonId[]): void {
    population.loadState({ worldSeed: 7, people, drawSeed: 0, placedIds, nextSeq: Object.keys(people).length, lastSimulatedYear: 0 });
}

function materialize(field: Field, house: House, id: string, x: number, y: number): Person {
    const person = field.loadPerson(x, y);
    person.social.setPersonId(id);
    person.social.setHome(house);
    house.addResident(person);
    house.addOccupant(person);
    return person;
}

function job(title: string): { title: string; salary: number; requirements: string[]; shiftStart: number; shiftEnd: number } {
    return { title, salary: 1000, requirements: ['assist_customers'], shiftStart: 540, shiftEnd: 1020 };
}

describe('Bulldoze teardown (task 025)', () => {
    test('bulldozing an occupied house makes its residents homeless and leaves no dangling references', () => {
        const tickNow = 40 * TPY;
        const { field, population, city } = makeGame(40, 40);
        const a = gen('a', Genders.Female, 40, tickNow);
        loadState(population, { a }, ['a']);

        const house = field.loadStructure('house', 4, 4, 'building_1x1x1_1') as House;
        const personA = materialize(field, house, 'a', 72, 72);
        house.setHousehold({ id: 'hh-1', houseKey: house.getIdentifier(), headId: 'a', memberIds: ['a'], arrangement: HouseholdArrangements.Single });

        field.bulldoze({ position: { row: 4, col: 4 }, tool: Tool.Bulldoze });

        expect(field.getTile(4, 4)).toBeInstanceOf(Soil); // structure torn down
        expect(personA.social.getHome()).toBeNull(); // no dangling reference to the destroyed house
        const homeless = city.getHomelessHouseholds();
        expect(homeless).toHaveLength(1);
        expect(homeless[0]!.memberIds).toEqual(['a']);
    });

    test('bulldozing a house relocates residents to a solvent relative when one exists', () => {
        const tickNow = 40 * TPY;
        const { field, population, economy } = makeGame(40, 40);
        const dad = gen('dad', Genders.Male, 80, tickNow);
        dad.deathTick = tickNow - 5 * TPY;
        const a = gen('a', Genders.Female, 40, tickNow, { fatherId: 'dad' });
        const sib = gen('sib', Genders.Male, 44, tickNow, { fatherId: 'dad' });
        loadState(population, { dad, a, sib }, ['a', 'sib']);

        const house1 = field.loadStructure('house', 4, 4, 'building_1x1x1_1') as House;
        const personA = materialize(field, house1, 'a', 72, 72);
        house1.setHousehold({ id: 'hh-1', houseKey: house1.getIdentifier(), headId: 'a', memberIds: ['a'], arrangement: HouseholdArrangements.Single });

        const house2 = field.loadStructure('house', 16, 16, 'building_1x1x1_1') as House;
        materialize(field, house2, 'sib', 256, 256);
        house2.setHousehold({ id: 'hh-2', houseKey: house2.getIdentifier(), headId: 'sib', memberIds: ['sib'], arrangement: HouseholdArrangements.Single });
        economy.setPersonBalance('sib', 50000);

        field.bulldoze({ position: { row: 4, col: 4 }, tool: Tool.Bulldoze });

        expect(field.getTile(4, 4)).toBeInstanceOf(Soil);
        expect(personA.social.getHome()).toBe(house2); // taken in by the sibling
        expect(house2.getHousehold()!.memberIds).toContain('a');
    });

    test('bulldozing a workplace closes its business and lays off its employees', () => {
        const { field } = makeGame(40, 40);
        const workplace = field.loadStructure('work', 10, 10, 'building_1x1x2_2') as Workplace;
        workplace.setBusiness({ blueprintKey: 'supermarket', name: 'Mart', lineOfWork: 'Super Market', size: 1, positions: [] });
        const employee = field.loadPerson(160, 160);
        employee.social.setPersonId('e');
        employee.work.setJob(job('Clerk'));
        workplace.addEmployee(employee);

        field.bulldoze({ position: { row: 10, col: 10 }, tool: Tool.Bulldoze });

        expect(field.getTile(10, 10)).toBeInstanceOf(Soil);
        expect(employee.work.getJob()).toBeNull(); // laid off → re-enters the job market
    });
});

// W9 — construction & demolition UX (proposal simulation-aliveness-3 P0-6 / P1-11).
describe('W9: bulldoze truth and visible displacement', () => {
    test('an OFF-ANCHOR bulldoze click still removes the whole structure — no ghost buildings', () => {
        const tickNow = 40 * TPY;
        const { field, population } = makeGame(40, 40);
        const a = gen('a', Genders.Female, 40, tickNow);
        loadState(population, { a }, ['a']);
        const house = field.loadStructure('house', 4, 4, 'building_1x1x1_1') as House;
        materialize(field, house, 'a', 72, 72);
        house.setHousehold({ id: 'hh-1', houseKey: house.getIdentifier(), headId: 'a', memberIds: ['a'], arrangement: HouseholdArrangements.Single });

        // The click lands on a corner CELL of the footprint, not the anchor.
        field.bulldoze({ position: { row: 5, col: 5 }, tool: Tool.Bulldoze });

        // Every cell of the 3×3 footprint is grass — the sprite-owning structure is fully torn down.
        for (let row = 3; row <= 5; row++) {
            for (let col = 3; col <= 5; col++) {
                expect(field.getTile(row, col)).toBeInstanceOf(Soil);
            }
        }
    });

    test('demolition EJECTS occupants onto the street — visible, outside, nowhere-building', () => {
        const tickNow = 40 * TPY;
        const { field, population } = makeGame(40, 40);
        const a = gen('a', Genders.Female, 40, tickNow);
        loadState(population, { a }, ['a']);
        field.loadStructure('road', 1, 4, 'road_1100'); // the connected street above the home
        const house = field.loadStructure('house', 4, 4, 'building_1x1x1_1') as House;
        const personA = materialize(field, house, 'a', 72, 72);
        personA.setIndoors(true);
        personA.setCurrentBuilding(house);
        house.setHousehold({ id: 'hh-1', houseKey: house.getIdentifier(), headId: 'a', memberIds: ['a'], arrangement: HouseholdArrangements.Single });

        field.bulldoze({ position: { row: 4, col: 4 }, tool: Tool.Bulldoze });

        expect(personA.isIndoors()).toBe(false); // on the street, not hidden (the old flow hid the homeless)
        expect(personA.getCurrentBuilding()).toBeNull();
        // Standing on the connected street tile, not inside the dead footprint.
        const tile = field.getTile(Math.floor(personA.getPosition()!.y / 16), Math.floor(personA.getPosition()!.x / 16));
        expect(tile).not.toBeInstanceOf(House);
    });

    test('the homeless SEEK: a daily agenda entry, and a committed search triggers recovery at the door', () => {
        const tickNow = 40 * TPY;
        const { field, population, economy, city, game } = makeGame(40, 40);
        const agenda = new Agenda();
        (game as unknown as { agenda: Agenda }).agenda = agenda;
        const a = gen('a', Genders.Female, 40, tickNow);
        loadState(population, { a }, ['a']);
        const house = field.loadStructure('house', 4, 4, 'building_1x1x1_1') as House;
        materialize(field, house, 'a', 72, 72);
        house.setHousehold({ id: 'hh-1', houseKey: house.getIdentifier(), headId: 'a', memberIds: ['a'], arrangement: HouseholdArrangements.Single });
        field.bulldoze({ position: { row: 4, col: 4 }, tool: Tool.Bulldoze });
        expect(city.getHomelessHouseholds()).toHaveLength(1);

        // The daily producer enqueues the visible street search — once (dedup by routine id).
        const producer = city as unknown as { enqueueHomeSeeking(tick: number, tpy: number): void };
        producer.enqueueHomeSeeking(tickNow, TPY);
        producer.enqueueHomeSeeking(tickNow, TPY);
        expect(agenda.hasPendingRoutine('a', 'home_seeking', tickNow)).toBe(true);
        expect(agenda.dueEntriesOf('a', tickNow, () => false).filter(e => e.actionId === 'looking_for_a_home')).toHaveLength(1);

        // The committed search pays off at the door: funds + a vacant home → rehoused NOW, not next month.
        economy.setPersonBalance('a', 50000);
        field.loadStructure('house', 16, 16, 'building_1x1x1_1') as House;
        city.attemptRecoveryFor('a', tickNow);
        expect(city.getHomelessHouseholds()).toHaveLength(0);
        const personA = field.getPeople().find(p => p.social.getPersonId() === 'a')!;
        expect(personA.social.getHome()).not.toBeNull();
    });
});

// W4 — household truth 2 (proposal simulation-aliveness-3 P1-4): households rehouse as a UNIT.
describe('W4: household-unit rehousing', () => {
    test('a displaced couple moves in together when a relative can take BOTH — never split', () => {
        const tickNow = 40 * TPY;
        const { field, population, economy } = makeGame(40, 40);
        const dad = gen('dad', Genders.Male, 80, tickNow);
        dad.deathTick = tickNow - 5 * TPY;
        const a = gen('a', Genders.Female, 40, tickNow, { fatherId: 'dad' });
        const partner = gen('p', Genders.Male, 41, tickNow); // NOT blood kin of the sibling host
        a.partnerships = [{ partnerId: 'p', startTick: tickNow - 10 * TPY, endTick: null }];
        partner.partnerships = [{ partnerId: 'a', startTick: tickNow - 10 * TPY, endTick: null }];
        const sib = gen('sib', Genders.Male, 44, tickNow, { fatherId: 'dad' });
        loadState(population, { dad, a, p: partner, sib }, ['a', 'p', 'sib']);

        const home = field.loadStructure('house', 4, 4, 'building_1x1x1_1') as House;
        const personA = materialize(field, home, 'a', 72, 72);
        const personP = materialize(field, home, 'p', 72, 72);
        home.setHousehold({ id: 'hh-1', houseKey: home.getIdentifier(), headId: 'a', memberIds: ['a', 'p'], arrangement: HouseholdArrangements.Nuclear });

        const hostHome = field.loadStructure('house', 16, 16, 'building_1x1x1_1') as House;
        materialize(field, hostHome, 'sib', 256, 256);
        hostHome.setHousehold({ id: 'hh-2', houseKey: hostHome.getIdentifier(), headId: 'sib', memberIds: ['sib'], arrangement: HouseholdArrangements.Single });
        economy.setPersonBalance('sib', 50000);

        field.bulldoze({ position: { row: 4, col: 4 }, tool: Tool.Bulldoze });

        // BOTH landed with the sibling — the audit's fire split exactly this pairing.
        expect(personA.social.getHome()).toBe(hostHome);
        expect(personP.social.getHome()).toBe(hostHome);
        expect(hostHome.getHousehold()!.memberIds).toEqual(expect.arrayContaining(['a', 'p']));
    });
});
