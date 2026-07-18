import ActionEngine, { ActionDeps } from 'game/actions/ActionEngine';
import Economy from 'game/economy/Economy';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import { ActionManifest, OARTable } from 'types/Action';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { EventManifest, TickResult } from 'types/LifeEvent';
import { Genders } from 'types/Social';

// Materialized retail (task 089 / proposal F3): purchaseObject prefers real business stock (ownership +
// possession move, money person → business, netting counters), falls back to conjuring, and production
// halts at the stock ceiling so shelves can't become the audit's 12k-dough mountain.

const TPY = 8640;

function person(id: string): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

const ACTIONS = {
    buy_bread: {
        label: 'Bought bread', type: 'discrete', category: 'maintenance',
        consequences: [{ op: 'purchaseObject', query: { archetype: 'bread_loaf' }, price: 7, fallback: 'bread_loaf' }],
    },
    buy_rare: {
        label: 'Bought a rarity', type: 'discrete', category: 'maintenance',
        consequences: [{ op: 'purchaseObject', query: { archetype: 'toolbox' }, price: 45 }], // no fallback
    },
    bake: {
        label: 'Baked bread', type: 'discrete', category: 'work',
    },
} as unknown as ActionManifest;

const OAR: OARTable = {
    bake_output: {
        action: 'bake',
        inputs: [],
        outputs: [{ archetype: 'bread_loaf', owner: 'employer', container: 'location' }],
    },
} as unknown as OARTable;

function harness() {
    const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
    const world = new BootstrapWorld(inventory);
    const engine = new EventEngine({} as EventManifest);
    const actions = new ActionEngine(ACTIONS, engine.getLifeLog(), OAR);
    const economy = new Economy();
    economy.setPersonBalance('a', 100);
    const state: PopulationState = { worldSeed: 21, people: { a: person('a') }, drawSeed: 1, placedIds: [], nextSeq: 10, lastSimulatedYear: 0 };
    world.register('a');
    const deps: ActionDeps = {
        state, tick: 100, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world, markets: { ledger: economy } },
        eventEngine: engine, inventory, employerKeyOf: () => '7-7',
    };
    return { engine, actions, economy, inventory, world, deps };
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });
const cause = { source: 'system' as const, causationId: null };

describe('purchaseObject (F3)', () => {
    test('real stock: ownership + possession move to the buyer, money moves person → business, counters record', () => {
        const { actions, economy, inventory, deps } = harness();
        const stock = inventory.createInstance({ archetypeId: 'bread_loaf', owner: { kind: 'business', key: '7-7' }, container: { kind: 'location', key: 'home' }, tick: 0 });
        const grandBefore = economy.grandTotal();

        expect(actions.startAction('a', 'buy_bread', {}, cause, deps, result()).ok).toBe(true);
        expect(inventory.getInstance(stock.id)!.owner).toEqual({ kind: 'person', personId: 'a' });
        expect(inventory.getInstance(stock.id)!.container).toEqual({ kind: 'possessions', personId: 'a' });
        expect(economy.getPersonBalance('a')).toBe(93);
        expect(economy.getBusinessBalance('7-7')).toBe(7);
        expect(economy.grandTotal()).toBe(grandBefore); // a pure transfer — conserved
        expect(economy.drainMaterializedSales()).toEqual({ '7-7': 7 });
        expect(economy.drainMaterializedSpend()).toEqual({ a: 7 });
    });

    test('no stock: the fallback conjures (071 posture) with a one-sided spend, still conserved', () => {
        const { actions, economy, inventory, deps } = harness();
        const grandBefore = economy.grandTotal();
        expect(actions.startAction('a', 'buy_bread', {}, cause, deps, result()).ok).toBe(true);
        expect(inventory.carriedInstances('a').some(instance => instance.archetypeId === 'bread_loaf')).toBe(true);
        expect(economy.getPersonBalance('a')).toBe(93);
        expect(economy.getBusinessBalance('7-7')).toBe(0);
        expect(economy.grandTotal()).toBe(grandBefore); // external absorbed it
        expect(economy.drainMaterializedSpend()).toEqual({ a: 7 });
    });

    test('no stock and no fallback: a typed plan failure with zero mutations', () => {
        const { actions, economy, deps } = harness();
        expect(actions.startAction('a', 'buy_rare', {}, cause, deps, result()))
            .toEqual({ ok: false, reason: 'inputsUnavailable' });
        expect(economy.getPersonBalance('a')).toBe(100);
    });

    // The solvency floor (LP-4 / P1-5): retail used to overdraft freely — balances drifted negative within
    // days of live play. Being broke is a typed failure now, never a negative balance.
    test('an unaffordable purchase fails typed and moves no money (the solvency floor)', () => {
        const { actions, economy, inventory, deps } = harness();
        economy.setPersonBalance('a', 3); // price is 7
        inventory.createInstance({ archetypeId: 'bread_loaf', owner: { kind: 'business', key: '7-7' }, container: { kind: 'location', key: 'home' }, tick: 0 });
        expect(actions.startAction('a', 'buy_bread', {}, cause, deps, result()))
            .toEqual({ ok: false, reason: 'inputsUnavailable' });
        expect(economy.getPersonBalance('a')).toBe(3);
        expect(inventory.carriedInstances('a')).toHaveLength(0);
    });
});

describe('the stock ceiling (F3)', () => {
    test('production halts at a full shelf and resumes when it drains', () => {
        const { actions, inventory, deps } = harness();
        // Fill the shelf to the ceiling (60).
        for (let i = 0; i < 60; i++) {
            inventory.createInstance({ archetypeId: 'bread_loaf', owner: { kind: 'business', key: '7-7' }, container: { kind: 'location', key: 'building:7-7' }, tick: 0 });
        }
        expect(actions.startAction('a', 'bake', {}, cause, deps, result()))
            .toEqual({ ok: false, reason: 'inputsUnavailable' });

        // A sale drains one — production resumes.
        const one = inventory.instancesOwnedBy({ kind: 'business', key: '7-7' })[0]!;
        inventory.removeInstance(one.id);
        expect(actions.startAction('a', 'bake', {}, cause, deps, result()).ok).toBe(true);
    });
});
