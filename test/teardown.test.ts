import Field from '../src/app/game/Field';
import House from '../src/app/game/House';
import Workplace from '../src/app/game/Workplace';
import Soil from '../src/app/game/Soil';
import City from '../src/app/game/City';
import Population from '../src/app/game/Population';
import Clock from '../src/app/game/Clock';
import Economy from '../src/app/game/Economy';
import GameManager from '../src/app/game/GameManager';
import Person from '../src/app/game/Person';

import { GenPerson, PersonId, PersonTable } from '../src/types/Genealogy';
import { HouseholdArrangements } from '../src/types/Household';
import { Genders, Gender } from '../src/types/Social';
import { JobRequirements } from '../src/types/Work';
import { Tool } from '../src/types/Cursor';
import { PixelPosition, TilePosition } from '../src/types/Position';

const TPY = 360;
const HOUR_MS = 3_600_000;

function gen(id: string, gender: Gender, ageYears: number, tickNow: number, parents: { fatherId?: string; motherId?: string } = {}): GenPerson {
    return {
        id, firstName: id, familyName: 'Fam', gender,
        birthTick: tickNow - ageYears * TPY, deathTick: null,
        fatherId: parents.fatherId ?? null, motherId: parents.motherId ?? null, partnerships: [],
    };
}

function makeGame(rows: number, cols: number): { field: Field; population: Population; economy: Economy; city: City } {
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
    return { field, population, economy, city };
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

function job(title: string): { title: string; salary: number; requirements: JobRequirements[]; shiftStart: number; shiftEnd: number } {
    return { title, salary: 1000, requirements: [JobRequirements.RetailSkill], shiftStart: 540, shiftEnd: 1020 };
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
