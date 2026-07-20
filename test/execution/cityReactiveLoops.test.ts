import City from 'game/City';
import Clock from 'game/Clock';
import EventEngine from 'game/events/EventEngine';
import CityIncidents, { INCIDENT_COLD_AFTER_TICKS } from 'game/economy/CityIncidents';
import DetentionRegistry from 'game/economy/DetentionRegistry';
import BuildingConditions, { FIRE_CONFIG } from 'game/economy/BuildingConditions';
import Economy from 'game/economy/Economy';
import { generateBusiness } from 'game/economy/BusinessGen';
import GameManager from 'game/GameManager';
import KnownFacts from 'game/population/KnownFacts';
import PetRegistry from 'game/population/PetRegistry';
import Population from 'game/population/Population';
import SchoolRegistry from 'game/skills/SchoolRegistry';
import SkillBook from 'game/skills/SkillBook';
import Field from 'game/world/Field';
import House from 'game/world/House';
import Workplace from 'game/world/Workplace';
import businessesConfig from 'json/businesses.json';
import jobsConfig from 'json/jobs.json';
import { BusinessBlueprintTable, JobTable } from 'types/Business';
import { GenPerson } from 'types/Genealogy';
import { PixelPosition, TilePosition } from 'types/Position';
import { Genders } from 'types/Social';
import { JobPosition } from 'types/Work';
import { SeededRandom, hashStringToSeed } from 'util/random';

// City.ts's reactive loops — fire, police, and the services sweep (tasks 099/100/102/109/110/114) — are
// OWNED by the execution module for coverage but are also exercised by economy-module E2E suites (which
// don't count toward this module's number). This suite drives those live City methods over a real Field +
// wired registries (no Phaser), asserting the outcomes, so the execution module owns its own coverage of
// them. It mirrors the economy suites' harness deliberately: the per-module gate scopes City.ts here.

const TPY = 8640;
const HOUR_MS = 60 * 60 * 1000 / 24;
const TICK_NOW = 40 * TPY;
const WORLD_SEED = 6;
const BLUEPRINTS = businessesConfig as unknown as BusinessBlueprintTable;
const JOBS = jobsConfig as unknown as JobTable;

function gen(id: string, opts: Partial<GenPerson> = {}): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: TICK_NOW - 30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [], ...opts };
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
    const schools = new SchoolRegistry();
    const skillBook = new SkillBook();
    const pets = new PetRegistry();
    const knownFacts = new KnownFacts();
    const emitted: { event: string; payload: unknown }[] = [];
    const game = {
        field: null, population, clock, economy, eventEngine, incidents, detention, buildingConditions, schools, skillBook, pets, knownFacts,
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
        emitSingle: () => {}, on: () => {}, toolbelt: {},
    } as unknown as GameManager;
    const field = new Field(game, rows, cols);
    (game as unknown as { field: Field }).field = field;
    const city = new City(game);
    (game as unknown as { city: City }).city = city;
    return { game, field, population, clock, economy, city, eventEngine, incidents, detention, buildingConditions, schools, skillBook, pets, knownFacts, emitted };
}

function loadPeople(world: ReturnType<typeof makeGame>, people: Record<string, GenPerson>): void {
    world.population.loadState({ worldSeed: WORLD_SEED, people, drawSeed: 0, placedIds: [], nextSeq: 20, lastSimulatedYear: 0 });
    world.clock.setElapsedMs(TICK_NOW * HOUR_MS);
}

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

