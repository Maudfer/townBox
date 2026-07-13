import ActionEngine from 'game/actions/ActionEngine';
import Brain, { BrainDeps } from 'game/actions/Brain';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import LiveWorld from 'game/execution/LiveWorld';
import { generateBusiness } from 'game/economy/BusinessGen';
import Economy from 'game/economy/Economy';
import GameManager from 'game/GameManager';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import Field from 'game/world/Field';
import Building from 'game/world/Building';
import Person from 'game/agents/Person';
import Workplace from 'game/world/Workplace';
import businessesConfig from 'json/businesses.json';
import jobsConfig from 'json/jobs.json';
import { BusinessBlueprintTable, JobTable } from 'types/Business';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { TickResult } from 'types/LifeEvent';
import { PixelPosition, TilePosition } from 'types/Position';
import { Genders } from 'types/Social';

// Venue grounding (task 107 / visibility F0): venue:* finally resolves to REAL placed buildings in live
// mode — the nearest occupied hosting business, pinned for the whole trip — no host means a clean typed
// cancel, selection skips unreachable venue trips, and purchases at a grounded venue consume the shop's
// ACTUAL stock (the 089 machinery's payoff). Bootstrap keeps abstract venues; the seam takes no branches.

const TPY = 8640;
const BLUEPRINTS = businessesConfig as unknown as BusinessBlueprintTable;
const JOBS = jobsConfig as unknown as JobTable;

function gen(id: string): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });

