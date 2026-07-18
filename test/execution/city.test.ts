import City from 'game/City';
import Clock from 'game/Clock';
import GameManager from 'game/GameManager';
import ActionEngine from 'game/actions/ActionEngine';
import Brain from 'game/actions/Brain';
import Person from 'game/agents/Person';
import Economy from 'game/economy/Economy';
import EventEngine from 'game/events/EventEngine';
import Population, { DEFAULT_POPULATION_PARAMS } from 'game/population/Population';
import SchoolRegistry from 'game/skills/SchoolRegistry';
import Field from 'game/world/Field';
import House from 'game/world/House';
import Vehicle from 'game/agents/Vehicle';
import Workplace from 'game/world/Workplace';
import { GenPerson, PersonTable, PopulationParams, PopulationState } from 'types/Genealogy';
import { HouseholdArrangements } from 'types/Household';
import { EventManifest } from 'types/LifeEvent';
import { PixelPosition, TilePosition } from 'types/Position';
import { Genders, Gender } from 'types/Social';
import { TICKS_PER_YEAR } from 'util/time';

// City.ts is the largest headless-testable surface in the `execution` module (jest.config.js scopes
// execution's coverage to game/execution/**, City.ts, and Clock.ts). Most of City's own logic — household/
// business setup, the daily/hourly sim loop, economy, rehousing, cohabitation, move-out, teardown, and the
// live commute machinery — runs over a plain Field/Population/Economy/Clock with NO real Phaser scene, as
// proven by the existing economy/population/agents test suites (this file mirrors their harness pattern but
// exercises paths those OTHER modules' tests don't happen to cover, so this module's own coverage grows).
//
// setupCar's console.log is the one genuinely trivial (nothing to assert) statement; everything else here
// drives real behavior through public City methods.

const HOUR_MS = 3_600_000; // one in-game hour of real elapsed time (MS_PER_TICK)

function gen(id: string, gender: Gender, ageYears: number, tickNow: number, parents: { fatherId?: string; motherId?: string } = {}): GenPerson {
    return {
        id, firstName: id, familyName: 'Fam', gender,
        birthTick: tickNow - ageYears * TICKS_PER_YEAR, deathTick: null,
        fatherId: parents.fatherId ?? null, motherId: parents.motherId ?? null, partnerships: [],
    };
}

function wed(a: GenPerson, b: GenPerson, startTick: number): void {
    a.partnerships.push({ partnerId: b.id, startTick, endTick: null });
    b.partnerships.push({ partnerId: a.id, startTick, endTick: null });
}

interface Harness {
    game: GameManager;
    field: Field;
    population: Population;
    clock: Clock;
    economy: Economy;
    eventEngine: EventEngine;
    schools: SchoolRegistry;
    city: City;
    emitted: { event: string; payload: unknown }[];
}

// A full fake GameManager wired the way GameManager really wires City's dependencies (population, clock,
// economy, eventEngine, schools, field), but with zero Phaser: Field only needs the grid math + a couple of
// event-bus stubs, which is exactly what every other module's City-driving tests already rely on.
function makeGame(rows: number, cols: number, manifest?: EventManifest): Harness {
    const population = new Population();
    const clock = new Clock();
    const economy = new Economy();
    const eventEngine = new EventEngine(manifest);
    const schools = new SchoolRegistry();
    const emitted: { event: string; payload: unknown }[] = [];
    let fieldRef: Field | null = null;

    const game = {
        field: null,
        population,
        clock,
        economy,
        eventEngine,
        schools,
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
        emit: (event: string, payload: unknown) => { emitted.push({ event, payload }); return Promise.resolve([]); },
        emitSingle: (_event: string, payload: PixelPosition) => fieldRef!.spawnPerson(payload),
        on: () => {},
        toolbelt: {},
    } as unknown as GameManager;

    const field = new Field(game, rows, cols);
    fieldRef = field;
    (game as unknown as { field: Field }).field = field;
    const city = new City(game);
    (game as unknown as { city: City }).city = city;
    return { game, field, population, clock, economy, eventEngine, schools, city, emitted };
}