describe('the fire loop (live City)', () => {
    test('a derelict building ignites, the scene bus fires, and the outcome resolves after the window', () => {
        const world = makeGame();
        loadPeople(world, { res: gen('res') });
        const house = world.field.loadStructure('house', 10, 10, 'house_1') as House;
        const key = house.getIdentifier();
        const person = world.field.loadPerson(200, 200);
        person.social.setPersonId('res');
        person.social.setHome(house);
        house.addResident(person);
        person.setCurrentBuilding(house);

        const sweepTick = ignitionDay(key) * 24;
        world.buildingConditions.damage(key, 500, sweepTick - 1); // → derelict
        expect(world.city.hasPendingWakes()).toBe(false);
        world.city.runFireHazard(sweepTick);
        expect(world.incidents.openFireAt(`building:${key}`)).toBe(true);
        expect(world.emitted.some(e => e.event === 'fireStateChanged')).toBe(true);
        // The occupied home notified its resident (task 124): a homeFire wake is queued for the minute pass.
        expect(world.city.hasPendingWakes()).toBe(true);

        world.city.resolveFires(sweepTick + FIRE_CONFIG.responseTicks - 1);
        expect(world.incidents.anyOpenFire()).toBe(true); // before the window
        world.city.resolveFires(sweepTick + FIRE_CONFIG.responseTicks);
        expect(world.incidents.anyOpenFire()).toBe(false); // resolved
    });

    test('a derelict workplace ignites too (the business-name branch), a kept-up one does not', () => {
        const world = makeGame();
        loadPeople(world, { a: gen('a') });
        const shop = world.field.loadStructure('work', 10, 10, 'shop_1') as Workplace;
        shop.setBusiness(generateBusiness('supermarket', BLUEPRINTS['supermarket']!, JOBS, 'MiniMart', 2));
        const key = shop.getIdentifier();
        world.field.loadStructure('house', 20, 20, 'keptup_1'); // a second, kept-up building in the sweep

        const sweepTick = ignitionDay(key) * 24;
        world.buildingConditions.damage(key, 500, sweepTick - 1);
        world.city.runFireHazard(sweepTick);
        expect(world.incidents.openFireAt(`building:${key}`)).toBe(true);
        // A second runFireHazard on the same tick doesn't double-report the already-burning shop.
        const before = world.incidents.all().length;
        world.city.runFireHazard(sweepTick);
        expect(world.incidents.all().length).toBe(before);
    });

    test('fireResponseAt scales with the crew that physically arrived', () => {
        const world = makeGame();
        loadPeople(world, { f1: gen('f1'), f2: gen('f2') });
        const house = world.field.loadStructure('house', 10, 10, 'house_1') as House;
        const key = house.getIdentifier();
        expect(world.city.fireResponseAt(key)).toBe(0.5); // no firefighters → unmeasured coverage

        const job = { title: 'Firefighter', salary: 0, requirements: [], shiftStart: 480, shiftEnd: 1020 } as JobPosition;
        const f1 = world.field.loadPerson(200, 200); f1.social.setPersonId('f1'); f1.work.setJob(job);
        const f2 = world.field.loadPerson(220, 200); f2.social.setPersonId('f2'); f2.work.setJob(job);
        expect(world.city.fireResponseAt(key)).toBe(0); // a crew, none on scene
        f1.setCurrentBuilding(house);
        expect(world.city.fireResponseAt(key)).toBeCloseTo(0.25, 6);
        f2.setCurrentBuilding(house);
        expect(world.city.fireResponseAt(key)).toBeCloseTo(0.5, 6);
    });
});

describe('a destroyed building tears down coherently', () => {
    test('resolveFires burns a home to the ground: lost_home_to_fire logged, the structure gone', () => {
        const world = makeGame();
        loadPeople(world, { res: gen('res') });
        const house = world.field.loadStructure('house', 10, 10, 'house_1') as House;
        const key = house.getIdentifier();
        const person = world.field.loadPerson(200, 200);
        person.social.setPersonId('res');
        person.social.setHome(house);
        house.addResident(person);

        // Find a fire id whose outcome roll destroys at neutral response (first draw is the outcome — no
        // co-located building occupants, so no injury draws precede it).
        let fireId = 0;
        for (let id = 1; id < 500; id++) {
            const roll = new SeededRandom((WORLD_SEED ^ hashStringToSeed('fireOutcome#' + id)) >>> 0).next();
            if (roll >= 0.55 && roll < 0.75) { fireId = id; break; }
        }
        expect(fireId).toBeGreaterThan(0);
        for (let id = 1; id < fireId; id++) {
            const dummy = world.incidents.report('shoplifting', 0, 'outside', 'nobody', 0);
            world.incidents.resolve(dummy.id, 0);
        }
        world.incidents.report('fire', TICK_NOW, `building:${key}`, null, 0);
        world.city.resolveFires(TICK_NOW + FIRE_CONFIG.responseTicks);
        expect(world.eventEngine.getPersonLog('res').some(e => e.kind === 'event' && e.defId === 'lost_home_to_fire')).toBe(true);
        expect(world.field.getStructures().some(s => s instanceof House)).toBe(false);
    });
});