function makeField(): Field {
    const rows = 40;
    const cols = 40;
    const game = {
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
    return new Field(game, rows, cols);
}

function harness() {
    const field = makeField();
    const commutes: { person: Person; destination: Building }[] = [];
    const world = new LiveWorld({
        getPeople: () => field.getPeople(),
        buildingByKey: key => (field.getStructures().find(s => s instanceof Building && s.getIdentifier() === key) as Building | undefined) ?? null,
        startCommute: (person, destination) => commutes.push({ person, destination }),
        listBuildings: () => field.getStructures().filter((tile): tile is Building => tile instanceof Building),
    });
    const placeShop = (blueprintKey: string, row: number, col: number): Workplace => {
        const shop = field.loadStructure('work', col, row, 'building_1x1x2_2') as Workplace;
        shop.setBusiness(generateBusiness(blueprintKey, BLUEPRINTS[blueprintKey]!, JOBS, blueprintKey + '-' + row, 2));
        return shop;
    };
    return { field, world, commutes, placeShop };
}

describe('resolution', () => {
    test('a venue trip resolves to the NEAREST occupied host, pinned for the whole trip', () => {
        const { field, world, commutes, placeShop } = harness();
        const near = placeShop('supermarket', 8, 8);
        placeShop('supermarket', 30, 30);
        const person = field.loadPerson(8 * 16, 8 * 16); // right next to the near one
        person.social.setPersonId('a');

        const handle = world.requestTransition('a', { kind: 'venue', venue: 'supermarket' }, 10, null);
        expect(handle.status).toBe('pending');
        expect(commutes).toHaveLength(1);
        expect(commutes[0]!.destination).toBe(near);

        // Arrival at the pinned host flips the handle.
        person.setCurrentBuilding(near);
        world.pump(11);
        expect(handle.status).toBe('arrived');
    });

    test('no host in town → a clean cancel; hasVenue answers both modes correctly', () => {
        const { field, world } = harness();
        const person = field.loadPerson(100, 100);
        person.social.setPersonId('a');
        expect(world.hasVenue('bar')).toBe(false);
        const handle = world.requestTransition('a', { kind: 'venue', venue: 'bar' }, 10, null);
        expect(handle.status).toBe('cancelled');

        // Bootstrap: abstract venues always exist — the seam's one sanctioned difference.
        expect(new BootstrapWorld().hasVenue()).toBe(true);
    });

    test('a generic shop venue accepts any mapped retail host', () => {
        const { world, placeShop } = harness();
        expect(world.hasVenue('shop')).toBe(false);
        placeShop('bookstore', 12, 12);
        expect(world.hasVenue('shop')).toBe(true);
        expect(world.hasVenue('supermarket')).toBe(false); // the bookstore hosts 'shop', not 'supermarket'
    });
});

describe('selection skips the unreachable', () => {
    test('venue-located free-time actions are never picked in a town without hosts', () => {
        const { field, world, placeShop } = harness();
        const engine = new EventEngine();
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const brain = new Brain(actions);
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const person = field.loadPerson(100, 100);
        person.social.setPersonId('a');
        const state: PopulationState = { worldSeed: 8, people: { a: gen('a') }, drawSeed: 1, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 };
        const deps = (tick: number): BrainDeps => ({ state, tick, ticksPerYear: TPY, ctx: { mode: 'live', world }, eventEngine: engine, inventory });

        const venueActions = new Set(Object.entries(actions.getManifest())
            .filter(([, def]) => typeof def.location === 'string' && def.location.startsWith('venue:'))
            .map(([id]) => id));
        for (let day = 0; day < 40; day++) {
            const pick = brain.selectFreeTimeAction('a', deps(day * 24 + 20));
            expect(pick === null || !venueActions.has(pick)).toBe(true);
        }

        // Build a bar → bar trips come back on the menu (eventually picked on this seed).
        placeShop('bar', 10, 10);
        let barPicked = false;
        for (let day = 40; day < 400 && !barPicked; day++) {
            barPicked = brain.selectFreeTimeAction('a', deps(day * 24 + 20)) === 'at_the_bar';
        }
        expect(barPicked).toBe(true);
    });
});

describe('real stock at a grounded venue', () => {
    test('a purchase AT the shop consumes the business\'s actual stock, not the conjuring fallback', () => {
        const { field, placeShop } = harness();
        const shop = placeShop('supermarket', 10, 10);
        const engine = new EventEngine();
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const world = new LiveWorld({
            getPeople: () => field.getPeople(),
            buildingByKey: key => (field.getStructures().find(s => s instanceof Building && s.getIdentifier() === key) as Building | undefined) ?? null,
            startCommute: () => {},
            listBuildings: () => field.getStructures().filter((tile): tile is Building => tile instanceof Building),
            getInventory: () => inventory,
        });
        const person = field.loadPerson(100, 100);
        person.social.setPersonId('a');
        person.setCurrentBuilding(shop); // shopping inside the real supermarket
        const shopKey = shop.getIdentifier();
        const stock = inventory.createInstance({ archetypeId: 'bread_loaf', owner: { kind: 'business', key: shopKey }, container: { kind: 'location', key: `building:${shopKey}` }, tick: 0, quantity: 3 });

        const economy = new Economy();
        economy.adjustPerson('a', 100);
        const state: PopulationState = { worldSeed: 8, people: { a: gen('a') }, drawSeed: 1, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 };
        const deps = { state, tick: 10, ticksPerYear: TPY, ctx: { mode: 'live' as const, world, markets: { ledger: economy } }, eventEngine: engine, inventory };

        const start = actions.startAction('a', 'bought_fresh_bread', {}, { source: 'brain', causationId: null }, deps, result());
        expect(start.ok).toBe(true);
        // The REAL stock instance changed hands — no conjured loaf. (The purchase currently transfers the
        // whole stack, an 089 simplification; per-unit splitting is a 113 refinement candidate.)
        const sold = inventory.getInstance(stock.id)!;
        expect(sold.owner).toEqual({ kind: 'person', personId: 'a' });
        expect(sold.container).toEqual({ kind: 'possessions', personId: 'a' });
        const carried = inventory.carriedInstances('a').filter(instance => instance.archetypeId === 'bread_loaf');
        expect(carried).toHaveLength(1);
        expect(carried[0]!.id).toBe(stock.id); // traceably THE shop's loaf, not a fallback creation
    });
});
