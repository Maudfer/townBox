import ActionEngine from 'game/actions/ActionEngine';
import Brain, { BrainDeps, JobFacts } from 'game/actions/Brain';
import City from 'game/City';
import Clock from 'game/Clock';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import CityIncidents, { INCIDENT_COLD_AFTER_TICKS } from 'game/economy/CityIncidents';
import DetentionRegistry from 'game/economy/DetentionRegistry';
import Economy from 'game/economy/Economy';
import { generateBusiness } from 'game/economy/BusinessGen';
import GameManager from 'game/GameManager';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import Population from 'game/population/Population';
import Field from 'game/world/Field';
import Workplace from 'game/world/Workplace';
import actionsConfig from 'json/actions.json';
import businessesConfig from 'json/businesses.json';
import economyConfig from 'json/economy.json';
import jobsConfig from 'json/jobs.json';
import { ActionManifest } from 'types/Action';
import { BusinessBlueprintTable, JobTable } from 'types/Business';
import { GenPerson } from 'types/Genealogy';
import { TickResult } from 'types/LifeEvent';
import { PixelPosition, TilePosition } from 'types/Position';
import { Genders } from 'types/Social';
import { JobPosition } from 'types/Work';

// Police, end to end (task 109): dispatch drives officers to open cases; a caught chase is a REAL arrest —
// the officer's act, the criminal's counterpart, the family fan-out, the ride texture, the escort to the
// facility; sentences scale with the record; the impunity loop teaches (got_away_with_it + the crime habit).

const TPY = 8640;
const HOUR_MS = 60 * 60 * 1000 / 24;
const TICK_NOW = 40 * TPY;
const ACTIONS = actionsConfig as unknown as ActionManifest;
const BLUEPRINTS = businessesConfig as unknown as BusinessBlueprintTable;
const JOBS = jobsConfig as unknown as JobTable;
const ECON = economyConfig as { detentionDays: number; detentionDaysRepeat: number };

function gen(id: string, opts: Partial<GenPerson> = {}): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: TICK_NOW - 30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [], ...opts };
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });

function makeGame() {
    const rows = 40;
    const cols = 40;
    const population = new Population();
    const clock = new Clock();
    const economy = new Economy();
    const eventEngine = new EventEngine();
    const incidents = new CityIncidents();
    const detention = new DetentionRegistry();
    const game = {
        field: null, population, clock, economy, eventEngine, incidents, detention,
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
        emit: () => {}, emitSingle: () => {}, on: () => {}, toolbelt: {},
    } as unknown as GameManager;
    const field = new Field(game, rows, cols);
    (game as unknown as { field: Field }).field = field;
    const city = new City(game);
    (game as unknown as { city: City }).city = city;
    return { game, field, population, clock, economy, city, eventEngine, incidents, detention };
}

