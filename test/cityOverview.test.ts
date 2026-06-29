import Field from '../src/app/game/Field';
import House from '../src/app/game/House';
import Workplace from '../src/app/game/Workplace';
import City from '../src/app/game/City';
import Population from '../src/app/game/Population';
import Clock from '../src/app/game/Clock';
import Economy from '../src/app/game/Economy';
import GameManager from '../src/app/game/GameManager';
import Person from '../src/app/game/Person';

import { GenPerson, PersonTable } from '../src/types/Genealogy';
import { HouseholdArrangements } from '../src/types/Household';
import { Genders, Gender } from '../src/types/Social';
import { JobRequirements } from '../src/types/Work';
import { PixelPosition, TilePosition } from '../src/types/Position';

function gen(id: string, gender: Gender): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender, birthTick: 0, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function makeGame(rows: number, cols: number): { field: Field; population: Population; economy: Economy; city: City } {
    const population = new Population();
    const clock = new Clock();
    const economy = new Economy();
    const game = {
        field: null, population, clock, economy,
        gridParams: { rows, cols, cells: { width: 16, height: 16 }, footprint: { tiles: 3, width: 48, height: 48 } },
        tileToPixelPosition: (p: TilePosition) => (p === null ? null : { x: p.col * 16 + 8, y: p.row * 16 + 8 }),
        pixelToTilePosition: (p: PixelPosition) => (p === null ? null : { row: Math.floor(p.y / 16), col: Math.floor(p.x / 16) }),
        emit: () => {}, emitSingle: () => {}, on: () => {}, toolbelt: {},
    } as unknown as GameManager;
    const field = new Field(game, rows, cols);
    (game as unknown as { field: Field }).field = field;
    const city = new City(game);
    return { field, population, economy, city };
}

function materialize(field: Field, house: House | null, id: string, age: number, x: number, y: number): Person {
    const person = field.loadPerson(x, y);
    person.social.setPersonId(id);
    person.social.setAge(age);
    if (house) {
        person.social.setHome(house);
        house.addResident(person);
        house.addOccupant(person);
    }
    return person;
}

describe('City.getCityStats (task 031)', () => {
    test('derives population, employment, business, economy, and homeless aggregates', () => {
        const { field, population, economy, city } = makeGame(40, 40);
        const table: PersonTable = { a: gen('a', Genders.Female), b: gen('b', Genders.Male), c: gen('c', Genders.Male), h: gen('h', Genders.Female) };
        population.loadState({ worldSeed: 1, people: table, drawSeed: 0, placedIds: [], nextSeq: 4, lastSimulatedYear: 0 });

        // House 1: adult A (employed) + minor C. House 2: adult B (unemployed, household in arrears).
        const house1 = field.loadStructure('house', 4, 4, 'building_1x1x1_1') as House;
        const personA = materialize(field, house1, 'a', 30, 72, 72);
        personA.work.setJob({ title: 'Clerk', salary: 1000, requirements: [JobRequirements.RetailSkill], shiftStart: 540, shiftEnd: 1020 });
        materialize(field, house1, 'c', 8, 76, 72);
        house1.setHousehold({ id: 'hh-1', houseKey: house1.getIdentifier(), headId: 'a', memberIds: ['a', 'c'], arrangement: HouseholdArrangements.Nuclear });

        const house2 = field.loadStructure('house', 16, 16, 'building_1x1x1_1') as House;
        materialize(field, house2, 'b', 40, 256, 256);
        house2.setHousehold({ id: 'hh-2', houseKey: house2.getIdentifier(), headId: 'b', memberIds: ['b'], arrangement: HouseholdArrangements.Single, arrears: 2 });

        // One operating business with an open position, and one vacant work building.
        const workplace = field.loadStructure('work', 10, 10, 'building_1x1x2_2') as Workplace;
        workplace.setBusiness({ blueprintKey: 'supermarket', name: 'Mart', lineOfWork: 'Super Market', size: 1, positions: [{ title: 'Clerk', salary: 1000, requirements: [JobRequirements.RetailSkill], shiftStart: 540, shiftEnd: 1020 }] });
        field.loadStructure('work', 22, 22, 'building_1x1x2_2'); // vacant

        economy.setPersonBalance('a', 1000);
        economy.setPersonBalance('b', 500);
        economy.setBusinessBalance(workplace.getIdentifier(), 8000);

        city.setHomelessHouseholds([{ id: 'homeless-x', houseKey: '', headId: 'h', memberIds: ['h'], arrangement: HouseholdArrangements.Homeless }]);

        const stats = city.getCityStats();

        expect(stats.population).toBe(3); // a, b, c materialized (h is homeless but not materialized here)
        expect(stats.households).toBe(2);
        expect(stats.avgHouseholdSize).toBeCloseTo(1.5); // (2 + 1) / 2
        expect(stats.employedAdults).toBe(1); // A
        expect(stats.unemployedAdults).toBe(1); // B (C is a minor)
        expect(stats.openPositions).toBe(1);
        expect(stats.businesses).toBe(1);
        expect(stats.vacantWorkBuildings).toBe(1);
        expect(stats.byLineOfWork).toEqual([{ line: 'Super Market', count: 1 }]);
        expect(stats.householdWealth).toBe(1500);
        expect(stats.businessBalance).toBe(8000);
        expect(stats.stressedHouseholds).toBe(1); // house2 in arrears
        expect(stats.homelessHouseholds).toBe(1);
        expect(stats.homelessPeople).toBe(1);
        expect(stats.poolSize).toBe(4);
        expect(stats.livingPool).toBe(4); // all alive
    });

    test('vital tallies start at zero', () => {
        const { city } = makeGame(20, 20);
        const stats = city.getCityStats();
        expect(stats.births).toBe(0);
        expect(stats.deaths).toBe(0);
        expect(stats.bankruptcies).toBe(0);
        expect(stats.evictions).toBe(0);
    });
});
