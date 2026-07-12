import City from 'game/City';
import Clock from 'game/Clock';
import GameManager from 'game/GameManager';
import EventEngine from 'game/events/EventEngine';
import Population from 'game/population/Population';
import Field from 'game/world/Field';
import House from 'game/world/House';
import { GenPerson, PersonTable, PopulationState } from 'types/Genealogy';
import { HouseholdArrangements } from 'types/Household';
import { PixelPosition, TilePosition } from 'types/Position';
import { Genders, Gender } from 'types/Social';

const TPY = 8640; // hour ticks (task 040)
const MS_PER_TICK = 150_000; // one hour tick of real time

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
        clock.setElapsedMs(tickNow * MS_PER_TICK);

        // House 1: guardian + minor (guardianship). House 2: the adult sibling (single).
        const house1 = field.loadStructure('house', 4, 4, 'building_1x1x1_1') as House;
        materialize(field, house1, 'guardian', 64, 64);
        const minorPerson = materialize(field, house1, 'minor', 68, 64);
        house1.setHousehold({ id: 'hh-1', houseKey: house1.getIdentifier(), headId: 'guardian', memberIds: ['guardian', 'minor'], arrangement: HouseholdArrangements.Guardianship });

        const house2 = field.loadStructure('house', 16, 16, 'building_1x1x1_1') as House;
        materialize(field, house2, 'sibling', 256, 256);
        house2.setHousehold({ id: 'hh-2', houseKey: house2.getIdentifier(), headId: 'sibling', memberIds: ['sibling'], arrangement: HouseholdArrangements.Single });
        city.setPopulation(3);

        // Honest hazards (048): extreme old age is a ~80/yr rate, not a per-tick certainty — advance until
        // the death lands (mean ~4.5 in-game days; bounded for safety).
        for (let tick = tickNow; tick < tickNow + 2000; tick++) {
            await city.handleTick({ tick, timestamp: clock.getTimestamp() });
            if (population.getPerson('guardian')!.deathTick !== null) {
                break;
            }
        }

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
