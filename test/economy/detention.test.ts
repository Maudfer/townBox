import City from 'game/City';
import Clock from 'game/Clock';
import EventEngine from 'game/events/EventEngine';
import CityIncidents from 'game/economy/CityIncidents';
import DetentionRegistry from 'game/economy/DetentionRegistry';
import Economy from 'game/economy/Economy';
import { generateBusiness } from 'game/economy/BusinessGen';
import GameManager from 'game/GameManager';
import Population from 'game/population/Population';
import Field from 'game/world/Field';
import Workplace from 'game/world/Workplace';
import businessesConfig from 'json/businesses.json';
import economyConfig from 'json/economy.json';
import jobsConfig from 'json/jobs.json';
import { BusinessBlueprintTable, JobTable } from 'types/Business';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { PixelPosition, TilePosition } from 'types/Position';
import { Genders } from 'types/Social';

// Jail & detention (task 100 / proposal G5): the registry, the sentencing rule (repeat offenders are
// detained when the town can hold them — jail preferred, police station as the stopgap, nowhere → fine
// only), and the release sweep. Detention is lived state — household membership never moves.

const TPY = 8640;
const HOUR_MS = 60 * 60 * 1000 / 24;
const TICK_NOW = 40 * TPY;
const SENTENCE_TICKS = (economyConfig as { detentionDays: number }).detentionDays * 24;
const BLUEPRINTS = businessesConfig as unknown as BusinessBlueprintTable;
const JOBS = jobsConfig as unknown as JobTable;

function gen(id: string): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: TICK_NOW - 30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

describe('the registry', () => {
    test('detain / isDetained / due / release / round-trip', () => {
        const registry = new DetentionRegistry();
        expect(registry.isDetained('a', 100)).toBe(false);
        registry.detain('a', 200, '9-9');
        expect(registry.isDetained('a', 199)).toBe(true);
        expect(registry.isDetained('a', 200)).toBe(false); // lapsed
        expect(registry.detentionOf('a')).toEqual({ untilTick: 200, locationKey: '9-9' });
        expect(registry.due(150)).toEqual([]);
        expect(registry.due(200)).toEqual(['a']);

        const restored = new DetentionRegistry();
        restored.loadState(registry.serialize());
        expect(restored.detentionOf('a')).toEqual({ untilTick: 200, locationKey: '9-9' });
        restored.release('a');
        expect(restored.detentionOf('a')).toBeNull();
        expect(registry.detentionOf('a')).not.toBeNull(); // deep copy
        registry.removePerson('a');
        expect(registry.detentionOf('a')).toBeNull();
        restored.loadState(undefined);
        expect(restored.due(99999)).toEqual([]);
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
    const game = {
        field: null,
        population,
        clock,
        economy,
        eventEngine,
        incidents,
        detention,
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
    return { game, field, population, clock, economy, city, eventEngine, incidents, detention };
}

function loadThief(world: ReturnType<typeof makeGame>): void {
    const state: PopulationState = { worldSeed: 3, people: { thief: gen('thief') }, drawSeed: 0, placedIds: [], nextSeq: 10, lastSimulatedYear: 0 };
    world.population.loadState(state);
    world.clock.setElapsedMs(TICK_NOW * HOUR_MS);
    world.field.loadPerson(100, 100).social.setPersonId('thief');
    world.economy.adjustPerson('thief', 1000);
}

// Drive convictions through the public police sweep: report a witnessed incident, sweep days until resolved.
function convictOnce(world: ReturnType<typeof makeGame>, fromTick: number): number {
    world.incidents.report('shoplifting', fromTick, 'building:5-5', 'thief', 3);
    for (let day = 1; day <= 60; day++) {
        const tick = fromTick + day * 24;
        world.city.runPoliceWork(tick, TPY);
        if (!world.incidents.isWanted('thief')) {
            return tick;
        }
    }
    throw new Error('never convicted');
}

describe('sentencing & release', () => {
    test('first offense fines; the repeat offense detains at the station; the sweep releases when served', () => {
        const world = makeGame();
        loadThief(world);
        const station = world.field.loadStructure('work', 10, 10, 'building_1x1x2_2') as Workplace;
        station.setBusiness(generateBusiness('police_station', BLUEPRINTS['police_station']!, JOBS, 'Precinct 1', 2));

        const firstTick = convictOnce(world, TICK_NOW);
        expect(world.detention.isDetained('thief', firstTick + 1)).toBe(false); // first offense → fine only

        const secondTick = convictOnce(world, firstTick + 24);
        expect(world.detention.isDetained('thief', secondTick + 1)).toBe(true); // repeat → detained
        expect(world.detention.detentionOf('thief')!.locationKey).toBe(station.getIdentifier());
        expect(world.eventEngine.getPersonLog('thief').filter(e => e.kind === 'event' && e.defId === 'was_detained')).toHaveLength(1);

        // Not yet due → still inside; once the sentence lapses, the sweep frees them with the record entry.
        world.city.runReleases(secondTick + SENTENCE_TICKS - 1);
        expect(world.detention.detentionOf('thief')).not.toBeNull();
        world.city.runReleases(secondTick + SENTENCE_TICKS);
        expect(world.detention.detentionOf('thief')).toBeNull();
        expect(world.eventEngine.getPersonLog('thief').some(e => e.kind === 'event' && e.defId === 'released_from_jail')).toBe(true);
    });

    test('a jail outranks the station as the facility; with NEITHER, repeat offenders stay fine-only', () => {
        const withJail = makeGame();
        loadThief(withJail);
        const station = withJail.field.loadStructure('work', 10, 10, 'building_1x1x2_2') as Workplace;
        station.setBusiness(generateBusiness('police_station', BLUEPRINTS['police_station']!, JOBS, 'Precinct 1', 2));
        const jail = withJail.field.loadStructure('work', 22, 22, 'building_1x1x2_2') as Workplace;
        jail.setBusiness(generateBusiness('jail', BLUEPRINTS['jail']!, JOBS, 'County Jail', 2));
        const first = convictOnce(withJail, TICK_NOW);
        convictOnce(withJail, first + 24);
        expect(withJail.detention.detentionOf('thief')!.locationKey).toBe(jail.getIdentifier());

        const nowhere = makeGame();
        loadThief(nowhere);
        const first2 = convictOnce(nowhere, TICK_NOW);
        convictOnce(nowhere, first2 + 24);
        expect(nowhere.detention.detentionOf('thief')).toBeNull(); // nowhere to hold anyone
        expect(nowhere.eventEngine.getPersonLog('thief').filter(e => e.kind === 'event' && e.defId === 'got_caught').length).toBeGreaterThanOrEqual(2);
    });
});
