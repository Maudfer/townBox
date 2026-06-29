import Field from '../src/app/game/Field';
import House from '../src/app/game/House';
import City from '../src/app/game/City';
import Population from '../src/app/game/Population';
import Clock from '../src/app/game/Clock';
import EventEngine from '../src/app/game/EventEngine';
import HousingMarket from '../src/app/game/HousingMarket';
import GameManager from '../src/app/game/GameManager';
import Person from '../src/app/game/Person';

import { GenPerson, PersonId, PersonTable, PopulationState } from '../src/types/Genealogy';
import { HouseholdArrangements } from '../src/types/Household';
import { Genders, Gender } from '../src/types/Social';
import { PixelPosition, TilePosition } from '../src/types/Position';

const TPY = 360;
const HOUR_MS = 3_600_000;

function gen(id: string, gender: Gender, ageYears: number, tickNow: number, parents: { fatherId?: string; motherId?: string } = {}): GenPerson {
    return {
        id,
        firstName: id,
        familyName: 'Fam',
        gender,
        birthTick: tickNow - ageYears * TPY,
        deathTick: null,
        fatherId: parents.fatherId ?? null,
        motherId: parents.motherId ?? null,
        partnerships: [],
    };
}

// Marries a and b in the pool (mirrored partnerships), so spouseAt resolves the partner.
function wed(a: GenPerson, b: GenPerson, startTick: number): void {
    a.partnerships.push({ partnerId: b.id, startTick, endTick: null });
    b.partnerships.push({ partnerId: a.id, startTick, endTick: null });
}

