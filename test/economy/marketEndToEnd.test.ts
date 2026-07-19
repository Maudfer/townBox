import ActionEngine from 'game/actions/ActionEngine';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import LiveWorld from 'game/execution/LiveWorld';
import Economy from 'game/economy/Economy';
import { generateBusiness } from 'game/economy/BusinessGen';
import GameManager from 'game/GameManager';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import Field from 'game/world/Field';
import Building from 'game/world/Building';
import House from 'game/world/House';
import Workplace from 'game/world/Workplace';
import actionsConfig from 'json/actions.json';
import businessesConfig from 'json/businesses.json';
import jobsConfig from 'json/jobs.json';
import objectsConfig from 'json/objects.json';
import oarConfig from 'json/object-action-relationships.json';
import { ActionManifest, ConsequenceOp } from 'types/Action';
import { BusinessBlueprintTable, JobTable } from 'types/Business';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { TickResult } from 'types/LifeEvent';
import { PixelPosition, TilePosition } from 'types/Position';
import { Genders } from 'types/Social';

// The market, end to end (task 113 — 107's payoff, verified): at a REAL shop the shelf is the truth.
// Purchases consume actual business stock (money moves person→business through the ledger), the conjuring
// fallback is RETIRED where the venue is physically hosted (and kept off-map, where venues are abstract),
// every purchase query is coverable by real stock somewhere, and the Part-0 audit's blocked flagship —
// bake_cake — completes in live play from shopped ingredients.

const TPY = 8640;
const TICK_NOW = 40 * TPY;
const ACTIONS = actionsConfig as unknown as ActionManifest;
const BLUEPRINTS = businessesConfig as unknown as BusinessBlueprintTable;
const JOBS = jobsConfig as unknown as JobTable;

function gen(id: string): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: TICK_NOW - 30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });

describe('the purchase-coverage audit (data)', () => {
    test('every purchaseObject query is satisfiable by REAL stock somewhere: shelf generation or a production recipe', () => {
        const objects = objectsConfig as unknown as Record<string, { tags?: string[]; placement?: string[] }>;
        const blueprintTags = new Set(Object.values(businessesConfig as Record<string, { tags?: string[] }>).flatMap(blueprint => blueprint.tags ?? []));
        const recipeOutputs = new Set(Object.values(oarConfig as Record<string, { inputs?: { transformTo?: { archetype: string } }[]; outputs?: { archetype: string }[] }>)
            .flatMap(entry => [
                ...(entry.outputs ?? []).map(output => output.archetype),
                ...(entry.inputs ?? []).filter(input => input.transformTo).map(input => input.transformTo!.archetype),
            ]));
        const failures: string[] = [];
        for (const [actionId, def] of Object.entries(ACTIONS)) {
            for (const op of (def.consequences ?? []) as ConsequenceOp[]) {
                if (op.op !== 'purchaseObject') {
                    continue;
                }
                const stockable = Object.entries(objects).some(([id, archetype]) => {
                    if (op.query.archetype !== undefined && id !== op.query.archetype) {
                        return false;
                    }
                    if (op.query.tag !== undefined && !(archetype.tags ?? []).includes(op.query.tag)) {
                        return false;
                    }
                    return (archetype.placement ?? []).some(tag => blueprintTags.has(tag)) || recipeOutputs.has(id);
                });
                if (!stockable) {
                    failures.push(`${actionId}: ${JSON.stringify(op.query)}`);
                }
            }
        }
        expect(failures).toEqual([]);
    });
});

// A minimal live town: a real Field with a supermarket (business-occupied Workplace) and a house.
function makeLiveTown() {
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
        emit: () => {}, emitSingle: () => {}, on: () => {}, toolbelt: {},
    } as unknown as GameManager;
    const field = new Field(game, rows, cols);
    const engine = new EventEngine();
    const actions = new ActionEngine(undefined, engine.getLifeLog());
    const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
    const economy = new Economy();

    const shop = field.loadStructure('work', 10, 10, 'building_1x1x2_2') as Workplace;
    shop.setBusiness(generateBusiness('supermarket', BLUEPRINTS['supermarket']!, JOBS, 'MiniMart', 2));
    const house = field.loadStructure('house', 20, 20, 'house_1') as House;
    const person = field.loadPerson(200, 200);
    person.social.setPersonId('shopper');
    person.social.setHome(house);
    house.addResident(person);

    const world = new LiveWorld({
        getPeople: () => field.getPeople(),
        buildingByKey: key => (field.getStructures().find(s => s instanceof Building && s.getIdentifier() === key) as Building | undefined) ?? null,
        listBuildings: () => field.getStructures().filter((s): s is Building => s instanceof Building),
        // The harness commute: teleport — the real machinery is the commute suite's business.
        startCommute: (commuter, destination) => commuter.setCurrentBuilding(destination),
        getInventory: () => inventory,
    });
    const state: PopulationState = { worldSeed: 5, people: { shopper: gen('shopper') }, drawSeed: 1, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 };
    const deps = (tick: number) => ({
        state, tick, ticksPerYear: TPY,
        ctx: { mode: 'live' as const, world, markets: { ledger: economy } },
        eventEngine: engine, inventory,
    });
    const shelf = (archetypeId: string, quantity: number) => inventory.createInstance({
        archetypeId, quantity,
        owner: { kind: 'business', key: shop.getIdentifier() },
        container: { kind: 'location', key: `building:${shop.getIdentifier()}` },
        tick: TICK_NOW, provenance: null,
    });
    const carriedOf = (archetypeId: string): number => inventory.carriedInstances('shopper')
        .filter(instance => instance.archetypeId === archetypeId)
        .reduce((sum, instance) => sum + instance.quantity, 0);
    return { field, engine, actions, inventory, economy, world, deps, shop, house, person, shelf, carriedOf };
}

