import City from 'game/City';
import Clock from 'game/Clock';
import EventEngine from 'game/events/EventEngine';
import Economy from 'game/economy/Economy';
import GameManager from 'game/GameManager';
import PetRegistry, { PETS_CONFIG } from 'game/population/PetRegistry';
import Population from 'game/population/Population';
import Field from 'game/world/Field';
import actionsConfig from 'json/actions.json';
import { ActionManifest } from 'types/Action';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { PixelPosition, TilePosition } from 'types/Position';
import { Genders } from 'types/Social';

// Pets (task 103 / proposal N): lightweight companions with a real lifecycle — cap-gated adoption at the
// pet shop (the event's petCount gate), a deterministic species/name draw, wired species texture events
// (adopted_dog is never free-rolled anymore), and a passing that lands a genuine -3 grief impulse.

const TPY = 8640;
const HOUR_MS = 60 * 60 * 1000 / 24;
const TICK_NOW = 40 * TPY;
const ACTIONS = actionsConfig as unknown as ActionManifest;

describe('the registry', () => {
    test('adopt / count / remove / owner death / round-trip', () => {
        const pets = new PetRegistry();
        expect(pets.countOf('a')).toBe(0);
        const rex = pets.adopt('a', 'dog', 'Rex', 100);
        pets.adopt('a', 'cat', 'Mimi', 120);
        pets.adopt('b', 'goldfish', 'Bolha', 130);
        expect(pets.countOf('a')).toBe(2);
        expect(pets.petsOf('b')).toHaveLength(1);

        const restored = new PetRegistry();
        restored.loadState(pets.serialize());
        expect(restored.countOf('a')).toBe(2);
        restored.removePet(rex.id);
        expect(restored.countOf('a')).toBe(1);
        expect(pets.countOf('a')).toBe(2); // deep copy
        pets.removeOwner('a');
        expect(pets.countOf('a')).toBe(0);
        expect(pets.countOf('b')).toBe(1);
        restored.loadState(undefined);
        expect(restored.all()).toEqual([]);
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
    const pets = new PetRegistry();
    const game = {
        field: null,
        population,
        clock,
        economy,
        eventEngine,
        pets,
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
    return { game, field, population, clock, economy, city, eventEngine, pets };
}

describe('adoption & the lifecycle', () => {
    test('City resolves an adoption deterministically: species drawn, named, registered, texture event wired', () => {
        const world = makeGame();
        const state: PopulationState = { worldSeed: 4, people: { owner: gen('owner') }, drawSeed: 0, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 };
        world.population.loadState(state);
        world.clock.setElapsedMs(TICK_NOW * HOUR_MS);
        world.field.loadPerson(100, 100).social.setPersonId('owner');

        world.city.resolveAdoption('owner', TICK_NOW);
        expect(world.pets.countOf('owner')).toBe(1);
        const pet = world.pets.petsOf('owner')[0]!;
        expect(Object.keys(PETS_CONFIG.species)).toContain(pet.species);
        expect(pet.name.length).toBeGreaterThan(0);
        // The species texture event landed via the wired path (C2 — not a free roll).
        const speciesEvent = PETS_CONFIG.species[pet.species]!.event;
        expect(world.eventEngine.getPersonLog('owner').some(e => e.kind === 'event' && e.defId === speciesEvent)).toBe(true);
        // Determinism: the same world resolves the same adoption.
        const twin = makeGame();
        twin.population.loadState({ worldSeed: 4, people: { owner: gen('owner') }, drawSeed: 0, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 });
        twin.clock.setElapsedMs(TICK_NOW * HOUR_MS);
        twin.field.loadPerson(100, 100).social.setPersonId('owner');
        twin.city.resolveAdoption('owner', TICK_NOW);
        expect(twin.pets.petsOf('owner')[0]!.species).toBe(pet.species);
        expect(twin.pets.petsOf('owner')[0]!.name).toBe(pet.name);
    });

    test('the cap holds: a full house adopts nobody', () => {
        const world = makeGame();
        world.population.loadState({ worldSeed: 4, people: { owner: gen('owner') }, drawSeed: 0, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 });
        world.clock.setElapsedMs(TICK_NOW * HOUR_MS);
        for (let i = 0; i < PETS_CONFIG.maxPerOwner; i++) {
            world.pets.adopt('owner', 'cat', `Cat${i}`, TICK_NOW);
        }
        world.city.resolveAdoption('owner', TICK_NOW);
        expect(world.pets.countOf('owner')).toBe(PETS_CONFIG.maxPerOwner);
        // And the petCount context attribute gates the adoption EVENT itself.
        const context = world.eventEngine.contextFor(world.population.getState(), 'owner', TICK_NOW, TPY);
        void context;
        world.eventEngine.bindMarkets({ markets: { pets: world.pets } });
        const gated = world.eventEngine.contextFor(world.population.getState(), 'owner', TICK_NOW, TPY).getAttr('petCount');
        world.eventEngine.unbindMarkets();
        expect(gated).toBe(PETS_CONFIG.maxPerOwner);
    });

    test('an old companion passes: removed from the registry, pet_passed_away (valence -3) on the owner', () => {
        const world = makeGame();
        world.population.loadState({ worldSeed: 4, people: { owner: gen('owner') }, drawSeed: 0, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 });
        world.clock.setElapsedMs(TICK_NOW * HOUR_MS);
        world.field.loadPerson(100, 100).social.setPersonId('owner');
        const lifespan = PETS_CONFIG.species['goldfish']!.lifespanYears;
        world.pets.adopt('owner', 'goldfish', 'Bolha', TICK_NOW - (lifespan + 1) * TPY); // already past its span
        let passed = false;
        for (let day = 0; day < 120 && !passed; day++) {
            world.city.runPetLifecycle(TICK_NOW + day * 24);
            passed = world.pets.countOf('owner') === 0;
        }
        expect(passed).toBe(true); // 0.05/day → deterministic within ~120 swept days on this seed
        expect(world.eventEngine.getPersonLog('owner').some(e => e.kind === 'event' && e.defId === 'pet_passed_away')).toBe(true);
        // A young pet is never swept.
        world.pets.adopt('owner', 'dog', 'Rex', TICK_NOW);
        world.city.runPetLifecycle(TICK_NOW + 121 * 24);
        expect(world.pets.countOf('owner')).toBe(1);
    });
});

describe('the repertoire (data)', () => {
    test('adoption is cap-gated, the walk needs a companion, and the routine anchors daily care', () => {
        expect(ACTIONS['adopted_a_pet']!.requirements).toEqual({ attr: 'petCount', op: '<', value: PETS_CONFIG.maxPerOwner });
        expect(ACTIONS['walking_the_dog']!.requirements).toEqual({ attr: 'petCount', op: '>=', value: 1 });
        expect(ACTIONS['walking_the_dog']!.ambulatory).toBe('stroll');
        expect(ACTIONS['caring_for_the_pet']!.requirements).toEqual({ attr: 'petCount', op: '>=', value: 1 });
    });
});