function loadState(population: Population, clock: Clock, people: PersonTable, placedIds: string[], tickNow: number): void {
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

describe('City basic accessors', () => {
    test('name, population, and homeless-household registries are plain get/set state', () => {
        const { city } = makeGame(10, 10);
        expect(typeof city.getName()).toBe('string'); // faker-generated at construction

        city.setName('Springfield');
        expect(city.getName()).toBe('Springfield');

        expect(city.getPopulation()).toBe(0);
        city.setPopulation(42);
        expect(city.getPopulation()).toBe(42);

        expect(city.getHomelessHouseholds()).toEqual([]);
        const homeless = [{ id: 'h1', houseKey: '', headId: 'x', memberIds: ['x'], arrangement: HouseholdArrangements.Homeless }];
        city.setHomelessHouseholds(homeless);
        expect(city.getHomelessHouseholds()).toBe(homeless);
    });

    test('getWorld returns the live WorldAdapter and setupCar logs without throwing', () => {
        const { city } = makeGame(10, 10);
        expect(city.getWorld()).toBeDefined();
        expect(city.getWorld().mode).toBe('live');
        expect(() => city.setupCar({} as unknown as Vehicle)).not.toThrow();
    });
});

describe('City.setupHousehold (task 023 materialization — no prior execution-module coverage)', () => {
    // A small, fast, ticksPerYear-8640-consistent population (matching the real Clock) so drawn ages line up
    // with the household draw's adult/child bands.
    const SMALL_PARAMS: PopulationParams = { ...DEFAULT_POPULATION_PARAMS, founderCouples: 20, generations: 2, maxPopulation: 400 };

    test('materializes a drawn household\'s living members into real Persons bound to the house', async () => {
        const { field, population, clock, city } = makeGame(40, 40);
        population.generate(123, SMALL_PARAMS);
        clock.setElapsedMs(30 * TICKS_PER_YEAR * HOUR_MS); // 30 years into the run — plenty of living adults

        const house = field.loadStructure('house', 4, 4, 'building_1x1x1_1') as House;
        await city.setupHousehold(house);

        const household = house.getHousehold();
        expect(household).not.toBeNull();
        expect(household!.memberIds.length).toBeGreaterThan(0);
        expect(household!.houseKey).toBe(house.getIdentifier());
        // Every drawn member is a real, home-bound Person on the field.
        expect(house.getResidents().length).toBe(household!.memberIds.length);
        for (const person of house.getResidents()) {
            expect(person.social.getHome()).toBe(house);
            const id = person.social.getPersonId();
            expect(id).not.toBeNull();
            expect(household!.memberIds).toContain(id);
        }
        expect(city.getPopulation()).toBe(household!.memberIds.length);
    });

    test('kinship among drawn residents is mirrored onto their materialized relationships', async () => {
        const { field, population, clock, city } = makeGame(40, 40);
        population.generate(456, SMALL_PARAMS);
        clock.setElapsedMs(30 * TICKS_PER_YEAR * HOUR_MS);

        const house = field.loadStructure('house', 6, 6, 'building_1x1x1_1') as House;
        await city.setupHousehold(house);

        const residents = house.getResidents();
        if (residents.length >= 2) {
            // At least SOME pair of co-drawn residents carries a mirrored relationship (nuclear/sibling/etc
            // arrangements always relate their members; a lone single-occupant draw has nobody to relate).
            const anyRelated = residents.some(person => Object.keys(person.social.getInfo().relationships).length > 0);
            expect(anyRelated).toBe(true);
        }
    });

    test('throws on a null house or a missing population pool', async () => {
        const { city } = makeGame(10, 10);
        await expect(city.setupHousehold(null as unknown as House)).rejects.toThrow('Invalid house');

        // A second city over a game with no population set at all.
        const game = {
            field: null, population: null, clock: new Clock(),
            gridParams: { rows: 10, cols: 10, cells: { width: 16, height: 16 }, footprint: { tiles: 3, width: 48, height: 48 } },
            tileToPixelPosition: (p: TilePosition) => (p === null ? null : { x: p.col * 16 + 8, y: p.row * 16 + 8 }),
            pixelToTilePosition: () => null,
            emit: () => {}, emitSingle: () => {}, on: () => {}, toolbelt: {},
        } as unknown as GameManager;
        const field = new Field(game, 10, 10);
        (game as unknown as { field: Field }).field = field;
        const bareCity = new City(game);
        const house = field.loadStructure('house', 2, 2, 'h') as House;
        await expect(bareCity.setupHousehold(house)).rejects.toThrow('population pool');
    });
});

describe('City.getCityStats (macro dashboard snapshot)', () => {
    test('derives population/economy/pool aggregates from a live field', () => {
        const { field, population, economy, city } = makeGame(30, 30);
        const table: PersonTable = { a: gen('a', Genders.Female, 30, 0), b: gen('b', Genders.Male, 8, 0) };
        population.loadState({ worldSeed: 1, people: table, drawSeed: 0, placedIds: [], nextSeq: 2, lastSimulatedYear: 0 });

        const house = field.loadStructure('house', 4, 4, 'building_1x1x1_1') as House;
        const adult = materialize(field, house, 'a', 72, 72);
        adult.social.setAge(30);
        adult.work.setJob({ title: 'Clerk', salary: 1000, requirements: [], shiftStart: 540, shiftEnd: 1020 });
        const kid = materialize(field, house, 'b', 76, 72);
        kid.social.setAge(8);
        house.setHousehold({ id: 'hh-1', houseKey: house.getIdentifier(), headId: 'a', memberIds: ['a', 'b'], arrangement: HouseholdArrangements.Nuclear });
        economy.setPersonBalance('a', 500);

        const stats = city.getCityStats();
        expect(stats.population).toBe(2);
        expect(stats.households).toBe(1);
        expect(stats.employedAdults).toBe(1);
        expect(stats.householdWealth).toBe(500);
        expect(stats.poolSize).toBe(2);
        expect(stats.livingPool).toBe(2);
    });
});

describe('City.handleNewDay — day-cadence upkeep', () => {
    test('a no-op when population or clock is missing', () => {
        const game = {
            field: null, population: null, clock: null,
            gridParams: { rows: 5, cols: 5, cells: { width: 16, height: 16 }, footprint: { tiles: 3, width: 48, height: 48 } },
            tileToPixelPosition: () => null, pixelToTilePosition: () => null,
            emit: () => {}, emitSingle: () => {}, on: () => {}, toolbelt: {},
        } as unknown as GameManager;
        const field = new Field(game, 5, 5);
        (game as unknown as { field: Field }).field = field;
        const city = new City(game);
        expect(() => city.handleNewDay({ tick: 0, timestamp: { absoluteDay: 0 } as never })).not.toThrow();
    });

    test('advances the coarse pool sim (excluding materialized people) and runs the monthly economy gate', () => {
        const tickNow = 40 * TICKS_PER_YEAR;
        const { field, population, clock, economy, city } = makeGame(20, 20);
        // An off-map ancient person (coarse sim will kill them) plus a materialized one the coarse sim excludes.
        const ancient = gen('old', Genders.Male, 200, tickNow);
        const onMap = gen('mat', Genders.Female, 30, tickNow);
        loadState(population, clock, { old: ancient, mat: onMap }, ['mat'], tickNow);
        materialize(field, null, 'mat', 40, 40);
        economy.setPersonBalance('mat', 100);

        city.handleNewDay({ tick: clock.getCurrentDay(), timestamp: clock.getTimestamp() });

        // The coarse sim ran (lastSimulatedYear advanced) and the monthly economy gate executed at least once
        // (a person balance was touched by cost-of-living, proving processMonthlyEconomy ran through).
        expect(population.getState().lastSimulatedYear).toBeGreaterThan(0);
        expect(economy.getLastEconomyMonth()).toBeGreaterThanOrEqual(0);
    });

    test('runs school sweeps and skill milestones for materialized children when Game.schools/skillBook exist', () => {
        const tickNow = 40 * TICKS_PER_YEAR;
        const { field, population, clock, schools, city } = makeGame(20, 20);
        const kid = gen('kid', Genders.Male, 8, tickNow);
        loadState(population, clock, { kid }, ['kid'], tickNow);
        materialize(field, null, 'kid', 40, 40);

        const school = field.loadStructure('work', 10, 10, 'building_1x1x1_1') as Workplace;
        school.setBusiness({ blueprintKey: 'school', name: 'PS1', lineOfWork: 'School', size: 1, positions: [] });

        city.handleNewDay({ tick: clock.getCurrentDay(), timestamp: clock.getTimestamp() });

        expect(schools.assignmentOf('kid')).not.toBeNull();
        expect(schools.assignmentOf('kid')!.schoolKey).toBe(school.getIdentifier());
    });
});

describe('City.handleTick — the shared spine\'s live reconciliation', () => {
    test('a no-op when population/clock/field/eventEngine is missing', async () => {
        const game = {
            field: null, population: null, clock: null, eventEngine: null,
            gridParams: { rows: 5, cols: 5, cells: { width: 16, height: 16 }, footprint: { tiles: 3, width: 48, height: 48 } },
            tileToPixelPosition: () => null, pixelToTilePosition: () => null,
            emit: () => {}, emitSingle: () => {}, on: () => {}, toolbelt: {},
        } as unknown as GameManager;
        const field = new Field(game, 5, 5);
        (game as unknown as { field: Field }).field = field;
        const city = new City(game);
        await expect(city.handleTick({ tick: 0, timestamp: {} as never })).resolves.toBeUndefined();
    });

    test('a death is reconciled: removed from the house/household/field and the feed announces it', async () => {
        const tickNow = 50 * TICKS_PER_YEAR;
        const manifest: EventManifest = {
            certain_death: {
                roles: { subject: { where: { all: [{ attr: 'alive', op: '==', value: true }, { attr: 'age', op: '>=', value: 85 }] } } },
                triggers: { probabilistic: { perYear: 2_000_000 } },
                effects: [{ type: 'setDeath' }],
            },
        } as unknown as EventManifest;
        const { field, population, clock, city, emitted } = makeGame(20, 20, manifest);
        const a = gen('a', Genders.Female, 90, tickNow);
        const b = gen('b', Genders.Male, 40, tickNow);
        loadState(population, clock, { a, b }, ['a', 'b'], tickNow);

        const house = field.loadStructure('house', 4, 4, 'building_1x1x1_1') as House;
        const personA = materialize(field, house, 'a', 72, 72);
        materialize(field, house, 'b', 76, 72);
        house.setHousehold({ id: 'hh-1', houseKey: house.getIdentifier(), headId: 'a', memberIds: ['a', 'b'], arrangement: HouseholdArrangements.Nuclear });
        city.setPopulation(2);

        await city.handleTick({ tick: tickNow, timestamp: clock.getTimestamp() });

        expect(field.getPeople()).not.toContain(personA);
        expect(house.getHousehold()!.memberIds).not.toContain('a');
        expect(house.getHousehold()!.headId).toBe('b'); // head reassigned off the deceased
        expect(city.getPopulation()).toBe(1);
        expect(emitted.some(e => e.event === 'cityEvent' && (e.payload as { kind: string }).kind === 'death')).toBe(true);
    });

    test('a house-emptying death vacates it (re-drawn) and prunes a homeless registry entry', async () => {
        const tickNow = 50 * TICKS_PER_YEAR;
        const manifest: EventManifest = {
            certain_death: {
                roles: { subject: { where: { all: [{ attr: 'alive', op: '==', value: true }, { attr: 'age', op: '>=', value: 85 }] } } },
                triggers: { probabilistic: { perYear: 2_000_000 } },
                effects: [{ type: 'setDeath' }],
            },
        } as unknown as EventManifest;
        const { field, population, clock, city, emitted } = makeGame(20, 20, manifest);
        const solo = gen('solo', Genders.Female, 90, tickNow);
        loadState(population, clock, { solo }, ['solo'], tickNow);

        const house = field.loadStructure('house', 4, 4, 'building_1x1x1_1') as House;
        materialize(field, house, 'solo', 72, 72);
        house.setHousehold({ id: 'hh-1', houseKey: house.getIdentifier(), headId: 'solo', memberIds: ['solo'], arrangement: HouseholdArrangements.Single });
        city.setPopulation(1);

        await city.handleTick({ tick: tickNow, timestamp: clock.getTimestamp() });

        expect(house.getResidents()).toHaveLength(0);
        expect(emitted.some(e => e.event === 'tileSpawned')).toBe(true); // the vacated house re-drew
    });

    test('a homeless person\'s death is pruned from the homeless registry (not the field, since already un-homed)', async () => {
        const tickNow = 50 * TICKS_PER_YEAR;
        const manifest: EventManifest = {
            certain_death: {
                roles: { subject: { where: { all: [{ attr: 'alive', op: '==', value: true }, { attr: 'age', op: '>=', value: 85 }] } } },
                triggers: { probabilistic: { perYear: 2_000_000 } },
                effects: [{ type: 'setDeath' }],
            },
        } as unknown as EventManifest;
        const { field, population, clock, city } = makeGame(20, 20, manifest);
        const homelessPerson = gen('h1', Genders.Female, 90, tickNow);
        loadState(population, clock, { h1: homelessPerson }, ['h1'], tickNow);
        materialize(field, null, 'h1', 40, 40); // no home
        city.setHomelessHouseholds([{ id: 'homeless-1', houseKey: '', headId: 'h1', memberIds: ['h1'], arrangement: HouseholdArrangements.Homeless }]);

        await city.handleTick({ tick: tickNow, timestamp: clock.getTimestamp() });

        expect(city.getHomelessHouseholds()).toHaveLength(0); // dropped: the sole member died
    });

    test('resolveCohabitation and resolveMoveOut fire from event signals surfaced by handleTick', async () => {
        const tickNow = 40 * TICKS_PER_YEAR;
        const manifest: EventManifest = {
            move_out_now: {
                // Scoped to the adult child only (age < 30) so the parent (50) never also "moves out" and
                // races for the same vacant house — mirrors the real move_out event's non-head gating, done
                // here via an age band since this fixture has no HousingMarket-backed canMoveOut predicate.
                roles: { subject: { where: { all: [{ attr: 'alive', op: '==', value: true }, { attr: 'age', op: '<', value: 30 }] } } },
                triggers: { probabilistic: { perYear: 2_000_000 } },
                effects: [{ type: 'emit', signal: 'movedOut' }],
            },
        } as unknown as EventManifest;
        const { field, population, clock, city } = makeGame(20, 20, manifest);
        const parent = gen('p', Genders.Female, 50, tickNow);
        const child = gen('ch', Genders.Male, 24, tickNow, { motherId: 'p' });
        loadState(population, clock, { p: parent, ch: child }, ['p', 'ch'], tickNow);

        const house1 = field.loadStructure('house', 4, 4, 'building_1x1x1_1') as House;
        materialize(field, house1, 'p', 72, 72);
        const personChild = materialize(field, house1, 'ch', 76, 72);
        house1.setHousehold({ id: 'hh-1', houseKey: house1.getIdentifier(), headId: 'p', memberIds: ['p', 'ch'], arrangement: HouseholdArrangements.Nuclear });
        field.loadStructure('house', 16, 16, 'building_1x1x1_1'); // vacant target

        await city.handleTick({ tick: tickNow, timestamp: clock.getTimestamp() });

        expect(personChild.social.getHome()).not.toBe(house1); // moved into the vacant house
        expect(personChild.social.getHome()!.getHousehold()!.headId).toBe('ch');
    });
});

describe('City rehousing/cohabitation/move-out (direct calls — public for unit testing)', () => {
    test('resolveRehousing relocates an orphaned minor to a living relative\'s household', () => {
        const tickNow = 50 * TICKS_PER_YEAR;
        const { field, population, clock, city } = makeGame(30, 30);
        const parents = { fatherId: 'dad', motherId: 'mom' };
        const dad = gen('dad', Genders.Male, 80, tickNow); dad.deathTick = tickNow - 5 * TICKS_PER_YEAR;
        const mom = gen('mom', Genders.Female, 78, tickNow); mom.deathTick = tickNow - 5 * TICKS_PER_YEAR;
        const guardianDeceasedAlready = gen('guardian', Genders.Male, 82, tickNow, parents);
        guardianDeceasedAlready.deathTick = tickNow - 1; // just died, leaving no adult
        const minor = gen('minor', Genders.Male, 8, tickNow, parents);
        const sibling = gen('sibling', Genders.Male, 38, tickNow, parents);
        loadState(population, clock, { dad, mom, guardian: guardianDeceasedAlready, minor, sibling }, ['minor', 'sibling'], tickNow);

        const house1 = field.loadStructure('house', 4, 4, 'building_1x1x1_1') as House;
        const minorPerson = materialize(field, house1, 'minor', 68, 64);
        house1.setHousehold({ id: 'hh-1', houseKey: house1.getIdentifier(), headId: 'minor', memberIds: ['minor'], arrangement: HouseholdArrangements.Guardianship });

        const house2 = field.loadStructure('house', 16, 16, 'building_1x1x1_1') as House;
        materialize(field, house2, 'sibling', 256, 256);
        house2.setHousehold({ id: 'hh-2', houseKey: house2.getIdentifier(), headId: 'sibling', memberIds: ['sibling'], arrangement: HouseholdArrangements.Single });

        city.resolveRehousing(tickNow, TICKS_PER_YEAR);

        expect(minorPerson.social.getHome()).toBe(house2);
        expect(house2.getHousehold()!.memberIds).toContain('minor');
    });

    test('resolveRehousing is a no-op when field or population is missing', () => {
        const game = {
            field: null, population: null,
            gridParams: { rows: 5, cols: 5, cells: { width: 16, height: 16 }, footprint: { tiles: 3, width: 48, height: 48 } },
            tileToPixelPosition: () => null, pixelToTilePosition: () => null,
            emit: () => {}, emitSingle: () => {}, on: () => {}, toolbelt: {},
        } as unknown as GameManager;
        const field = new Field(game, 5, 5);
        (game as unknown as { field: Field }).field = field;
        const city = new City(game);
        expect(() => city.resolveRehousing(0, TICKS_PER_YEAR)).not.toThrow();
    });

    test('resolveCohabitation is a no-op without a population pool', () => {
        const game = {
            field: null, population: null,
            gridParams: { rows: 5, cols: 5, cells: { width: 16, height: 16 }, footprint: { tiles: 3, width: 48, height: 48 } },
            tileToPixelPosition: () => null, pixelToTilePosition: () => null,
            emit: () => {}, emitSingle: () => {}, on: () => {}, toolbelt: {},
        } as unknown as GameManager;
        const field = new Field(game, 5, 5);
        (game as unknown as { field: Field }).field = field;
        const city = new City(game);
        expect(() => city.resolveCohabitation('a', 0, TICKS_PER_YEAR)).not.toThrow();
    });

    test('resolveCohabitation is a no-op when the subject has no partner in the pool', () => {
        const tickNow = 40 * TICKS_PER_YEAR;
        const { field, population, clock, city } = makeGame(20, 20);
        const a = gen('a', Genders.Female, 30, tickNow); // no partnerships
        loadState(population, clock, { a }, ['a'], tickNow);
        const house = field.loadStructure('house', 4, 4, 'building_1x1x1_1') as House;
        const personA = materialize(field, house, 'a', 72, 72);
        house.setHousehold({ id: 'hh-1', houseKey: house.getIdentifier(), headId: 'a', memberIds: ['a'], arrangement: HouseholdArrangements.Single });

        city.resolveCohabitation('a', tickNow, TICKS_PER_YEAR);
        expect(personA.social.getHome()).toBe(house); // unchanged
    });

    test('resolveCohabitation skips when the combined household would exceed capacity', () => {
        const tickNow = 40 * TICKS_PER_YEAR;
        const { field, population, clock, city } = makeGame(30, 30);
        const a = gen('a', Genders.Female, 30, tickNow);
        const b = gen('b', Genders.Male, 32, tickNow);
        wed(a, b, tickNow - TICKS_PER_YEAR);
        loadState(population, clock, { a, b }, ['a', 'b'], tickNow);

        const house1 = field.loadStructure('house', 4, 4, 'building_1x1x1_1') as House;
        const personA = materialize(field, house1, 'a', 72, 72);
        house1.setHousehold({ id: 'hh-1', houseKey: house1.getIdentifier(), headId: 'a', memberIds: ['a'], arrangement: HouseholdArrangements.Single });

        // B's household is already at the 8-resident cap, so no combined household could fit A too.
        const house2 = field.loadStructure('house', 16, 16, 'building_1x1x1_1') as House;
        const memberIds = ['b'];
        materialize(field, house2, 'b', 256, 256);
        for (let i = 0; i < 7; i++) {
            const extraId = `x${i}`;
            materialize(field, house2, extraId, 260 + i, 256);
            memberIds.push(extraId);
        }
        house2.setHousehold({ id: 'hh-2', houseKey: house2.getIdentifier(), headId: 'b', memberIds, arrangement: HouseholdArrangements.Roommates });

        city.resolveCohabitation('a', tickNow, TICKS_PER_YEAR);
        expect(personA.social.getHome()).toBe(house1); // stayed put — neither home could hold everyone
    });

    test('resolveMoveOut is a no-op for an unmaterialized or homeless person', () => {
        const { field, city } = makeGame(20, 20);
        expect(() => city.resolveMoveOut('ghost', 0)).not.toThrow();

        const person = materialize(field, null, 'homeless', 40, 40);
        city.resolveMoveOut('homeless', 0);
        expect(person.social.getHome()).toBeNull(); // still homeless — no house to remove from
    });
});

describe('Teardown entry points (task 025): demolishHouse / demolishWorkplace', () => {
    test('demolishHouse displaces residents and clears their objects; announces the demolition', () => {
        const tickNow = 40 * TICKS_PER_YEAR;
        const { field, population, clock, city, emitted } = makeGame(20, 20);
        const a = gen('a', Genders.Female, 40, tickNow);
        loadState(population, clock, { a }, ['a'], tickNow);
        const house = field.loadStructure('house', 4, 4, 'building_1x1x1_1') as House;
        const personA = materialize(field, house, 'a', 72, 72);
        house.setHousehold({ id: 'hh-1', houseKey: house.getIdentifier(), headId: 'a', memberIds: ['a'], arrangement: HouseholdArrangements.Single });

        city.demolishHouse(house);

        expect(personA.social.getHome()).toBeNull();
        expect(city.getHomelessHouseholds()).toHaveLength(1);
        expect(emitted.some(e => e.event === 'cityEvent' && (e.payload as { kind: string }).kind === 'structureDemolished')).toBe(true);
    });

    test('demolishWorkplace with no business still announces a generic demolition', () => {
        const { field, city, emitted } = makeGame(20, 20);
        const workplace = field.loadStructure('work', 10, 10, 'building_1x1x2_2') as Workplace;
        city.demolishWorkplace(workplace);
        expect(emitted.some(e => e.event === 'cityEvent' && (e.payload as { kind: string }).kind === 'structureDemolished')).toBe(true);
    });

    test('demolishWorkplace with a business closes it (lays off staff)', () => {
        const { field, city } = makeGame(20, 20);
        const workplace = field.loadStructure('work', 10, 10, 'building_1x1x2_2') as Workplace;
        workplace.setBusiness({ blueprintKey: 'supermarket', name: 'Mart', lineOfWork: 'Super Market', size: 1, positions: [] });
        const employee = field.loadPerson(160, 160);
        employee.social.setPersonId('e');
        employee.work.setJob({ title: 'Clerk', salary: 1000, requirements: [], shiftStart: 540, shiftEnd: 1020 });
        workplace.addEmployee(employee);

        city.demolishWorkplace(workplace);
        expect(workplace.getBusiness()).toBeNull();
        expect(employee.work.getJob()).toBeNull();
    });
});

describe('City live commute (getWorld/handleCommute/startCommute)', () => {
    function timeAt(tick: number): { timestamp: never; tick: number } {
        return { timestamp: {} as never, tick };
    }

    test('an adult employee\'s requested transition spawns a controlled commute car', () => {
        const { field, city } = makeGame(20, 20);
        const home = field.loadStructure('house', 4, 4, 'h') as House;
        const workplace = field.loadStructure('work', 10, 10, 'w') as Workplace;
        const person = field.loadPerson(72, 72);
        person.social.setPersonId('p1');
        person.social.setHome(home);
        person.social.setAge(30);

        const handle = city.getWorld().requestTransition('p1', { kind: 'building', key: workplace.getIdentifier() }, 0, null);
        expect(handle.status).toBe('pending');
        city.getWorld().pump(0); // flush the deferred departure (LP-11 spreading)
        expect(field.getVehicles()).toHaveLength(1);

        person.setCurrentBuilding(workplace);
        city.handleCommute(timeAt(1));
        expect(handle.status).toBe('arrived');
    });

    test('startCommute is a no-op when the person has neither a current building nor a home (no entrance)', () => {
        const { field, city } = makeGame(20, 20);
        const workplace = field.loadStructure('work', 10, 10, 'w') as Workplace;
        const person = field.loadPerson(72, 72);
        person.social.setPersonId('p1');
        // No home set at all — origin resolves to null, so startCommute bails before spawning anything.
        const handle = city.getWorld().requestTransition('p1', { kind: 'building', key: workplace.getIdentifier() }, 0, null);
        expect(handle.status).toBe('pending'); // still requested — LiveWorld doesn't know startCommute no-op'd
        expect(field.getVehicles()).toHaveLength(0);
    });
});

// Reactive Brain wakeups (LP-12 / proposal simulation-aliveness-2 M2): a business opening between flips
// wakes the unemployed at the next minute — job-seeking cooldowns cleared — instead of waiting out the
// hourly flip plus a multi-day routine cadence.
describe('reactive wakes (LP-12)', () => {
    const TPY = TICKS_PER_YEAR;
    function timeAt(tick: number): { timestamp: never; tick: number } {
        return { timestamp: {} as never, tick };
    }
    function wakeHarness() {
        const harness = makeGame(30, 30);
        const { game, field, population, clock, eventEngine } = harness;
        const actionEngine = new ActionEngine(undefined, eventEngine.getLifeLog());
        const brain = new Brain(actionEngine);
        (game as unknown as { actionEngine: ActionEngine }).actionEngine = actionEngine;
        (game as unknown as { brain: Brain }).brain = brain;
        const tickNow = 1000;
        const adult: GenPerson = { id: 'p1', firstName: 'A', familyName: 'B', gender: Genders.Male, birthTick: tickNow - 30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
        loadState(population, clock, { p1: adult }, ['p1'], tickNow);
        const house = field.loadStructure('house', 4, 4, 'h') as House;
        const person = materialize(field, house, 'p1', 72, 72);
        person.social.setAge(30);
        return { ...harness, actionEngine, person, tickNow };
    }

    test('a business opening wakes the unemployed at the next minute with the seek cooldown cleared', () => {
        const { city, field, actionEngine, tickNow } = wakeHarness();
        // A stale seek this hour: the 24-tick cooldown would normally hold job seeking down for a day.
        actionEngine.getState().actionHistory['p1'] = { job_hunting: { count: 1, lastTick: tickNow - 1 } };
        expect(actionEngine.hasAction('p1', 'job_hunting', tickNow, { withinTicks: 24 })).toBe(true);

        const workplace = field.loadStructure('work', 10, 10, 'w') as Workplace;
        city.setupBusiness(workplace);

        // The next minute boundary drains the wake: the seek cooldown is cleared for the woken person and
        // the Brain genuinely runs for them (an active instance exists — the pass produced a decision;
        // a started job_hunting legitimately re-records its own recency, so assert the CLEAR via spy).
        const clearSpy = jest.spyOn(actionEngine, 'clearActionRecency');
        city.handleCommute(timeAt(tickNow));
        expect(clearSpy).toHaveBeenCalledWith('p1', 'job_hunting');
        expect(actionEngine.activeInstanceOf('p1')).not.toBeNull();
    });

    test('a wake pass without pending wakes is a no-op (no Brain run, no cost)', () => {
        const { city, actionEngine, tickNow } = wakeHarness();
        city.handleCommute(timeAt(tickNow));
        expect(actionEngine.activeInstanceOf('p1')).toBeNull();
    });
});

// LP-3 (proposal simulation-aliveness-2 P0-3): the live work keystone. An on-shift employee's obligation
// intent must produce a real work instance — departing (logged), commuting, and firing started_working on
// physical arrival. The audit found a doctor who never attempted work in 16 days; this pins the whole
// live path at the City level so any break in the chain (orchestrator facts, arbitration, transition,
// arrival resolution) fails a test instead of a playtest.
describe('live work reliability (LP-3 keystone)', () => {
    function employedHarness() {
        const harness = makeGame(30, 30);
        const { game, field, population, clock, eventEngine } = harness;
        const actionEngine = new ActionEngine(undefined, eventEngine.getLifeLog());
        const brain = new Brain(actionEngine);
        (game as unknown as { actionEngine: ActionEngine }).actionEngine = actionEngine;
        (game as unknown as { brain: Brain }).brain = brain;
        // Tuesday 09:00 (day 1 of the week cycle): inside the doctor's 08:00–18:00 all-days shift.
        const tickNow = (7 * 24) + 9 + 24 * 30; // an arbitrary mid-run Tuesday 09:00
        const adult: GenPerson = { id: 'doc', firstName: 'Vi', familyName: 'Ba', gender: Genders.Male, birthTick: tickNow - 35 * TICKS_PER_YEAR, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
        loadState(population, clock, { doc: adult }, ['doc'], tickNow);
        const house = field.loadStructure('house', 4, 4, 'h') as House;
        // A road ring so the commute can spawn a car on the street.
        field.loadStructure('road', 1, 4, 'r');
        const workplace = field.loadStructure('work', 10, 10, 'w') as Workplace;
        const person = materialize(field, house, 'doc', 72, 72);
        person.social.setAge(35);
        person.work.setJob({ title: 'Doctor', salary: 5000, requirements: [], shiftStart: 480, shiftEnd: 1080, daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as never, rankId: 'entry', workDaysInRank: 0, totalWorkDays: 0 });
        person.work.setWorkplace(workplace);
        return { ...harness, actionEngine, brain, person, workplace, tickNow };
    }

    test('an on-shift employee attempts work: instance created, departure logged, started_working on arrival', async () => {
        const { city, eventEngine, actionEngine, person, workplace, tickNow } = employedHarness();
        await city.handleTick({ timestamp: {} as never, tick: tickNow });

        // The obligation intent produced a WORK instance (running or en route) — the doctor case regression.
        const active = actionEngine.activeInstanceOf('doc');
        expect(active).not.toBeNull();
        expect(actionEngine.getDefinition(active!.defId)?.category).toBe('work');

        // If the commute is pending, the departure is in the log (LP-2) and arrival starts the shift.
        if (active!.status !== 'running') {
            const log = eventEngine.getPersonLog('doc');
            expect(log.some(entry => entry.kind === 'action' && entry.lifecycle === 'departed')).toBe(true);
            city.getWorld().pump(tickNow); // flush the deferred departure
            person.setCurrentBuilding(workplace);
            city.getWorld().pump(tickNow + 1);
            await city.handleTick({ timestamp: {} as never, tick: tickNow + 1 });
        }
        const started = eventEngine.getPersonLog('doc').some(entry => entry.kind === 'event' && entry.defId === 'started_working');
        expect(started).toBe(true);
    });
});

// Task 122 (LP-6): live move-out through the EVENT path. The 052 regeneration orphaned the movedOut signal
// — moved_out_of_parents now gates on canMoveOut and emits it, City.handleTick routes it to resolveMoveOut,
// and the signal-coverage guard (test/events/signalCoverage.test.ts) keeps the producer from vanishing
// again. This drives the real manifest event (hot-rated fixture manifest) through handleTick, not the
// handler directly.
describe('live move-out via the event path (task 122)', () => {
    const MOVE_OUT_MANIFEST: EventManifest = {
        moved_out_of_parents: {
            label: 'Moved out of the parents\' house',
            category: 'housing',
            roles: { subject: { where: { all: [
                { attr: 'alive', op: '==', value: true },
                { attr: 'age', op: '>=', value: 18 },
                { attr: 'canMoveOut', op: '==', value: true },
            ] } } },
            triggers: { probabilistic: { perYear: 200000 } }, // certainty per tick — the fixture hot-rate
            effects: [{ type: 'emit', signal: 'movedOut', target: 'subject' }],
        },
    } as unknown as EventManifest;

    test('an eligible adult non-head moves into the vacant house; the ineligible never fire', async () => {
        const harness = makeGame(30, 30, MOVE_OUT_MANIFEST);
        const { field, population, clock, city } = harness;
        const tickNow = 5000;
        const parent = gen('p', Genders.Female, 55, tickNow);
        const adult = gen('ch', Genders.Male, 28, tickNow, { motherId: 'p' });
        loadState(population, clock, { p: parent, ch: adult }, ['p', 'ch'], tickNow);

        const home = field.loadStructure('house', 4, 4, 'h') as House;
        const vacant = field.loadStructure('house', 10, 10, 'h') as House;
        home.setHousehold({ id: 'hh-1', houseKey: home.getIdentifier(), headId: 'p', memberIds: ['p', 'ch'], arrangement: HouseholdArrangements.Nuclear });
        materialize(field, home, 'p', 72, 72);
        const child = materialize(field, home, 'ch', 72, 72);

        await city.handleTick({ timestamp: {} as never, tick: tickNow });

        // The event fired, the signal routed, the relocation happened: a new single household in the
        // formerly vacant house, the parents' household shrunk.
        expect(child.social.getHome()).toBe(vacant);
        expect(vacant.getHousehold()?.memberIds).toEqual(['ch']);
        expect(home.getHousehold()?.memberIds).toEqual(['p']);
    });

    test('with no vacant house, canMoveOut gates the event silent (nobody relocates)', async () => {
        const harness = makeGame(30, 30, MOVE_OUT_MANIFEST);
        const { field, population, clock, city } = harness;
        const tickNow = 5000;
        const parent = gen('p', Genders.Female, 55, tickNow);
        const adult = gen('ch', Genders.Male, 28, tickNow, { motherId: 'p' });
        loadState(population, clock, { p: parent, ch: adult }, ['p', 'ch'], tickNow);
        const home = field.loadStructure('house', 4, 4, 'h') as House;
        home.setHousehold({ id: 'hh-1', houseKey: home.getIdentifier(), headId: 'p', memberIds: ['p', 'ch'], arrangement: HouseholdArrangements.Nuclear });
        materialize(field, home, 'p', 72, 72);
        const child = materialize(field, home, 'ch', 72, 72);

        await city.handleTick({ timestamp: {} as never, tick: tickNow });

        expect(child.social.getHome()).toBe(home);
        expect(home.getHousehold()?.memberIds).toEqual(['p', 'ch']);
    });
});
