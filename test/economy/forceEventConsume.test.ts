import City from 'game/City';
import Clock from 'game/Clock';
import EventEngine from 'game/events/EventEngine';
import CityIncidents from 'game/economy/CityIncidents';
import Economy from 'game/economy/Economy';
import GameManager from 'game/GameManager';
import Population from 'game/population/Population';
import Field from 'game/world/Field';
import { GenPerson } from 'types/Genealogy';
import { PixelPosition, TilePosition } from 'types/Position';
import { Genders } from 'types/Social';

// City.forceEventAndConsume (V8 / proposal simulation-aliveness-4 M2): the observation-session forcing
// helper must route a manual event's signals/commits through the SAME City consumers a real tick uses — a
// raw EventEngine.invoke drops all of that, so a forced crime never filed an incident (the audit's foot-gun).

const TPY = 8640;
const HOUR_MS = 60 * 60 * 1000 / 24;
const TICK_NOW = 40 * TPY;

function gen(id: string, opts: Partial<GenPerson> = {}): GenPerson {
    return {
        id, firstName: id, familyName: 'Fam', gender: Genders.Female,
        birthTick: TICK_NOW - 30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [], ...opts,
    };
}

function makeGame() {
    const rows = 40;
    const cols = 40;
    const population = new Population();
    const clock = new Clock();
    const economy = new Economy();
    const eventEngine = new EventEngine();
    const incidents = new CityIncidents();
    const game = {
        field: null, population, clock, economy, eventEngine, incidents,
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
    return { game, field, population, clock, city, eventEngine, incidents };
}

describe('forceEventAndConsume', () => {
    test('a forced crime files a real incident (signals are consumed, not dropped)', () => {
        const world = makeGame();
        world.population.loadState({
            worldSeed: 5, people: { thief: gen('thief'), witness: gen('witness') }, drawSeed: 0, placedIds: [], nextSeq: 8, lastSimulatedYear: 0,
        });
        world.clock.setElapsedMs(TICK_NOW * HOUR_MS);
        // Both stand on the same tile (both outdoors), so the crime is witnessed — a witnessed incident is
        // what makes the suspect wanted (a 0-witness crime files but doesn't).
        world.field.loadPerson(100, 100).social.setPersonId('thief');
        world.field.loadPerson(100, 100).social.setPersonId('witness');

        expect(world.incidents.isWanted('thief')).toBe(false);
        const ok = world.city.forceEventAndConsume('committed_shoplifting', 'thief', TICK_NOW);
        expect(ok).toBe(true);
        // The crimeCommitted signal was routed to fileIncident — the raw invoke would have left this empty.
        expect(world.incidents.open().some(record => record.suspectId === 'thief')).toBe(true);
        expect(world.incidents.isWanted('thief')).toBe(true);
    });

    test('returns false for an unknown event and files nothing', () => {
        const world = makeGame();
        world.population.loadState({
            worldSeed: 5, people: { thief: gen('thief') }, drawSeed: 0, placedIds: [], nextSeq: 5, lastSimulatedYear: 0,
        });
        world.clock.setElapsedMs(TICK_NOW * HOUR_MS);
        world.field.loadPerson(100, 100).social.setPersonId('thief');

        expect(world.city.forceEventAndConsume('not_a_real_event', 'thief', TICK_NOW)).toBe(false);
        expect(world.incidents.open()).toHaveLength(0);
    });
});