describe('real stock at a real shop (live)', () => {
    test('a purchase transfers the shop\'s own stock and the money lands on the business — nothing conjured', () => {
        const { actions, inventory, economy, deps, shop, person, shelf, carriedOf } = makeLiveTown();
        economy.adjustPerson('shopper', 100);
        economy.adjustBusiness(shop.getIdentifier(), 0);
        const totalBefore = economy.grandTotal();
        shelf('flour_bag', 1);
        shelf('tomato', 2);
        shelf('cream_jar', 1);
        person.setCurrentBuilding(shop);

        const instancesBefore = Object.keys(inventory.getState().instances).length;
        expect(actions.startAction('shopper', 'bought_groceries', {}, { source: 'brain', causationId: null }, deps(TICK_NOW), result()).ok).toBe(true);
        // The very stock instances changed hands — no new instances entered the world.
        expect(Object.keys(inventory.getState().instances).length).toBe(instancesBefore);
        expect(carriedOf('flour_bag')).toBe(1);
        expect(carriedOf('tomato')).toBe(2);
        expect(carriedOf('cream_jar')).toBe(1);
        // The money moved person → business (18 + 12 + 8) and the town total is conserved.
        expect(economy.getPersonBalance('shopper')).toBe(100 - 38);
        expect(economy.getBusinessBalance(shop.getIdentifier())).toBe(38);
        expect(economy.grandTotal()).toBeCloseTo(totalBefore, 6);
    });

    test('the fallback is RETIRED at a real shop: an empty shelf is a typed failure with zero mutations — and off-map still conjures', () => {
        const { actions, inventory, deps, shop, person } = makeLiveTown();
        person.setCurrentBuilding(shop); // a real shop, but the shelf is bare
        const before = Object.keys(inventory.getState().instances).length;
        expect(actions.startAction('shopper', 'bought_groceries', {}, { source: 'brain', causationId: null }, deps(TICK_NOW), result()).ok).toBe(false);
        expect(Object.keys(inventory.getState().instances).length).toBe(before);

        // Off-map (bootstrap): venues are abstract, the documented fallback still supplies the chain.
        const engine = new EventEngine();
        const bootActions = new ActionEngine(undefined, engine.getLifeLog());
        const bootInventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const bootWorld = new BootstrapWorld(bootInventory);
        bootWorld.register('shopper');
        const bootDeps = {
            state: { worldSeed: 5, people: { shopper: gen('shopper') }, drawSeed: 1, placedIds: [], nextSeq: 5, lastSimulatedYear: 0 } as PopulationState,
            tick: TICK_NOW, ticksPerYear: TPY,
            ctx: { mode: 'bootstrap' as const, world: bootWorld },
            eventEngine: engine, inventory: bootInventory,
        };
        expect(bootActions.startAction('shopper', 'bought_groceries', {}, { source: 'brain', causationId: null }, bootDeps, result()).ok).toBe(true);
        expect(bootInventory.carriedInstances('shopper').some(instance => instance.archetypeId === 'flour_bag')).toBe(true);
    });
});

describe('the flagship: bake_cake completes in live play from shopped ingredients', () => {
    test('shop real stock → carry it home → bake at the oven → a cake exists', () => {
        const { actions, inventory, economy, world, deps, shop, house, person, shelf, carriedOf } = makeLiveTown();
        economy.adjustPerson('shopper', 200);
        // The shelf carries the full grocery run (both purchase discretes are all-or-nothing).
        shelf('flour_bag', 1);
        shelf('tomato', 2);
        shelf('cream_jar', 1);
        shelf('potato', 2);
        shelf('onion', 1);
        shelf('lettuce', 1);
        shelf('egg', 4);
        // The house has its kitchen (the generation essentials — pinned here directly).
        inventory.createInstance({
            archetypeId: 'oven', quantity: 1,
            owner: { kind: 'world' }, container: { kind: 'location', key: `building:${house.getIdentifier()}` },
            tick: TICK_NOW, provenance: null,
        });

        // The shopping trip: real stock only.
        person.setCurrentBuilding(shop);
        expect(actions.startAction('shopper', 'bought_groceries', {}, { source: 'brain', causationId: null }, deps(TICK_NOW), result()).ok).toBe(true);
        expect(actions.startAction('shopper', 'picked_up_fresh_ingredients', {}, { source: 'brain', causationId: null }, deps(TICK_NOW + 1), result()).ok).toBe(true);
        expect(carriedOf('egg')).toBe(4);

        // Home to bake (requirements read the CURRENT location, so the baker heads home first — in play
        // the free-time pick happens at home for the same reason).
        person.setCurrentBuilding(house);
        const start = actions.startAction('shopper', 'bake_cake', {}, { source: 'brain', causationId: null }, deps(TICK_NOW + 2), result());
        expect(start.ok).toBe(true);
        for (let tick = TICK_NOW + 3; tick <= TICK_NOW + 12 && actions.activeInstanceOf('shopper'); tick++) {
            world.pump(tick);
            actions.advance(deps(tick));
        }
        expect(carriedOf('cake')).toBe(1); // the Part-0 audit's blocked flagship, closed on the map
        expect(carriedOf('flour_bag')).toBe(0); // consumed by the mix
        expect(carriedOf('egg')).toBe(2); // two went into the dough
        expect(carriedOf('cream_jar')).toBe(0); // consumed by the topping
    });
});