describe('fileIncident (the crime → incident bridge)', () => {
    test('a witnessed crime files an incident with the co-located witness count', () => {
        const world = makeGame();
        loadPeople(world, { thief: gen('thief'), w1: gen('w1'), w2: gen('w2') });
        const shop = world.field.loadStructure('work', 10, 10, 'shop_1') as Workplace;
        for (const id of ['thief', 'w1', 'w2']) {
            const p = world.field.loadPerson(150, 150);
            p.social.setPersonId(id);
            p.setCurrentBuilding(shop); // co-located at the scene
        }
        // A committed_shoplifting event this tick is what fileIncident keys off.
        world.eventEngine.invoke(world.population.getState(), 'committed_shoplifting', 'thief', TICK_NOW, TPY, { source: 'system', causationId: null });
        world.city.fileIncident('thief', TICK_NOW);

        const filed = world.incidents.all().filter(i => i.suspectId === 'thief');
        expect(filed).toHaveLength(1);
        expect(filed[0]!.kind).toBe('shoplifting');
        expect(filed[0]!.witnesses).toBe(2); // w1 + w2, not the thief
    });
});

describe('the police loop (live City)', () => {
    test('a witnessed incident convicts: the fine lands, got_caught on the record, case closed', () => {
        const world = makeGame();
        loadPeople(world, { thief: gen('thief') });
        world.economy.adjustPerson('thief', 500);
        const station = world.field.loadStructure('work', 10, 10, 'building_1x1x2_2') as Workplace;
        station.setBusiness(generateBusiness('police_station', BLUEPRINTS['police_station']!, JOBS, 'Precinct', 2));
        world.field.loadPerson(100, 100).social.setPersonId('thief');
        world.incidents.report('shoplifting', TICK_NOW, 'building:5-5', 'thief', 3);

        let convicted = false;
        for (let day = 1; day <= 40 && !convicted; day++) {
            world.city.runPoliceWork(TICK_NOW + day * 24, TPY);
            convicted = !world.incidents.isWanted('thief');
        }
        expect(convicted).toBe(true);
        expect(world.eventEngine.getPersonLog('thief').some(e => e.kind === 'event' && e.defId === 'got_caught')).toBe(true);
        expect(world.economy.getPersonBalance('thief')).toBeLessThan(500);
    });

    test('two priors serve the long stretch (scaled sentence)', () => {
        const world = makeGame();
        loadPeople(world, { thief: gen('thief') });
        world.field.loadPerson(100, 100).social.setPersonId('thief');
        const station = world.field.loadStructure('work', 10, 10, 'building_1x1x2_2') as Workplace;
        station.setBusiness(generateBusiness('police_station', BLUEPRINTS['police_station']!, JOBS, 'Precinct', 2));
        // Two priors already on the record → the third conviction serves the long stretch.
        world.eventEngine.invoke(world.population.getState(), 'got_caught', 'thief', TICK_NOW - 100, TPY, { source: 'system', causationId: null });
        world.eventEngine.invoke(world.population.getState(), 'got_caught', 'thief', TICK_NOW - 50, TPY, { source: 'system', causationId: null });
        world.incidents.report('shoplifting', TICK_NOW, 'building:5-5', 'thief', 3);
        for (let day = 1; day <= 60 && world.incidents.isWanted('thief'); day++) {
            world.city.runPoliceWork(TICK_NOW + day * 24, TPY);
        }
        expect(world.detention.detentionOf('thief')).not.toBeNull();
    });

    test('a caught chase runs the arrest ceremony: both sides + the family fan-out, escort, conviction', () => {
        const world = makeGame();
        const people = {
            thief: gen('thief', { partnerships: [{ partnerId: 'spouse', startTick: TICK_NOW - 5 * TPY, endTick: null }] }),
            spouse: gen('spouse', { partnerships: [{ partnerId: 'thief', startTick: TICK_NOW - 5 * TPY, endTick: null }] }),
            officer: gen('officer'),
        };
        loadPeople(world, people);
        for (const id of ['thief', 'spouse', 'officer']) {
            world.field.loadPerson(100, 100).social.setPersonId(id);
        }
        const officer = world.field.getPeople().find(p => p.social.getPersonId() === 'officer')!;
        officer.work.setJob({ title: 'Police Officer', salary: 0, requirements: [], shiftStart: 480, shiftEnd: 1020 } as JobPosition);
        const station = world.field.loadStructure('work', 10, 10, 'building_1x1x2_2') as Workplace;
        station.setBusiness(generateBusiness('police_station', BLUEPRINTS['police_station']!, JOBS, 'Precinct', 2));
        world.incidents.report('shoplifting', TICK_NOW, 'building:5-5', 'thief', 2);

        let catchTick = 0;
        for (let tick = TICK_NOW + 1; tick < TICK_NOW + 300; tick++) {
            if (new SeededRandom((WORLD_SEED ^ hashStringToSeed(`chase#thief#${tick}`)) >>> 0).next() < 0.55) { catchTick = tick; break; }
        }
        world.city.resolveChase('thief', catchTick, TPY);
        const thiefLog = world.eventEngine.getPersonLog('thief').filter(e => e.kind === 'event').map(e => e.defId);
        expect(thiefLog).toEqual(expect.arrayContaining(['was_arrested', 'got_caught']));
        expect(world.eventEngine.getPersonLog('officer').some(e => e.kind === 'event' && e.defId === 'arrested_suspect')).toBe(true);
        expect(world.eventEngine.getPersonLog('spouse').some(e => e.kind === 'event' && e.defId === 'relative_arrested')).toBe(true);
        expect(world.incidents.isWanted('thief')).toBe(false);
    });

    test('a witnessed case going cold fires got_away_with_it; an unwitnessed one stays silent', () => {
        const world = makeGame();
        loadPeople(world, { sneak: gen('sneak'), ghost: gen('ghost') });
        world.field.loadPerson(100, 100).social.setPersonId('sneak');
        world.field.loadPerson(102, 100).social.setPersonId('ghost');
        world.incidents.report('pickpocketing', TICK_NOW, 'outside', 'sneak', 2);
        world.incidents.report('pickpocketing', TICK_NOW, 'outside', 'ghost', 0);
        world.city.runPoliceWork(TICK_NOW + INCIDENT_COLD_AFTER_TICKS + 25, TPY);
        expect(world.eventEngine.getPersonLog('sneak').some(e => e.kind === 'event' && e.defId === 'got_away_with_it')).toBe(true);
        expect(world.eventEngine.getPersonLog('ghost')).toHaveLength(0);
    });

    test('an evaded chase: no arrest, the suspect got away', () => {
        const world = makeGame();
        loadPeople(world, { runner: gen('runner') });
        world.field.loadPerson(100, 100).social.setPersonId('runner');
        world.incidents.report('shoplifting', TICK_NOW, 'building:5-5', 'runner', 2);
        // A tick whose deterministic chase roll does NOT catch (>= 0.55) → evaded.
        let evadeTick = 0;
        for (let tick = TICK_NOW + 1; tick < TICK_NOW + 300; tick++) {
            if (new SeededRandom((WORLD_SEED ^ hashStringToSeed(`chase#runner#${tick}`)) >>> 0).next() >= 0.55) { evadeTick = tick; break; }
        }
        world.city.resolveChase('runner', evadeTick, TPY);
        expect(world.eventEngine.getPersonLog('runner').some(e => e.kind === 'event' && e.defId === 'was_arrested')).toBe(false);
    });
});