describe('the arrest ceremony', () => {
    test('a caught chase logs both sides + family, rides to the facility, and convicts', () => {
        const world = makeGame();
        // The suspect is married with a child; the spouse and kid hear about the arrest.
        const people = {
            thief: gen('thief', { partnerships: [{ partnerId: 'spouse', startTick: TICK_NOW - 5 * TPY, endTick: null }] }),
            spouse: gen('spouse', { partnerships: [{ partnerId: 'thief', startTick: TICK_NOW - 5 * TPY, endTick: null }] }),
            kid: gen('kid', { birthTick: TICK_NOW - 10 * TPY, motherId: 'thief' }),
            officer: gen('officer'),
        };
        world.population.loadState({ worldSeed: 3, people, drawSeed: 0, placedIds: [], nextSeq: 10, lastSimulatedYear: 0 });
        world.clock.setElapsedMs(TICK_NOW * HOUR_MS);
        for (const id of ['thief', 'spouse', 'kid', 'officer']) {
            world.field.loadPerson(100, 100).social.setPersonId(id);
        }
        const officerPerson = world.field.getPeople().find(person => person.social.getPersonId() === 'officer')!;
        officerPerson.work.setJob({ title: 'Police Officer', salary: 0, requirements: [], shiftStart: 480, shiftEnd: 1020 } as JobPosition);
        const station = world.field.loadStructure('work', 10, 10, 'building_1x1x2_2') as Workplace;
        station.setBusiness(generateBusiness('police_station', BLUEPRINTS['police_station']!, JOBS, 'Precinct', 2));

        world.incidents.report('shoplifting', TICK_NOW, 'building:5-5', 'thief', 2);
        // The catch is PHYSICAL now (V10 / M6): the officer and the thief were loaded at the same tile
        // (100,100) — the same street cell — so the officer physically caught up. No dice roll.
        world.city.resolveChase('thief', TICK_NOW + 1, TPY);

        const thiefLog = world.eventEngine.getPersonLog('thief').filter(e => e.kind === 'event').map(e => e.defId);
        expect(thiefLog).toEqual(expect.arrayContaining(['was_arrested', 'got_a_ride', 'got_caught']));
        const officerLog = world.eventEngine.getPersonLog('officer').filter(e => e.kind === 'event').map(e => e.defId);
        expect(officerLog).toEqual(expect.arrayContaining(['arrested_suspect', 'offered_a_ride']));
        // Counterparts share causation: was_arrested chains to the officer's arrest commit.
        const arrestSeq = world.eventEngine.getPersonLog('officer').find(e => e.kind === 'event' && e.defId === 'arrested_suspect')!.seq;
        const wasArrested = world.eventEngine.getPersonLog('thief').find(e => e.kind === 'event' && e.defId === 'was_arrested')!;
        expect(wasArrested.causationId).toBe(arrestSeq);
        // The family heard.
        expect(world.eventEngine.getPersonLog('spouse').some(e => e.kind === 'event' && e.defId === 'relative_arrested')).toBe(true);
        expect(world.eventEngine.getPersonLog('kid').some(e => e.kind === 'event' && e.defId === 'relative_arrested')).toBe(true);
        // The case closed and the record landed.
        expect(world.incidents.isWanted('thief')).toBe(false);
    });

    test('a distant officer does NOT catch — the suspect gets away (physical, not a roll)', () => {
        const world = makeGame();
        const people = {
            thief: gen('thief'),
            officer: gen('officer'),
        };
        world.population.loadState({ worldSeed: 3, people, drawSeed: 0, placedIds: [], nextSeq: 10, lastSimulatedYear: 0 });
        world.clock.setElapsedMs(TICK_NOW * HOUR_MS);
        // The thief is here; the officer is far across town (a different outdoor cell) — outran, not caught.
        world.field.loadPerson(100, 100).social.setPersonId('thief');
        const officerPerson = world.field.loadPerson(1000, 1000);
        officerPerson.social.setPersonId('officer');
        officerPerson.work.setJob({ title: 'Police Officer', salary: 0, requirements: [], shiftStart: 480, shiftEnd: 1020 } as JobPosition);

        world.incidents.report('shoplifting', TICK_NOW, 'building:5-5', 'thief', 2);
        expect(world.incidents.isWanted('thief')).toBe(true);
        world.city.resolveChase('thief', TICK_NOW + 1, TPY);

        const thiefLog = world.eventEngine.getPersonLog('thief').filter(e => e.kind === 'event').map(e => e.defId);
        expect(thiefLog).toContain('evaded_the_police');
        expect(thiefLog).not.toContain('was_arrested'); // the officer never physically caught up
    });
});

describe('scaled sentences', () => {
    test('two priors serve the long stretch', () => {
        const world = makeGame();
        world.population.loadState({ worldSeed: 3, people: { thief: gen('thief') }, drawSeed: 0, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 });
        world.clock.setElapsedMs(TICK_NOW * HOUR_MS);
        world.field.loadPerson(100, 100).social.setPersonId('thief');
        const station = world.field.loadStructure('work', 10, 10, 'building_1x1x2_2') as Workplace;
        station.setBusiness(generateBusiness('police_station', BLUEPRINTS['police_station']!, JOBS, 'Precinct', 2));
        // Two priors already on the record.
        world.eventEngine.invoke(world.population.getState(), 'got_caught', 'thief', TICK_NOW - 100, TPY, { source: 'system', causationId: null });
        world.eventEngine.invoke(world.population.getState(), 'got_caught', 'thief', TICK_NOW - 50, TPY, { source: 'system', causationId: null });

        // The third conviction (driven through the public sweep).
        world.incidents.report('shoplifting', TICK_NOW, 'building:5-5', 'thief', 3);
        for (let day = 1; day <= 60 && world.incidents.isWanted('thief'); day++) {
            world.city.runPoliceWork(TICK_NOW + day * 24, TPY);
        }
        const record = world.detention.detentionOf('thief');
        expect(record).not.toBeNull();
        const servedDays = (record!.untilTick - TICK_NOW) / 24;
        expect(servedDays).toBeGreaterThanOrEqual(ECON.detentionDaysRepeat); // the long stretch, not the short one
    });
});

