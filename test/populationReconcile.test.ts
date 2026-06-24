import Field from '../src/app/game/Field';
import House from '../src/app/game/House';
import City from '../src/app/game/City';
import Population from '../src/app/game/Population';
import Clock from '../src/app/game/Clock';
import GameManager from '../src/app/game/GameManager';

import { GenPerson, PersonTable, PopulationState } from '../src/types/Genealogy';
import { HouseholdArrangements } from '../src/types/Household';
import { Genders, Gender } from '../src/types/Social';
import { PixelPosition, TilePosition } from '../src/types/Position';

const TPY = 360;
const HOUR_MS = 3_600_000;

function person(id: string, gender: Gender, ageYears: number, tickNow: number): GenPerson {
    return {
        id,
        firstName: id,
        familyName: 'Fam',
        gender,
        birthTick: tickNow - ageYears * TPY,
        deathTick: null,
        fatherId: null,
        motherId: null,
        partnerships: [],
    };
}

function makeGame(rows: number, cols: number): { game: GameManager; field: Field; population: Population; clock: Clock } {
    const population = new Population();
    const clock = new Clock();
    const game = {
        field: null,
        population,
        clock,
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
    return { game, field, population, clock };
}

describe('City.handleNewDay — death reconciliation', () => {
    test('a resident who dies is removed from the field, house, household, and population count', () => {
        const tickNow = 1 * TPY; // one year in
        const { game, field, population, clock } = makeGame(15, 15);
        const city = new City(game);

        // Pool: an ancient (certain death at the cap) and a child (effectively immortal this year).
        const ancient = person('old', Genders.Male, 200, tickNow);
        const child = person('kid', Genders.Female, 5, tickNow);
        const people: PersonTable = { old: ancient, kid: child };
        const state: PopulationState = { worldSeed: 4, people, drawSeed: 1, placedIds: ['old', 'kid'], nextSeq: 2, lastSimulatedYear: 0 };
        population.loadState(state);

        clock.setElapsedMs(tickNow * HOUR_MS);

        // Materialize both into a house.
        const house = field.loadStructure('house', 4, 4, 'building_1x1x1_1') as House;
        const oldPerson = field.loadPerson(72, 72);
        oldPerson.social.setPersonId('old');
        oldPerson.social.setHome(house);
        house.addResident(oldPerson);
        house.addOccupant(oldPerson);

        const childPerson = field.loadPerson(76, 72);
        childPerson.social.setPersonId('kid');
        childPerson.social.setHome(house);
        house.addResident(childPerson);
        house.addOccupant(childPerson);

        house.setHousehold({
            id: 'hh-4-4',
            houseKey: house.getIdentifier(),
            headId: 'old',
            memberIds: ['old', 'kid'],
            arrangement: HouseholdArrangements.Guardianship,
        });
        city.setPopulation(2);

        city.handleNewDay({ tick: tickNow, timestamp: clock.getTimestamp() });

        // The ancient died and was fully removed; the child remains.
        expect(population.getPerson('old')!.deathTick).not.toBeNull();
        expect(field.getPeople()).toContain(childPerson);
        expect(field.getPeople()).not.toContain(oldPerson);
        expect(house.getResidents()).toEqual([childPerson]);

        const household = house.getHousehold()!;
        expect(household.memberIds).toEqual(['kid']);
        expect(household.headId).toBe('kid'); // head reassigned away from the deceased
        expect(city.getPopulation()).toBe(1);
    });
});
