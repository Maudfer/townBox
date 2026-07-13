import BuildingConditions, { FIRE_CONFIG } from 'game/economy/BuildingConditions';
import City from 'game/City';
import Clock from 'game/Clock';
import EventEngine from 'game/events/EventEngine';
import CityIncidents from 'game/economy/CityIncidents';
import DetentionRegistry from 'game/economy/DetentionRegistry';
import Economy from 'game/economy/Economy';
import GameManager from 'game/GameManager';
import Population from 'game/population/Population';
import Field from 'game/world/Field';
import House from 'game/world/House';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { PixelPosition, TilePosition } from 'types/Position';
import { Genders } from 'types/Social';
import { JobPosition } from 'types/Work';
import { SeededRandom, hashStringToSeed } from 'util/random';

// Building condition & fire (task 102 / proposal H4): condition wears closed-form and takes damage in
// steps; derelict buildings ignite where kept-up ones don't (same seed, same day — the condition IS the
// difference); burning fires resolve after the response window with coverage-scaled outcomes; and a
// destroyed home leaves through the same coherent teardown bulldozing uses.

const TPY = 8640;
const HOUR_MS = 60 * 60 * 1000 / 24;
const TICK_NOW = 40 * TPY;
const WORLD_SEED = 6;

describe('the condition ledger', () => {
    test('unknown reads pristine; wear is closed-form; damage steps down to the floor; round-trip', () => {
        const conditions = new BuildingConditions();
        expect(conditions.conditionOf('5-5', 1000)).toBe(100);
        conditions.ensure('5-5', 1000);
        const later = 1000 + 200 * 24; // 200 days on
        expect(conditions.conditionOf('5-5', later)).toBeCloseTo(100 - FIRE_CONFIG.wearPerDay * 200, 6);
        conditions.damage('5-5', 500, later); // overkill clamps at the floor
        expect(conditions.conditionOf('5-5', later)).toBe(FIRE_CONFIG.conditionFloor);

        const restored = new BuildingConditions();
        restored.loadState(conditions.serialize());
        expect(restored.conditionOf('5-5', later)).toBe(FIRE_CONFIG.conditionFloor);
        restored.remove('5-5');
        expect(restored.conditionOf('5-5', later)).toBe(100);
        restored.loadState(undefined);
        expect(restored.serialize().buildings).toEqual({});
    });
});