describe('impunity teaches', () => {
    test('a WITNESSED case going cold logs got_away_with_it; an unwitnessed one stays silent (the 099 contract)', () => {
        const world = makeGame();
        world.population.loadState({ worldSeed: 3, people: { sneak: gen('sneak'), ghost: gen('ghost') }, drawSeed: 0, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 });
        world.clock.setElapsedMs(TICK_NOW * HOUR_MS);
        world.field.loadPerson(100, 100).social.setPersonId('sneak');
        world.field.loadPerson(102, 100).social.setPersonId('ghost');
        world.incidents.report('pickpocketing', TICK_NOW, 'outside', 'sneak', 2); // seen — wanted, then the trail expires
        world.incidents.report('pickpocketing', TICK_NOW, 'outside', 'ghost', 0); // unseen — never in jeopardy
        world.city.runPoliceWork(TICK_NOW + INCIDENT_COLD_AFTER_TICKS + 25, TPY);
        expect(world.eventEngine.getPersonLog('sneak').some(e => e.kind === 'event' && e.defId === 'got_away_with_it')).toBe(true);
        expect(world.eventEngine.getPersonLog('ghost')).toHaveLength(0);
        // The escalation loop's fuel: crimes carry the habit key.
        expect(ACTIONS['shoplifting']!.habit).toBe('crime');
        expect(ACTIONS['pickpocketed_someone']!.habit).toBe('crime');
    });
});

describe('dispatch', () => {
    test('an on-duty officer with no suspect in sight drives to the oldest open case', () => {
        const incidents = new CityIncidents();
        incidents.report('shoplifting', 5, 'building:5-5', 'runner', 2);
        const engine = new EventEngine();
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const brain = new Brain(actions);
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const world = new BootstrapWorld(inventory);
        world.register('officer'); // the runner is NOT co-located (not even registered here)
        const OFFICER: JobFacts = {
            jobKey: 'police_officer', shiftStart: 8 * 60, shiftEnd: 17 * 60,
            daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'], workplaceKey: '9-9',
            continuousActions: [{ action: 'patrolling' }], discreteActions: [],
        };
        const people: Record<string, GenPerson> = { officer: gen('officer') };
        const deps: BrainDeps = {
            state: { worldSeed: 3, people, drawSeed: 1, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 },
            tick: TICK_NOW + 10, ticksPerYear: TPY,
            ctx: { mode: 'bootstrap', world, markets: { incidents } },
            eventEngine: engine, inventory, jobOf: () => OFFICER,
        };
        // Monday 10:00 equivalents: TICK_NOW is year-aligned, so tick 10-of-day on a weekday works out.
        brain.processTick(['officer'], deps, [], result());
        const active = actions.activeInstanceOf('officer');
        expect(active?.defId).toBe('responding_to_incident');
        expect(active?.locationOverride).toBe('building:5-5');
    });
});

describe('the jail visit (the planner producer)', () => {
    test('a spouse in custody gets a planned visit at the facility, target threaded for the counterpart', async () => {
        const AgendaModule = await import('game/actions/Agenda');
        const engine = new EventEngine();
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const brain = new Brain(actions);
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const world = new BootstrapWorld(inventory);
        world.register('visitor');
        world.register('inmate');
        const agenda = new AgendaModule.default();
        const people = {
            visitor: gen('visitor', { partnerships: [{ partnerId: 'inmate', startTick: TICK_NOW - 5 * TPY, endTick: null }] }),
            inmate: gen('inmate', { partnerships: [{ partnerId: 'visitor', startTick: TICK_NOW - 5 * TPY, endTick: null }] }),
        };
        const deps = (tick: number): BrainDeps => ({
            state: { worldSeed: 3, people, drawSeed: 1, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 },
            tick, ticksPerYear: TPY,
            ctx: { mode: 'bootstrap', world, markets: { agenda } },
            eventEngine: engine, inventory,
            detentionOf: id => (id === 'inmate' ? { locationKey: '9-9' } : null),
        });
        // Morning tick: the producer enqueues, and the due entry proposes at the facility with the target.
        const dayStart = TICK_NOW - (TICK_NOW % 24);
        brain.processTick(['visitor'], deps(dayStart + 8, ), [], result());
        let visiting = false;
        for (let hour = 9; hour <= 18 && !visiting; hour++) {
            actions.advance(deps(dayStart + hour)); // the runTick phases 1-2: instances complete before hooks
            brain.processTick(['visitor'], deps(dayStart + hour), [], result());
            const active = actions.activeInstanceOf('visitor');
            visiting = active?.defId === 'visiting_the_detained'
                && active.locationOverride === 'building:9-9'
                && active.params['target'] === 'inmate';
        }
        expect(visiting).toBe(true);
    });
});