describe('career retcon at hydration (a staffing gap draws in a chapter)', () => {
    test('a town with a hospital but no doctor retcons an adult into the healthcare workforce', () => {
        const world = makeGame();
        loadPeople(world, { m: gen('m', { birthTick: TICK_NOW - 28 * TPY }) }); // an adult in the retcon age band
        world.field.loadPerson(100, 100).social.setPersonId('m');
        // A placed hospital with no doctor employed → a measured healthcare STAFFING gap (facility present).
        const hospital = world.field.loadStructure('work', 10, 10, 'building_1x1x2_2') as Workplace;
        hospital.setBusiness(generateBusiness('hospital', BLUEPRINTS['hospital']!, JOBS, 'Clínica', 3));

        // Retcons are a bounded fraction of household draws (a seeded per-house roll); try several house keys
        // until one passes the gate, then assert the injected education chapter landed as a real log entry.
        let retconned = false;
        for (let i = 0; i < 200 && !retconned; i++) {
            world.city.applyCareerRetcon(`house-${i}`, ['m'], TICK_NOW, TPY);
            retconned = world.eventEngine.getPersonLog('m').some(e => e.kind === 'event'
                && (e.defId === 'nursing_school' || e.defId === 'trade_school' || e.defId === 'medical_school'));
        }
        expect(retconned).toBe(true);
    });
});

