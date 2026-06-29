import Field from '../src/app/game/Field';
import House from '../src/app/game/House';
import City from '../src/app/game/City';
import Population from '../src/app/game/Population';
import Clock from '../src/app/game/Clock';
import Economy from '../src/app/game/Economy';
import EventEngine from '../src/app/game/EventEngine';
import SaveManager from '../src/app/game/save/SaveManager';
import GameManager from '../src/app/game/GameManager';
import Person from '../src/app/game/Person';

import { SaveProvider } from '../src/app/game/save/SaveProvider';
import { GenPerson, PersonId, PersonTable, PopulationState } from '../src/types/Genealogy';
import { HouseholdArrangements } from '../src/types/Household';
import { Genders, Gender } from '../src/types/Social';
import { PixelPosition, TilePosition } from '../src/types/Position';

const TPY = 360;
const HOUR_MS = 3_600_000;

class MemoryProvider implements SaveProvider {
    private store = new Map<string, string>();
    async save(slot: string, data: string): Promise<void> { this.store.set(slot, data); }
    async load(slot: string): Promise<string | null> { return this.store.get(slot) ?? null; }
    async list(): Promise<string[]> { return [...this.store.keys()]; }
    async delete(slot: string): Promise<void> { this.store.delete(slot); }
}

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

