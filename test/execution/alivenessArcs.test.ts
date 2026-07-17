import ActionEngine from 'game/actions/ActionEngine';
import Brain, { BrainDeps } from 'game/actions/Brain';
import City from 'game/City';
import Clock from 'game/Clock';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import BuildingConditions, { FIRE_CONFIG } from 'game/economy/BuildingConditions';
import CityIncidents from 'game/economy/CityIncidents';
import DetentionRegistry from 'game/economy/DetentionRegistry';
import Economy from 'game/economy/Economy';
import GameManager from 'game/GameManager';
import Habits from 'game/population/Habits';
import Mood from 'game/population/Mood';
import Population from 'game/population/Population';
import Field from 'game/world/Field';
import House from 'game/world/House';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import economyConfig from 'json/economy.json';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { TickResult } from 'types/LifeEvent';
import { PixelPosition, TilePosition } from 'types/Position';
import { Genders } from 'types/Social';
import { HouseholdArrangements } from 'types/Household';
import { SeededRandom, hashStringToSeed } from 'util/random';

// The aliveness validation keystone (task 106 / proposal Part 6): the per-task suites prove each link;
// THIS suite runs the flagship cross-system CHAINS the whole arc exists for — the brief's own examples,
// emergent from data multipliers with zero scripting of the chain itself:
//   1. grief → coping → escalation (a death in the family raises drinking, which raises itself)
//   2. desperation → crime → conviction → detention → release (the justice loop end to end)
//   3. decay → fire → destruction → displacement (the survival showcase's aftermath)

const TPY = 8640;
const HOUR_MS = 60 * 60 * 1000 / 24;
const TICK_NOW = 40 * TPY;
const SENTENCE_TICKS = (economyConfig as { detentionDays: number }).detentionDays * 24;

function gen(id: string, ageYears = 30): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: TICK_NOW - ageYears * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });

describe('arc 1 — grief → coping → escalation (death → drinking, zero scripting)', () => {
    // Ten grieving people vs ten content twins, same seed: the grief impulse (became_widowed, valence −3)
    // drags mood for months; the vice weights read mood; commits practice the habit; the habit multiplies
    // the vice's own weight. Three data multipliers chain — nothing scripts "widows drink more".
    function eveningVicePicks(grieving: boolean): number {
        const engine = new EventEngine();
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const brain = new Brain(actions);
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const world = new BootstrapWorld(inventory);
        const mood = new Mood();
        const habits = new Habits();
        const ids = Array.from({ length: 10 }, (_, index) => `p${index}`);
        const people: Record<string, GenPerson> = {};
        for (const id of ids) {
            people[id] = gen(id, 45); // the grief milestones gate on age >= 40
            world.register(id);
        }
        const state: PopulationState = { worldSeed: 13, people, drawSeed: 1, placedIds: [], nextSeq: 50, lastSimulatedYear: 0 };
        if (grieving) {
            for (const id of ids) {
                // Compound grief — the real events, the real impulses (−3 each, months-long half-lives):
                // one loss leaves people sad-but-functional (62 − 18 = 44, above the coping gates — an
                // authored design fact); losing a spouse AND a parent drops them into coping territory.
                engine.invoke(state, 'became_widowed', id, TICK_NOW, TPY, { source: 'system', causationId: null }, {}, { markets: { mood } });
                engine.invoke(state, 'lost_parent', id, TICK_NOW, TPY, { source: 'system', causationId: null }, {}, { markets: { mood } });
            }
        }
        let vicePicks = 0;
        for (let day = 0; day < 60; day++) {
            const tick = TICK_NOW + day * 24 + 20; // evenings, inside both vices' windows
            const deps: BrainDeps = {
                state, tick, ticksPerYear: TPY,
                ctx: { mode: 'bootstrap', world, markets: { mood, habits } },
                eventEngine: engine, inventory,
            };
            for (const id of ids) {
                const pick = brain.selectFreeTimeAction(id, deps);
                if (pick === 'drank_alone' || pick === 'at_the_bar') {
                    vicePicks++;
                    habits.practice(id, 'drinking', tick); // the pick lands → the habit deepens (engine path proven in vices.test)
                }
            }
        }
        return vicePicks;
    }

    test('the grieving cohort reaches for the bottle decisively more than content twins', () => {
        const content = eveningVicePicks(false);
        const grieving = eveningVicePicks(true);
        expect(grieving).toBeGreaterThan(content * 1.5);
    });
});

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
    return { game, field, population, clock, economy, city, eventEngine, incidents, detention, buildingConditions };
}