describe('per-item-optional baskets (W0 / proposal simulation-aliveness-3 P0-1a)', () => {
    test('a partial shelf sells what it has: missing optional items skip, present ones transfer, money matches', () => {
        const { actions, economy, deps, shop, person, shelf, carriedOf } = makeLiveTown();
        economy.adjustPerson('shopper', 100);
        shelf('bread_loaf', 1); // ONLY bread on the shelf — every other basket item skips
        person.setCurrentBuilding(shop);
        expect(actions.startAction('shopper', 'bought_groceries', {}, { source: 'brain', causationId: null }, deps(TICK_NOW), result()).ok).toBe(true);
        expect(carriedOf('bread_loaf')).toBe(1);
        expect(carriedOf('flour_bag')).toBe(0);
        expect(economy.getPersonBalance('shopper')).toBe(100 - 9); // bread only
    });

    test('an all-skipped basket is a TYPED failure and it LOGS (P0-1d) — rate-limited to one entry per window', () => {
        const { actions, engine, deps, shop, person } = makeLiveTown();
        person.setCurrentBuilding(shop); // bare shelf at a real shop: every optional item skips
        expect(actions.startAction('shopper', 'bought_groceries', {}, { source: 'brain', causationId: null }, deps(TICK_NOW), result()).ok).toBe(false);
        const failures = () => engine.getPersonLog('shopper').filter(entry =>
            entry.kind === 'action' && entry.defId === 'bought_groceries' && entry.lifecycle === 'failed' && entry.failureReason === 'inputs_unavailable');
        expect(failures().length).toBe(1);
        // A second attempt inside the window does not spam a second entry…
        expect(actions.startAction('shopper', 'bought_groceries', {}, { source: 'brain', causationId: null }, deps(TICK_NOW + 2), result()).ok).toBe(false);
        expect(failures().length).toBe(1);
        // …but past the window the story continues honestly.
        expect(actions.startAction('shopper', 'bought_groceries', {}, { source: 'brain', causationId: null }, deps(TICK_NOW + 30), result()).ok).toBe(false);
        expect(failures().length).toBe(2);
    });

    test('the solvency floor holds ACROSS the basket: the running planned spend gates later items', () => {
        const { actions, economy, deps, shop, person, shelf, carriedOf } = makeLiveTown();
        economy.adjustPerson('shopper', 5); // ops run potato(5) → onion(3) → …: potato fits, onion no longer does
        shelf('onion', 1);
        shelf('potato', 2);
        person.setCurrentBuilding(shop);
        expect(actions.startAction('shopper', 'picked_up_fresh_ingredients', {}, { source: 'brain', causationId: null }, deps(TICK_NOW), result()).ok).toBe(true);
        expect(carriedOf('potato')).toBe(2); // one shelf instance of quantity 2, price 5
        expect(carriedOf('onion')).toBe(0); // skipped: 5 − 5 already planned < 3
        expect(economy.getPersonBalance('shopper')).toBe(0); // never negative
    });
});

describe('the adjustMoney debit floor (W0 / P1-8)', () => {
    test('an action-side spend the person cannot cover is a typed failure with zero mutations — balances never go negative', () => {
        const { actions, economy, engine, deps, person, shop } = makeLiveTown();
        person.setCurrentBuilding(shop);
        economy.adjustPerson('shopper', 5); // ordered_a_drink costs 8
        expect(actions.startAction('shopper', 'ordered_a_drink', {}, { source: 'brain', causationId: null }, deps(TICK_NOW), result()).ok).toBe(false);
        expect(economy.getPersonBalance('shopper')).toBe(5);
        expect(engine.getPersonLog('shopper').some(entry =>
            entry.kind === 'action' && entry.defId === 'ordered_a_drink' && entry.lifecycle === 'failed' && entry.failureReason === 'inputs_unavailable')).toBe(true);
        // With funds it commits and debits normally.
        economy.adjustPerson('shopper', 10);
        expect(actions.startAction('shopper', 'ordered_a_drink', {}, { source: 'brain', causationId: null }, deps(TICK_NOW + 30), result()).ok).toBe(true);
        expect(economy.getPersonBalance('shopper')).toBe(15 - 8);
    });
});
