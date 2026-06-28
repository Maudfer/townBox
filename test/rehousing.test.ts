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

function materialize(field: Field, house: House, id: string, x: number, y: number) {
    const person = field.loadPerson(x, y);
    person.social.setPersonId(id);
    person.social.setHome(house);
    house.addResident(person);
    house.addOccupant(person);
    return person;
}

describe('City rehousing — orphaned minor relocation (task 011)', () => {
    test('a minor left alone when their guardian dies is moved to a living adult sibling\'s household', async () => {
        const tickNow = 50 * TPY;
        const { game, field, population, clock } = makeGame(30, 30);
        const city = new City(game);

        // Deceased parents; three sibling children. The guardian is ancient (certain death this day).
        const parents = { fatherId: 'dad', motherId: 'mom' };
        const dad = gen('dad', Genders.Male, 80, tickNow);
        dad.deathTick = tickNow - 5 * TPY;
        const mom = gen('mom', Genders.Female, 78, tickNow);
        mom.deathTick = tickNow - 5 * TPY;
        const guardian = gen('guardian', Genders.Male, 200, tickNow, parents); // dies of old age this day
        const minor = gen('minor', Genders.Male, 8, tickNow, parents);
        const sibling = gen('sibling', Genders.Male, 38, tickNow, parents); // adult sibling, lives elsewhere

        const people: PersonTable = { dad, mom, guardian, minor, sibling };
        const state: PopulationState = { worldSeed: 5, people, drawSeed: 0, placedIds: ['guardian', 'minor', 'sibling'], nextSeq: 5, lastSimulatedYear: 0 };
        population.loadState(state);
        clock.setElapsedMs(tickNow * HOUR_MS);

        // House 1: guardian + minor (guardianship). House 2: the adult sibling (single).
        const house1 = field.loadStructure('house', 4, 4, 'building_1x1x1_1') as House;
        materialize(field, house1, 'guardian', 64, 64);
        const minorPerson = materialize(field, house1, 'minor', 68, 64);
        house1.setHousehold({ id: 'hh-1', houseKey: house1.getIdentifier(), headId: 'guardian', memberIds: ['guardian', 'minor'], arrangement: HouseholdArrangements.Guardianship });

        const house2 = field.loadStructure('house', 16, 16, 'building_1x1x1_1') as House;
        materialize(field, house2, 'sibling', 256, 256);
        house2.setHousehold({ id: 'hh-2', houseKey: house2.getIdentifier(), headId: 'sibling', memberIds: ['sibling'], arrangement: HouseholdArrangements.Single });
        city.setPopulation(3);

        await city.handleNewDay({ tick: tickNow, timestamp: clock.getTimestamp() });

        // The guardian died; the minor was relocated to the sibling's household rather than left alone.
        expect(population.getPerson('guardian')!.deathTick).not.toBeNull();
        expect(field.getPeople().some(p => p.social.getPersonId() === 'guardian')).toBe(false);

        expect(minorPerson.social.getHome()).toBe(house2);
        expect(house2.getHousehold()!.memberIds).toContain('minor');
        expect(house2.getResidents()).toContain(minorPerson);

        expect(house1.getHousehold()!.memberIds).not.toContain('minor');
        expect(house1.getResidents()).not.toContain(minorPerson);
    });
});
