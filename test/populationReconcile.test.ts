import Field from '../src/app/game/Field';
import House from '../src/app/game/House';
import City from '../src/app/game/City';
import Population from '../src/app/game/Population';
import Clock from '../src/app/game/Clock';
import EventEngine from '../src/app/game/EventEngine';
import GameManager from '../src/app/game/GameManager';

import { GenPerson, PersonTable, PopulationState } from '../src/types/Genealogy';
import { HouseholdArrangements } from '../src/types/Household';
import { Genders, Gender } from '../src/types/Social';
import { PixelPosition, TilePosition } from '../src/types/Position';

const TPY = 8640; // hour ticks (task 040)
const MS_PER_TICK = 150_000; // one hour tick of real time

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
    return { game, field, population, clock };
}

describe('City.handleTick — death reconciliation', () => {
    test('a resident who dies is removed from the field, house, household, and population count', async () => {
        const tickNow = 1 * TPY; // one year in
        const { game, field, population, clock } = makeGame(15, 15);
        const city = new City(game);

        // Pool: an ancient (certain death at the cap) and a child (effectively immortal this year).
        const ancient = person('old', Genders.Male, 200, tickNow);
        const child = person('kid', Genders.Female, 5, tickNow);
        const people: PersonTable = { old: ancient, kid: child };
        const state: PopulationState = { worldSeed: 4, people, drawSeed: 1, placedIds: ['old', 'kid'], nextSeq: 2, lastSimulatedYear: 0 };
        population.loadState(state);

        clock.setElapsedMs(tickNow * MS_PER_TICK);

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

        // Honest hazards (048): extreme old age is a ~80/yr rate, not a per-tick certainty — advance until
        // the death lands (mean ~4.5 in-game days; bounded for safety).
        for (let tick = tickNow; tick < tickNow + 2000; tick++) {
            await city.handleTick({ tick, timestamp: clock.getTimestamp() });
            if (population.getPerson('old')!.deathTick !== null) {
                break;
            }
        }

        // The ancient died (via the event engine) and was fully removed; the child remains.
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