function makeGame(rows: number, cols: number): { game: GameManager; field: Field; population: Population; clock: Clock; city: City } {
    const population = new Population();
    const clock = new Clock();
    const eventEngine = new EventEngine();
    const game = {
        field: null,
        population,
        clock,
        eventEngine,
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
    return { game, field, population, clock, city };
}

function loadState(population: Population, clock: Clock, people: PersonTable, placedIds: PersonId[], tickNow: number): void {
    const state: PopulationState = { worldSeed: 7, people, drawSeed: 0, placedIds, nextSeq: Object.keys(people).length, lastSimulatedYear: 0 };
    population.loadState(state);
    clock.setElapsedMs(tickNow * HOUR_MS);
}

function materialize(field: Field, house: House, id: string, x: number, y: number): Person {
    const person = field.loadPerson(x, y);
    person.social.setPersonId(id);
    person.social.setHome(house);
    house.addResident(person);
    house.addOccupant(person);
    return person;
}

describe('Newlywed cohabitation (task 023)', () => {
    test('a newly-married spouse (and their dependent minor) move into the larger household', () => {
        const tickNow = 40 * TPY;
        const { field, population, clock, city } = makeGame(40, 40);

        // A (with minor child C) lives alone-ish in a small household; B lives in a larger 3-person household.
        const a = gen('a', Genders.Female, 30, tickNow);
        const c = gen('c', Genders.Male, 6, tickNow, { motherId: 'a' });
        const b = gen('b', Genders.Male, 32, tickNow);
        const s1 = gen('s1', Genders.Male, 34, tickNow);
        const s2 = gen('s2', Genders.Female, 36, tickNow);
        wed(a, b, tickNow - TPY);
        loadState(population, clock, { a, c, b, s1, s2 }, ['a', 'c', 'b', 's1', 's2'], tickNow);

        // House 1 (smaller, 2 residents): A + minor C.
        const house1 = field.loadStructure('house', 4, 4, 'building_1x1x1_1') as House;
        const personA = materialize(field, house1, 'a', 72, 72);
        const personC = materialize(field, house1, 'c', 76, 72);
        house1.setHousehold({ id: 'hh-1', houseKey: house1.getIdentifier(), headId: 'a', memberIds: ['a', 'c'], arrangement: HouseholdArrangements.Nuclear });

        // House 2 (larger, 3 residents): B + two housemates.
        const house2 = field.loadStructure('house', 16, 16, 'building_1x1x1_1') as House;
        const personB = materialize(field, house2, 'b', 256, 256);
        materialize(field, house2, 's1', 260, 256);
        materialize(field, house2, 's2', 264, 256);
        house2.setHousehold({ id: 'hh-2', houseKey: house2.getIdentifier(), headId: 'b', memberIds: ['b', 's1', 's2'], arrangement: HouseholdArrangements.Roommates });

        city.resolveCohabitation('a', tickNow, TPY);

        // The smaller household (A + dependent minor C) moved into B's larger home.
        expect(personA.social.getHome()).toBe(house2);
        expect(personC.social.getHome()).toBe(house2);
        expect(personB.social.getHome()).toBe(house2); // B stayed put
        expect(house2.getResidents()).toEqual(expect.arrayContaining([personA, personB, personC]));
        expect(house2.getHousehold()!.memberIds).toEqual(expect.arrayContaining(['a', 'b', 'c']));

        // The vacated house is empty and no longer lists the movers.
        expect(house1.getResidents()).toHaveLength(0);
        expect(house1.getHousehold()!.memberIds).not.toContain('a');
    });

    test('does nothing when the partner is not materialized', () => {
        const tickNow = 40 * TPY;
        const { field, population, clock, city } = makeGame(40, 40);

        const a = gen('a', Genders.Female, 30, tickNow);
        const b = gen('b', Genders.Male, 32, tickNow); // exists in the pool but never materialized
        wed(a, b, tickNow - TPY);
        loadState(population, clock, { a, b }, ['a'], tickNow);

        const house1 = field.loadStructure('house', 4, 4, 'building_1x1x1_1') as House;
        const personA = materialize(field, house1, 'a', 72, 72);
        house1.setHousehold({ id: 'hh-1', houseKey: house1.getIdentifier(), headId: 'a', memberIds: ['a'], arrangement: HouseholdArrangements.Single });

        city.resolveCohabitation('a', tickNow, TPY);

        expect(personA.social.getHome()).toBe(house1); // unchanged
    });
});

describe('Adult-child move-out (task 024)', () => {
    test('an adult child relocates into a vacant house as a new single household', () => {
        const tickNow = 40 * TPY;
        const { field, population, clock, city } = makeGame(40, 40);

        const parent = gen('p', Genders.Female, 50, tickNow);
        const child = gen('ch', Genders.Male, 24, tickNow, { motherId: 'p' });
        loadState(population, clock, { p: parent, ch: child }, ['p', 'ch'], tickNow);

        // House 1: parent (head) + adult child. House 2: vacant.
        const house1 = field.loadStructure('house', 4, 4, 'building_1x1x1_1') as House;
        materialize(field, house1, 'p', 72, 72);
        const personChild = materialize(field, house1, 'ch', 76, 72);
        house1.setHousehold({ id: 'hh-1', houseKey: house1.getIdentifier(), headId: 'p', memberIds: ['p', 'ch'], arrangement: HouseholdArrangements.Nuclear });
        const house2 = field.loadStructure('house', 16, 16, 'building_1x1x1_1') as House;

        city.resolveMoveOut('ch', tickNow);

        // The child now heads a new single household in the formerly-vacant house.
        expect(personChild.social.getHome()).toBe(house2);
        expect(house2.getResidents()).toEqual([personChild]);
        const newHousehold = house2.getHousehold()!;
        expect(newHousehold.headId).toBe('ch');
        expect(newHousehold.memberIds).toEqual(['ch']);
        expect(newHousehold.arrangement).toBe(HouseholdArrangements.Single);

        // The parental household shrank and stays coherent.
        expect(house1.getResidents().map(r => r.social.getPersonId())).toEqual(['p']);
        expect(house1.getHousehold()!.memberIds).toEqual(['p']);
    });

    test('does nothing when no vacant house is available', () => {
        const tickNow = 40 * TPY;
        const { field, population, clock, city } = makeGame(40, 40);

        const parent = gen('p', Genders.Female, 50, tickNow);
        const child = gen('ch', Genders.Male, 24, tickNow, { motherId: 'p' });
        loadState(population, clock, { p: parent, ch: child }, ['p', 'ch'], tickNow);

        const house1 = field.loadStructure('house', 4, 4, 'building_1x1x1_1') as House;
        materialize(field, house1, 'p', 72, 72);
        const personChild = materialize(field, house1, 'ch', 76, 72);
        house1.setHousehold({ id: 'hh-1', houseKey: house1.getIdentifier(), headId: 'p', memberIds: ['p', 'ch'], arrangement: HouseholdArrangements.Nuclear });

        city.resolveMoveOut('ch', tickNow);

        expect(personChild.social.getHome()).toBe(house1); // stayed home
        expect(house1.getResidents()).toHaveLength(2);
    });
});

describe('HousingMarket.canMoveOut (task 024 eligibility)', () => {
    function makeFieldWith(vacant: boolean): { field: Field; byGenId: Map<PersonId, Person> } {
        const { field } = makeGame(40, 40);
        const house1 = field.loadStructure('house', 4, 4, 'building_1x1x1_1') as House;
        const parent = materialize(field, house1, 'p', 72, 72);
        const child = materialize(field, house1, 'ch', 76, 72);
        house1.setHousehold({ id: 'hh-1', houseKey: house1.getIdentifier(), headId: 'p', memberIds: ['p', 'ch'], arrangement: HouseholdArrangements.Nuclear });
        if (vacant) {
            field.loadStructure('house', 16, 16, 'building_1x1x1_1');
        }
        const byGenId = new Map<PersonId, Person>([['p', parent], ['ch', child]]);
        return { field, byGenId };
    }

    test('an adult non-head with a vacant home available can move out; the head cannot', () => {
        const { field, byGenId } = makeFieldWith(true);
        const market = new HousingMarket(byGenId, field);
        expect(market.canMoveOut('ch')).toBe(true);
        expect(market.canMoveOut('p')).toBe(false); // heads the household
    });

    test('nobody can move out when there is no vacant home', () => {
        const { field, byGenId } = makeFieldWith(false);
        const market = new HousingMarket(byGenId, field);
        expect(market.canMoveOut('ch')).toBe(false);
    });
});