describe('arc 2 — desperation → crime → conviction → detention → release', () => {
    test('the whole justice loop, end to end, on one seeded world', () => {
        const world = makeGame();
        const state: PopulationState = { worldSeed: 3, people: { thief: gen('thief') }, drawSeed: 0, placedIds: [], nextSeq: 10, lastSimulatedYear: 0 };
        world.population.loadState(state);
        world.clock.setElapsedMs(TICK_NOW * HOUR_MS);
        world.field.loadPerson(100, 100).social.setPersonId('thief');
        world.economy.adjustPerson('thief', 300);
        // A police station stands (staffing is the coverage ledger's concern; unmeasured reads neutral).
        const { generateBusiness } = await_import();
        const station = world.field.loadStructure('work', 10, 10, 'building_1x1x2_2');
        (station as import('game/world/Workplace').default).setBusiness(
            generateBusiness('police_station', BLUEPRINTS()['police_station']!, JOBS(), 'Precinct', 2));

        const convict = (fromTick: number): number => {
            // The REAL crime record first (the incident kind derives from the log), then the incident.
            world.eventEngine.invoke(world.population.getState(), 'committed_shoplifting', 'thief', fromTick, TPY, { source: 'system', causationId: null });
            world.incidents.report('shoplifting', fromTick, 'building:5-5', 'thief', 3);
            for (let day = 1; day <= 60; day++) {
                const tick = fromTick + day * 24;
                world.city.runPoliceWork(tick, TPY);
                if (!world.incidents.isWanted('thief')) {
                    return tick;
                }
            }
            throw new Error('never convicted');
        };

        // First offense: fined, free.
        const first = convict(TICK_NOW);
        expect(world.economy.getPersonBalance('thief')).toBeLessThan(300);
        expect(world.detention.isDetained('thief', first + 1)).toBe(false);

        // Repeat offense: detained at the station.
        const second = convict(first + 24);
        expect(world.detention.isDetained('thief', second + 1)).toBe(true);

        // Detention is LIVED: the Brain keeps them serving time at the facility.
        const engine = world.eventEngine;
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const brain = new Brain(actions);
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const bootstrap = new BootstrapWorld(inventory);
        bootstrap.register('thief');
        const deps: BrainDeps = {
            state: world.population.getState(), tick: second + 2, ticksPerYear: TPY,
            ctx: { mode: 'bootstrap', world: bootstrap },
            eventEngine: engine, inventory,
            detentionOf: id => (world.detention.isDetained(id, second + 2) ? world.detention.detentionOf(id) : null),
        };
        brain.processTick(['thief'], deps, [], result());
        expect(actions.activeInstanceOf('thief')?.defId).toBe('serving_time');

        // Time served: released, with the whole arc in one log — theft, capture, custody, freedom.
        world.city.runReleases(second + SENTENCE_TICKS);
        expect(world.detention.detentionOf('thief')).toBeNull();
        const logIds = engine.getPersonLog('thief').filter(e => e.kind === 'event').map(e => e.defId);
        expect(logIds).toEqual(expect.arrayContaining(['committed_shoplifting', 'got_caught', 'was_detained', 'released_from_jail']));
    });
});

describe('arc 3 — decay → fire → destruction → displacement', () => {
    test('a derelict home burns down and the resident loses everything, coherently', () => {
        const world = makeGame();
        const state: PopulationState = { worldSeed: 6, people: { res: gen('res') }, drawSeed: 0, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 };
        world.population.loadState(state);
        world.clock.setElapsedMs(TICK_NOW * HOUR_MS);
        const house = world.field.loadStructure('house', 10, 10, 'house_1') as House;
        const key = house.getIdentifier();
        const person = world.field.loadPerson(200, 200);
        person.social.setPersonId('res');
        person.social.setHome(house);
        house.addResident(person);
        // A real household record — displacement walks memberIds (the game sets this at draw time).
        house.setHousehold({ id: 'hh-' + key, houseKey: key, headId: 'res', memberIds: ['res'], arrangement: HouseholdArrangements.Single });

        // Neglect: the home decays to the floor; the ignition day is deterministic per (seed, key).
        world.buildingConditions.damage(key, 500, TICK_NOW);
        const floorHazard = 1 - Math.exp(-FIRE_CONFIG.ignitionPerYearAtFloor / 360);
        let igniteDay = 0;
        for (let day = Math.floor(TICK_NOW / 24) + 1; day < Math.floor(TICK_NOW / 24) + 5000; day++) {
            if (new SeededRandom((6 ^ hashStringToSeed(`fire#${key}#${day}`)) >>> 0).next() < floorHazard) {
                igniteDay = day;
                break;
            }
        }
        expect(igniteDay).toBeGreaterThan(0);
        world.city.runFireHazard(igniteDay * 24);
        expect(world.incidents.openFireAt(`building:${key}`)).toBe(true);

        // Force the DESTROYED outcome deterministically: burn incident ids until one's outcome roll lands
        // in the destroy band at neutral coverage (the same technique the fire suite pins).
        const fireIncident = world.incidents.open().find(i => i.kind === 'fire')!;
        let roll = new SeededRandom((6 ^ hashStringToSeed(`fireOutcome#${fireIncident.id}`)) >>> 0).next();
        while (!(roll >= 0.55 && roll < 0.75)) {
            // Re-file the fire under a fresh id whose roll destroys (deterministic id hunting).
            world.incidents.resolve(fireIncident.id, igniteDay * 24);
            const next = world.incidents.report('fire', igniteDay * 24, `building:${key}`, null, 0);
            roll = new SeededRandom((6 ^ hashStringToSeed(`fireOutcome#${next.id}`)) >>> 0).next();
            if (next.id > 400) {
                throw new Error('no destroying id found');
            }
        }

        world.city.resolveFires(igniteDay * 24 + FIRE_CONFIG.responseTicks);
        // The home is gone, the loss is on the record, and the displacement machinery took over.
        expect(world.field.getStructures().some(s => s instanceof House)).toBe(false);
        expect(world.eventEngine.getPersonLog('res').some(e => e.kind === 'event' && e.defId === 'lost_home_to_fire')).toBe(true);
        expect(person.social.getHome()).toBeNull(); // displaced — the homelessness machinery owns them now
    });
});

// Lazy imports for the heavier fixtures (keeps the harness header readable).
function await_import(): { generateBusiness: typeof import('game/economy/BusinessGen').generateBusiness } {
    return { generateBusiness: require('game/economy/BusinessGen').generateBusiness };
}
function BLUEPRINTS(): import('types/Business').BusinessBlueprintTable {
    return require('json/businesses.json');
}
function JOBS(): import('types/Business').JobTable {
    return require('json/jobs.json');
}