function makeGame(rows: number, cols: number): { game: GameManager; field: Field; population: Population; clock: Clock; economy: Economy; city: City } {
    const population = new Population();
    const clock = new Clock();
    const economy = new Economy();
    const eventEngine = new EventEngine();
    const game = {
        field: null,
        population,
        clock,
        economy,
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
    (game as unknown as { city: City }).city = city;
    return { game, field, population, clock, economy, city };
}

function loadState(population: Population, clock: Clock, people: PersonTable, placedIds: PersonId[], tickNow: number): void {
    const state: PopulationState = { worldSeed: 7, people, drawSeed: 0, placedIds, nextSeq: Object.keys(people).length, lastSimulatedYear: 0 };
    population.loadState(state);
    clock.setElapsedMs(tickNow * HOUR_MS);
}

function materialize(field: Field, house: House | null, id: string, x: number, y: number): Person {
    const person = field.loadPerson(x, y);
    person.social.setPersonId(id);
    if (house) {
        person.social.setHome(house);
        house.addResident(person);
        house.addOccupant(person);
    }
    return person;
}

describe('Household eviction (task 022)', () => {
    test('a household in arrears with no relative is evicted and becomes homeless', () => {
        const tickNow = 40 * TPY;
        const { field, population, clock, economy, city } = makeGame(40, 40);

        const a = gen('a', Genders.Female, 40, tickNow);
        loadState(population, clock, { a }, ['a'], tickNow);

        const house = field.loadStructure('house', 4, 4, 'building_1x1x1_1') as House;
        const personA = materialize(field, house, 'a', 72, 72);
        house.setHousehold({ id: 'hh-1', houseKey: house.getIdentifier(), headId: 'a', memberIds: ['a'], arrangement: HouseholdArrangements.Single, arrears: 3 });
        economy.setPersonBalance('a', 0); // broke → can't cover cost of living

        city.processMonthlyEconomy(0);

        expect(house.getHousehold()).toBeNull(); // dissolved
        expect(house.getResidents()).toHaveLength(0); // vacated
        expect(personA.social.getHome()).toBeNull(); // homeless
        expect(personA.isIndoors()).toBe(true); // hidden
        const homeless = city.getHomelessHouseholds();
        expect(homeless).toHaveLength(1);
        expect(homeless[0]!.memberIds).toEqual(['a']);
        expect(homeless[0]!.arrangement).toBe(HouseholdArrangements.Homeless);
    });

    test('an evicted member is taken in by a solvent relative instead of becoming homeless', () => {
        const tickNow = 40 * TPY;
        const { field, population, clock, economy, city } = makeGame(40, 40);

        const dad = gen('dad', Genders.Male, 80, tickNow);
        dad.deathTick = tickNow - 5 * TPY;
        const a = gen('a', Genders.Female, 40, tickNow, { fatherId: 'dad' });
        const sib = gen('sib', Genders.Male, 44, tickNow, { fatherId: 'dad' }); // adult sibling, solvent home
        loadState(population, clock, { dad, a, sib }, ['a', 'sib'], tickNow);

        const house1 = field.loadStructure('house', 4, 4, 'building_1x1x1_1') as House;
        const personA = materialize(field, house1, 'a', 72, 72);
        house1.setHousehold({ id: 'hh-1', houseKey: house1.getIdentifier(), headId: 'a', memberIds: ['a'], arrangement: HouseholdArrangements.Single, arrears: 3 });
        economy.setPersonBalance('a', 0);

        const house2 = field.loadStructure('house', 16, 16, 'building_1x1x1_1') as House;
        materialize(field, house2, 'sib', 256, 256);
        house2.setHousehold({ id: 'hh-2', houseKey: house2.getIdentifier(), headId: 'sib', memberIds: ['sib'], arrangement: HouseholdArrangements.Single, arrears: 0 });
        economy.setPersonBalance('sib', 50000); // solvent enough to absorb cost of living and take A in

        city.processMonthlyEconomy(0);

        expect(personA.social.getHome()).toBe(house2); // taken in by the sibling
        expect(house2.getHousehold()!.memberIds).toContain('a');
        expect(house1.getHousehold()).toBeNull(); // original household dissolved
        expect(house1.getResidents()).toHaveLength(0);
        expect(city.getHomelessHouseholds()).toHaveLength(0); // nobody left homeless
    });

    test('a homeless household with recovered funds occupies a vacant house', () => {
        const tickNow = 40 * TPY;
        const { field, population, clock, economy, city } = makeGame(40, 40);

        const a = gen('a', Genders.Female, 40, tickNow);
        loadState(population, clock, { a }, ['a'], tickNow);

        // A homeless person (materialized, no home) with recovered funds, and a vacant house to move into.
        const personA = materialize(field, null, 'a', 72, 72);
        personA.setIndoors(true);
        economy.setPersonBalance('a', 1000); // >= recoveryFunds (800)
        city.setHomelessHouseholds([{ id: 'homeless-1', houseKey: '', headId: 'a', memberIds: ['a'], arrangement: HouseholdArrangements.Homeless }]);
        const vacant = field.loadStructure('house', 8, 8, 'building_1x1x1_1') as House;

        city.processMonthlyEconomy(0);

        expect(personA.social.getHome()).toBe(vacant);
        expect(vacant.getResidents()).toContain(personA);
        expect(vacant.getHousehold()!.memberIds).toEqual(['a']);
        expect(city.getHomelessHouseholds()).toHaveLength(0);
    });

    test('homeless households round-trip through save/load', async () => {
        const provider = new MemoryProvider();
        const tickNow = 40 * TPY;

        const source = makeGame(20, 20);
        const a = gen('a', Genders.Female, 40, tickNow);
        loadState(source.population, source.clock, { a }, ['a'], tickNow);
        const personA = materialize(source.field, null, 'a', 72, 72); // homeless: no home
        personA.social.setFirstName('Ana');
        personA.setIndoors(true);
        source.economy.setPersonBalance('a', 100); // below recovery threshold so it stays homeless on load
        source.city.setName('Evictville');
        source.city.setHomelessHouseholds([{ id: 'homeless-1', houseKey: '', headId: 'a', memberIds: ['a'], arrangement: HouseholdArrangements.Homeless, arrears: 4 }]);

        await new SaveManager(source.game, provider).save('slot1');

        const restored = makeGame(20, 20);
        expect(await new SaveManager(restored.game, provider).load('slot1')).toBe(true);

        const homeless = restored.city.getHomelessHouseholds();
        expect(homeless).toHaveLength(1);
        expect(homeless[0]!.memberIds).toEqual(['a']);
        expect(homeless[0]!.arrangement).toBe(HouseholdArrangements.Homeless);

        const restoredPerson = restored.field.getPeople().find(p => p.social.getPersonId() === 'a');
        expect(restoredPerson).toBeDefined();
        expect(restoredPerson!.social.getHome()).toBeNull(); // still homeless
    });
});
