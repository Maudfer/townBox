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
import { EventManifest } from '../src/types/LifeEvent';
import { PixelPosition, TilePosition } from '../src/types/Position';

const TPY = 360;
const HOUR_MS = 3_600_000;

// A manifest that guarantees a birth: had_sex fires (perYear huge), satisfying pregnancy the same day.
const BIRTH_MANIFEST: EventManifest = {
    had_sex: { roles: { subject: { where: { attr: 'alive', op: '==', value: true } } }, probability: { perYear: 1000 }, effects: [] },
    pregnancy: {
        roles: {
            subject: { where: { all: [
                { attr: 'alive', op: '==', value: true },
                { attr: 'gender', op: '==', value: 'female' },
                { attr: 'age', op: '>=', value: 18 },
                { hasEvent: 'had_sex', withinDays: 280 },
                { not: { hasEvent: 'pregnancy', withinDays: 300 } },
            ] } },
            father: { bind: 'partnerOf:subject' },
        },
        probability: { perYear: 1000 },
        effects: [{ type: 'birth', mother: 'subject', father: 'father' }],
    },
};

function gen(id: string, gender: Gender, ageYears: number, tickNow: number): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender, birthTick: tickNow - ageYears * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function makeGame(rows: number, cols: number, manifest: EventManifest): { game: GameManager; field: Field; population: Population; clock: Clock } {
    const population = new Population();
    const clock = new Clock();
    const eventEngine = new EventEngine(manifest);
    let fieldRef: Field | null = null;

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
        // Materialization goes through emitSingle("personSpawnRequest"); route it to the real field.
        emitSingle: (_event: string, payload: PixelPosition) => fieldRef!.spawnPerson(payload),
        on: () => {},
        toolbelt: {},
    } as unknown as GameManager;

    const field = new Field(game, rows, cols);
    fieldRef = field;
    (game as unknown as { field: Field }).field = field;
    return { game, field, population, clock };
}

describe('City.handleNewDay — birth materialization', () => {
    test('a newborn is materialized into the mother\'s house and joins the household', async () => {
        const tickNow = 10 * TPY;
        const { game, field, population, clock } = makeGame(20, 20, BIRTH_MANIFEST);
        const city = new City(game);

        const mother = gen('mom', Genders.Female, 30, tickNow);
        const father = gen('dad', Genders.Male, 32, tickNow);
        mother.partnerships.push({ partnerId: 'dad', startTick: tickNow - 5 * TPY, endTick: null });
        father.partnerships.push({ partnerId: 'mom', startTick: tickNow - 5 * TPY, endTick: null });
        const people: PersonTable = { mom: mother, dad: father };
        const state: PopulationState = { worldSeed: 11, people, drawSeed: 0, placedIds: ['mom', 'dad'], nextSeq: 2, lastSimulatedYear: 0 };
        population.loadState(state);
        clock.setElapsedMs(tickNow * HOUR_MS);

        const house = field.loadStructure('house', 7, 7, 'building_1x1x1_1') as House;
        const momPerson = field.loadPerson(112, 112);
        momPerson.social.setPersonId('mom');
        momPerson.social.setHome(house);
        house.addResident(momPerson);
        const dadPerson = field.loadPerson(116, 112);
        dadPerson.social.setPersonId('dad');
        dadPerson.social.setHome(house);
        house.addResident(dadPerson);
        house.setHousehold({ id: 'hh-7-7', houseKey: house.getIdentifier(), headId: 'mom', memberIds: ['mom', 'dad'], arrangement: HouseholdArrangements.Nuclear });
        city.setPopulation(2);

        const before = field.getPeople().length;
        await city.handleNewDay({ tick: tickNow, timestamp: clock.getTimestamp() });

        // A child was appended to the pool and materialized into the house.
        expect(Object.keys(population.getPeople()).length).toBe(3);
        expect(field.getPeople().length).toBe(before + 1);

        const childId = Object.keys(population.getPeople()).find(id => id !== 'mom' && id !== 'dad')!;
        const child = population.getPerson(childId)!;
        expect(child.motherId).toBe('mom');
        expect(child.fatherId).toBe('dad');
        expect(child.birthTick).toBe(tickNow);

        expect(house.getHousehold()!.memberIds).toContain(childId);
        expect(house.getResidents().some(resident => resident.social.getPersonId() === childId)).toBe(true);
        expect(city.getPopulation()).toBe(3);
    });
});