describe('the services sweep (live City)', () => {
    test('recomputeServices emits servicesChanged with the ledger lines', () => {
        const world = makeGame();
        loadPeople(world, { a: gen('a') });
        world.field.loadPerson(100, 100).social.setPersonId('a');
        world.city.recomputeServices(TICK_NOW + 24);
        const changed = world.emitted.filter(e => e.event === 'servicesChanged');
        expect(changed).toHaveLength(1);
        expect(Array.isArray(changed[0]!.payload)).toBe(true);
    });
});

describe('pets & gossip (live City reactions)', () => {
    test('resolveAdoption registers a companion, draws a species, and fires the milestone', () => {
        const world = makeGame();
        loadPeople(world, { owner: gen('owner') });
        world.field.loadPerson(100, 100).social.setPersonId('owner');
        expect(world.pets.countOf('owner')).toBe(0);
        world.city.resolveAdoption('owner', TICK_NOW);
        expect(world.pets.countOf('owner')).toBe(1);
        expect(world.emitted.some(e => e.event === 'cityEvent')).toBe(true); // the 'pet' announce
    });

    test('transferGossip moves the speaker\'s juiciest known fact to the listener', () => {
        const world = makeGame();
        loadPeople(world, { speaker: gen('speaker'), listener: gen('listener'), subject: gen('subject') });
        world.knownFacts.learn('speaker', { aboutId: 'subject', seq: 5, eventId: 'committed_shoplifting', valence: -3, learnedAtTick: TICK_NOW, viaWitness: true });
        expect(world.knownFacts.factsOf('listener', TICK_NOW)).toHaveLength(0);
        world.city.transferGossip('speaker', 'listener', TICK_NOW + 1);
        const heard = world.knownFacts.factsOf('listener', TICK_NOW + 1);
        expect(heard).toHaveLength(1);
        expect(heard[0]!.aboutId).toBe('subject');
    });
});

describe('the daily spine (handleNewDay) over a live town', () => {
    test('runs the day-cadence sub-sweeps without error and advances the town', () => {
        const world = makeGame();
        loadPeople(world, {
            adult1: gen('adult1'),
            adult2: gen('adult2'),
            kid: gen('kid', { birthTick: TICK_NOW - 10 * TPY }), // school-age
        });
        const home = world.field.loadStructure('house', 10, 10, 'home_1') as House;
        for (const id of ['adult1', 'adult2', 'kid']) {
            const p = world.field.loadPerson(150, 150);
            p.social.setPersonId(id);
            p.social.setHome(home);
            home.addResident(p);
        }
        world.field.loadStructure('work', 20, 20, 'work_1'); // a vacant work lot (entrepreneurship candidate)

        const clock = world.clock;
        // Drive several in-game days, including a month boundary so the monthly economy fires.
        let threw = false;
        try {
            for (let day = 0; day < 35; day++) {
                const tick = TICK_NOW + day * 24;
                clock.setElapsedMs(tick * HOUR_MS);
                world.city.handleNewDay({ tick, timestamp: clock.getTimestamp() });
            }
        } catch {
            threw = true;
        }
        expect(threw).toBe(false);
        // The daily services sweep ran each day → the nagbar bus event fired repeatedly.
        expect(world.emitted.filter(e => e.event === 'servicesChanged').length).toBeGreaterThanOrEqual(30);
    });
});