function gen(id: string): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: TICK_NOW - 30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function makeGame() {
    const rows = 40;
    const cols = 40;
    const population = new Population();
    const clock = new Clock();
    const economy = new Economy();
    const eventEngine = new EventEngine();
    const incidents = new CityIncidents();
    const detention = new DetentionRegistry();
    const buildingConditions = new BuildingConditions();
    const game = {
        field: null,
        population,
        clock,
        economy,
        eventEngine,
        incidents,
        detention,
        buildingConditions,
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
    return { game, field, population, clock, economy, city, eventEngine, incidents, buildingConditions };
}

// The ignition roll is deterministic per (worldSeed, buildingKey, day): find a day whose roll lands under
// the DERELICT hazard but not under the PRISTINE one — condition is the difference, provably.
function ignitionDay(key: string): number {
    const floorHazard = 1 - Math.exp(-FIRE_CONFIG.ignitionPerYearAtFloor / 360);
    const pristineHazard = 1 - Math.exp(-FIRE_CONFIG.ignitionPerYearAtFullCondition / 360);
    for (let day = Math.floor(TICK_NOW / 24) + 1; day < Math.floor(TICK_NOW / 24) + 5000; day++) {
        const roll = new SeededRandom((WORLD_SEED ^ hashStringToSeed(`fire#${key}#${day}`)) >>> 0).next();
        if (roll < floorHazard && roll >= pristineHazard) {
            return day;
        }
    }
    throw new Error('no ignition day found');
}

describe('ignition & resolution', () => {
    test('a derelict home ignites where a kept-up one would not; the fire resolves after the window', () => {
        const world = makeGame();
        const state: PopulationState = { worldSeed: WORLD_SEED, people: { res: gen('res') }, drawSeed: 0, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 };
        world.population.loadState(state);
        world.clock.setElapsedMs(TICK_NOW * HOUR_MS);
        const house = world.field.loadStructure('house', 10, 10, 'house_1') as House;
        const key = house.getIdentifier();
        const day = ignitionDay(key);
        const sweepTick = day * 24;

        // Kept-up: the same day's roll does NOT ignite it.
        world.city.runFireHazard(sweepTick);
        expect(world.incidents.anyOpenFire()).toBe(false);

        // Derelict: damage to the floor → same day, same roll → ignition.
        world.buildingConditions.damage(key, 500, sweepTick - 1);
        world.city.runFireHazard(sweepTick);
        expect(world.incidents.openFireAt(`building:${key}`)).toBe(true);

        // Before the response window nothing resolves; after it, the outcome lands and the case closes.
        world.city.resolveFires(sweepTick + FIRE_CONFIG.responseTicks - 1);
        expect(world.incidents.anyOpenFire()).toBe(true);
        world.city.resolveFires(sweepTick + FIRE_CONFIG.responseTicks);
        expect(world.incidents.anyOpenFire()).toBe(false);
    });

    test('outcomes ride coverage: over many fires at measured-zero coverage, buildings burn down far more', () => {
        // Pure outcome-math check against the authored curve (the City roll uses the same formula):
        // neutral (unmeasured 0.5) → destroy 0.2 / extinguish 0.55; measured zero → destroy 0.45 / ext 0.25.
        const outcomes = (coverage: number): { extinguished: number; destroyed: number } => {
            let extinguished = 0;
            let destroyed = 0;
            for (let id = 1; id <= 300; id++) {
                const rng = new SeededRandom((WORLD_SEED ^ hashStringToSeed(`fireOutcome#${id}`)) >>> 0);
                const roll = rng.next(); // no lingerers in this sample — first draw is the outcome
                const extinguishChance = Math.min(0.92, 0.25 + 0.6 * coverage);
                const destroyChance = Math.max(0.05, 0.45 - 0.5 * coverage);
                if (roll < extinguishChance) {
                    extinguished++;
                } else if (roll < extinguishChance + destroyChance) {
                    destroyed++;
                }
            }
            return { extinguished, destroyed };
        };
        const uncovered = outcomes(0);
        const covered = outcomes(1);
        expect(covered.extinguished).toBeGreaterThan(uncovered.extinguished * 2);
        expect(uncovered.destroyed).toBeGreaterThan(covered.destroyed * 3);
    });

    test('arrival scales the response (task 110): unmeasured crew → coverage; a crew that never arrived → 0; on scene → full', () => {
        const world = makeGame();
        const state: PopulationState = { worldSeed: WORLD_SEED, people: { f1: gen('f1'), f2: gen('f2') }, drawSeed: 0, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 };
        world.population.loadState(state);
        world.clock.setElapsedMs(TICK_NOW * HOUR_MS);
        const house = world.field.loadStructure('house', 10, 10, 'house_1') as House;
        const key = house.getIdentifier();

        // No firefighters employed anywhere → arrival is unmeasured → pure coverage (the 102 behavior).
        expect(world.city.fireResponseAt(key)).toBe(0.5); // unmeasured coverage reads neutral

        // A crew exists but nobody physically made it → the ledger's coverage means nothing.
        const job = { title: 'Firefighter', salary: 0, requirements: [], shiftStart: 480, shiftEnd: 1020 } as JobPosition;
        const f1 = world.field.loadPerson(200, 200);
        f1.social.setPersonId('f1');
        f1.work.setJob(job);
        const f2 = world.field.loadPerson(220, 200);
        f2.social.setPersonId('f2');
        f2.work.setJob(job);
        expect(world.city.fireResponseAt(key)).toBe(0);

        // Half the crew on scene → half the factor; the full crew → pure coverage again.
        f1.setCurrentBuilding(house);
        expect(world.city.fireResponseAt(key)).toBeCloseTo(0.25, 6); // 0.5 coverage × 1/2 crew
        f2.setCurrentBuilding(house);
        expect(world.city.fireResponseAt(key)).toBeCloseTo(0.5, 6);
    });

    test('who physically arrived decides the outcome: same fire, same coverage — crew on scene saves the house (task 110)', () => {
        // Pick a fire id whose draws land: draw #1 (crew absent — no one inside, the outcome is the first
        // draw) DESTROYS at response 0 (∈ [0.25, 0.70)), while draw #3 (two crew inside consume two injury
        // draws first) EXTINGUISHES at response 0.5 (< 0.55).
        let fireId = 0;
        for (let id = 1; id < 2000; id++) {
            const rng = new SeededRandom((WORLD_SEED ^ hashStringToSeed(`fireOutcome#${id}`)) >>> 0);
            const first = rng.next();
            rng.next();
            const third = rng.next();
            if (first >= 0.25 && first < 0.70 && third < 0.55) {
                fireId = id;
                break;
            }
        }
        expect(fireId).toBeGreaterThan(0);

        const scenario = (crewOnScene: boolean): boolean => {
            const world = makeGame();
            const state: PopulationState = { worldSeed: WORLD_SEED, people: { f1: gen('f1'), f2: gen('f2') }, drawSeed: 0, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 };
            world.population.loadState(state);
            world.clock.setElapsedMs(TICK_NOW * HOUR_MS);
            const house = world.field.loadStructure('house', 10, 10, 'house_1') as House;
            const key = house.getIdentifier();
            const job = { title: 'Firefighter', salary: 0, requirements: [], shiftStart: 480, shiftEnd: 1020 } as JobPosition;
            for (const id of ['f1', 'f2']) {
                const fighter = world.field.loadPerson(200, 200);
                fighter.social.setPersonId(id);
                fighter.work.setJob(job);
                if (crewOnScene) {
                    fighter.setCurrentBuilding(house);
                }
            }
            for (let id = 1; id < fireId; id++) {
                const dummy = world.incidents.report('shoplifting', 0, 'outside', 'nobody', 0);
                world.incidents.resolve(dummy.id, 0);
            }
            world.incidents.report('fire', TICK_NOW, `building:${key}`, null, 0);
            world.city.resolveFires(TICK_NOW + FIRE_CONFIG.responseTicks);
            return world.field.getStructures().some(s => s instanceof House); // still standing?
        };

        expect(scenario(true)).toBe(true); // the crew made it — extinguished
        expect(scenario(false)).toBe(false); // same fire, same coverage, crew across town — burned down
    });

    test('a resident inside their OWN burning home rolls the injury die (the home-wart, closed — task 110)', () => {
        // locationOf reads 'home' for a resident in their own house, so the plain building query missed
        // them entirely under 102 — no evacuation, no injury, no stakes. Pick a fire id whose first draw
        // lands under the injury chance.
        let fireId = 0;
        for (let id = 1; id < 2000; id++) {
            const roll = new SeededRandom((WORLD_SEED ^ hashStringToSeed(`fireOutcome#${id}`)) >>> 0).next();
            if (roll < FIRE_CONFIG.injuryChancePerOccupant) {
                fireId = id;
                break;
            }
        }
        expect(fireId).toBeGreaterThan(0);

        const world = makeGame();
        const state: PopulationState = { worldSeed: WORLD_SEED, people: { res: gen('res') }, drawSeed: 0, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 };
        world.population.loadState(state);
        world.clock.setElapsedMs(TICK_NOW * HOUR_MS);
        const house = world.field.loadStructure('house', 10, 10, 'house_1') as House;
        const person = world.field.loadPerson(200, 200);
        person.social.setPersonId('res');
        person.social.setHome(house);
        house.addResident(person);
        person.setCurrentBuilding(house); // physically inside their own home

        for (let id = 1; id < fireId; id++) {
            const dummy = world.incidents.report('shoplifting', 0, 'outside', 'nobody', 0);
            world.incidents.resolve(dummy.id, 0);
        }
        world.incidents.report('fire', TICK_NOW, `building:${house.getIdentifier()}`, null, 0);
        world.city.resolveFires(TICK_NOW + FIRE_CONFIG.responseTicks);
        expect(world.eventEngine.getPersonLog('res').some(e => e.kind === 'event' && e.defId === 'injury')).toBe(true);
    });

    test('a destroyed home tears down coherently: lost_home_to_fire logged, the structure gone', () => {
        const world = makeGame();
        const state: PopulationState = { worldSeed: WORLD_SEED, people: { res: gen('res') }, drawSeed: 0, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 };
        world.population.loadState(state);
        world.clock.setElapsedMs(TICK_NOW * HOUR_MS);
        const house = world.field.loadStructure('house', 10, 10, 'house_1') as House;
        const key = house.getIdentifier();
        const person = world.field.loadPerson(200, 200);
        person.social.setPersonId('res');
        person.social.setHome(house);
        house.addResident(person);

        // Find a fire id whose outcome roll DESTROYS at neutral coverage (first draw in [0.55, 0.75)).
        let fireId = 0;
        for (let id = 1; id < 500; id++) {
            const roll = new SeededRandom((WORLD_SEED ^ hashStringToSeed(`fireOutcome#${id}`)) >>> 0).next();
            if (roll >= 0.55 && roll < 0.75) {
                fireId = id;
                break;
            }
        }
        expect(fireId).toBeGreaterThan(0);
        // Burn dummy incidents to line the registry's id counter up with the destroying id.
        for (let id = 1; id < fireId; id++) {
            const dummy = world.incidents.report('shoplifting', 0, 'outside', 'nobody', 0);
            world.incidents.resolve(dummy.id, 0);
        }
        world.incidents.report('fire', TICK_NOW, `building:${key}`, null, 0);

        world.city.resolveFires(TICK_NOW + FIRE_CONFIG.responseTicks);
        expect(world.eventEngine.getPersonLog('res').some(e => e.kind === 'event' && e.defId === 'lost_home_to_fire')).toBe(true);
        expect(world.field.getStructures().some(s => s instanceof House)).toBe(false); // burned to the ground
    });
});
