import ActionEngine, { ActionDeps } from '../src/app/game/ActionEngine';
import EventEngine from '../src/app/game/EventEngine';
import BootstrapWorld from '../src/app/game/BootstrapWorld';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from '../src/app/game/Inventory';

import { ActionManifest } from '../src/types/Action';
import { EventManifest, TickResult, ActionLogEntry } from '../src/types/LifeEvent';
import { PopulationState, GenPerson } from '../src/types/Genealogy';
import { Genders } from '../src/types/Social';

// Action consequences & object-action relationships (task 044): the bounded DSL, atomic application, the
// bake-a-cake chain end-to-end, ownership targets, and provenance/causation chains.

const TPY = 8640;

function person(id: string): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function pool(): PopulationState {
    return { worldSeed: 44, people: { a: person('a'), b: person('b') }, drawSeed: 1, placedIds: [], nextSeq: 100, lastSimulatedYear: 0 };
}

const alive = { where: { attr: 'alive', op: '==', value: true } };
const EVENTS: EventManifest = {
    got_snack: { roles: { subject: alive }, triggers: { manual: {} }, effects: [{ type: 'emit', signal: 'madeFriend', target: 'subject' }] },
    delayed_ping: { roles: { subject: alive }, triggers: { manual: {}, automated: { rules: [] } }, effects: [] },
} as unknown as EventManifest;

// Uses the REAL starter actions/OAR/objects where possible; adds fixtures for op-level coverage.
const ACTIONS: ActionManifest = {
    ...(require('../src/json/actions.json') as ActionManifest),
    give_coin: {
        label: 'Gave a coin', type: 'discrete', category: 'social',
        parameters: { target: { type: 'person', required: true } },
        consequences: [{ op: 'transferObject', object: { carried: { archetype: 'coin' } }, owner: 'targetPerson' }],
    },
    craft_for_work: {
        label: 'Assembled a widget', type: 'discrete', category: 'work',
        consequences: [{ op: 'createObject', archetype: 'toy_car', owner: 'employer', container: 'possessions' }],
    },
    eat_apple: {
        label: 'Ate an apple', type: 'discrete', category: 'recovery',
        consequences: [
            { op: 'consumeObject', object: { carried: { archetype: 'apple' } }, quantity: 1 },
            { op: 'triggerEvent', event: 'got_snack' },
        ],
    },
    plan_reminder: {
        label: 'Set a reminder', type: 'discrete', category: 'maintenance',
        consequences: [{ op: 'scheduleEvent', event: 'delayed_ping', afterTicks: 5 }],
    },
    impossible: {
        label: 'Impossible', type: 'discrete', category: 'leisure',
        consequences: [
            { op: 'createObject', archetype: 'coin' },
            { op: 'consumeObject', object: { carried: { archetype: 'cake' } } }, // no cake carried → whole set aborts
        ],
    },
} as unknown as ActionManifest;

function harness(inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES), employerKeyOf?: (id: string) => string | null) {
    const engine = new EventEngine(EVENTS);
    const world = new BootstrapWorld(inventory);
    const actions = new ActionEngine(ACTIONS, engine.getLifeLog());
    const deps: ActionDeps = {
        state: pool(), tick: 1000, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world },
        eventEngine: engine, inventory, ...(employerKeyOf ? { employerKeyOf } : {}),
    };
    return { engine, world, actions, deps, inventory };
}

const result = (): TickResult => ({ died: [], born: [], signals: [] });
const cause = { source: 'system' as const, causationId: null };

describe('consequence ops', () => {
    test('createObject binds provenance to the committing log entry', () => {
        const { engine, actions, deps, inventory } = harness();
        actions.startAction('a', 'found_coin', {}, cause, deps, result());
        const coin = inventory.possessionsOf('a')[0]!;
        const performed = engine.getPersonLog('a')[0] as ActionLogEntry;
        expect(coin.archetypeId).toBe('coin');
        expect(coin.owner).toEqual({ kind: 'person', personId: 'a' });
        expect(coin.provenance).toBe(performed.seq); // the causation chain reaches the object itself
    });

    test('moveObject + transferObject: pocketing something from the environment', () => {
        const { actions, deps, inventory } = harness();
        const flyer = inventory.createInstance({ archetypeId: 'flyer', owner: { kind: 'world' }, container: { kind: 'location', key: 'home' }, tick: 0 });
        expect(actions.startAction('a', 'pocketed_small_object', {}, cause, deps, result()).ok).toBe(true);
        expect(flyer.container).toEqual({ kind: 'possessions', personId: 'a' });
        expect(flyer.owner).toEqual({ kind: 'person', personId: 'a' });
    });

    test('transferObject to targetPerson moves ownership, not location (a promised gift)', () => {
        const { actions, deps, inventory } = harness();
        const coin = inventory.createInstance({ archetypeId: 'coin', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        expect(actions.startAction('a', 'give_coin', { target: 'b' }, cause, deps, result()).ok).toBe(true);
        expect(coin.owner).toEqual({ kind: 'person', personId: 'b' });
        expect(coin.container).toEqual({ kind: 'possessions', personId: 'a' }); // still physically carried by a
    });

    test('employer ownership resolves through employerKeyOf and fails typed without it', () => {
        const withEmployer = harness(new Inventory(DEFAULT_OBJECT_ARCHETYPES), () => '5-5');
        expect(withEmployer.actions.startAction('a', 'craft_for_work', {}, cause, withEmployer.deps, result()).ok).toBe(true);
        expect(withEmployer.inventory.possessionsOf('a')[0]!.owner).toEqual({ kind: 'business', key: '5-5' });

        const without = harness();
        expect(without.actions.startAction('a', 'craft_for_work', {}, cause, without.deps, result())).toEqual({ ok: false, reason: 'inputsUnavailable' });
    });

    test('consumeObject + triggerEvent: eating fires the manual event with the commit as causation', () => {
        const { engine, actions, deps, inventory } = harness();
        inventory.createInstance({ archetypeId: 'apple', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0, quantity: 2 });
        const out = result();
        actions.startAction('a', 'eat_apple', {}, cause, deps, out);
        expect(inventory.possessionsOf('a')[0]!.quantity).toBe(1);
        const performed = engine.getPersonLog('a').find(e => e.kind === 'action') as ActionLogEntry;
        const event = engine.getPersonLog('a').find(e => e.kind === 'event' && e.defId === 'got_snack')!;
        expect(event).toMatchObject({ triggerSource: 'action', causationId: performed.seq });
        expect(out.signals.some(signal => signal.signal === 'madeFriend')).toBe(true);
    });

    test('scheduleEvent enqueues an automated trigger with the commit as causation', () => {
        const { engine, actions, deps } = harness();
        actions.startAction('a', 'plan_reminder', {}, cause, deps, result());
        expect(engine.getScheduleState().queue[0]).toMatchObject({ eventId: 'delayed_ping', subjectId: 'a', dueTick: 1005 });
        expect(engine.getScheduleState().queue[0]!.causationId).not.toBeNull();
    });

    test('atomicity: one unresolvable op aborts the whole set with zero mutations', () => {
        const { engine, actions, deps, inventory } = harness();
        expect(actions.startAction('a', 'impossible', {}, cause, deps, result())).toEqual({ ok: false, reason: 'inputsUnavailable' });
        expect(inventory.possessionsOf('a')).toHaveLength(0); // the createObject never applied
        expect(engine.getPersonLog('a')).toHaveLength(0); // nothing was logged either
        expect(actions.hasAction('a', 'impossible', 1000)).toBe(false);
    });
});

describe('object-action relationships (the bake chain)', () => {
    function kitchen(): ReturnType<typeof harness> {
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const h = harness(inventory);
        // Ingredients in Possessions; an oven at home (the person's default bootstrap location).
        inventory.createInstance({ archetypeId: 'flour_bag', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        inventory.createInstance({ archetypeId: 'egg', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0, quantity: 3 });
        inventory.createInstance({ archetypeId: 'cream_jar', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        inventory.createInstance({ archetypeId: 'oven', owner: { kind: 'building', key: '1-1' }, container: { kind: 'location', key: 'home' }, tick: 0 });
        return h;
    }

    test('the full sequence turns ingredients into exactly ONE cake, no duplicates', () => {
        const { engine, actions, deps, inventory } = kitchen();
        const outcome = actions.startAction('a', 'bake_cake', {}, cause, deps, result());
        expect(outcome.ok).toBe(true);
        const instanceId = (outcome as { instanceId: string }).instanceId;
        for (let tick = 1001; tick <= 1004; tick++) {
            actions.advance({ ...deps, tick });
        }
        expect(actions.getInstance(instanceId)!.status).toBe('completed');

        const carried = inventory.carriedInstances('a').map(instance => instance.archetypeId).sort();
        // flour + 2 eggs consumed (1 egg left), cream consumed, dough transformed through to ONE cake.
        expect(carried).toEqual(['cake', 'egg']);
        expect(inventory.carriedInstances('a').find(i => i.archetypeId === 'egg')!.quantity).toBe(1);
        expect(carried.filter(id => id === 'cake')).toHaveLength(1);

        // The cake IS the transformed dough instance (identity preserved through the chain) and the log
        // reads as a coherent causation chain: started → mix → bake → top → completed.
        const lifecycle = engine.getPersonLog('a').filter(e => e.kind === 'action').map(e => `${e.defId}:${(e as ActionLogEntry).lifecycle}`);
        expect(lifecycle).toEqual(['bake_cake:started', 'mix_dough:performed', 'bake_dough:performed', 'add_topping:performed', 'bake_cake:completed']);
    });

    test('a missing context object (no oven) blocks the parent at the bake step', () => {
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const h = harness(inventory);
        inventory.createInstance({ archetypeId: 'flour_bag', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        inventory.createInstance({ archetypeId: 'egg', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0, quantity: 2 });
        const outcome = h.actions.startAction('a', 'bake_cake', {}, cause, h.deps, result());
        const instanceId = (outcome as { instanceId: string }).instanceId;
        h.actions.advance({ ...h.deps, tick: 1001 }); // mix succeeds
        h.actions.advance({ ...h.deps, tick: 1002 }); // bake: no oven → inputsUnavailable → blockParent
        expect(h.actions.getInstance(instanceId)!.status).toBe('blocked');
        // The dough exists (mix committed) but was never transformed — no partial bake.
        expect(inventory.carriedInstances('a').some(i => i.archetypeId === 'raw_dough')).toBe(true);
        expect(inventory.carriedInstances('a').some(i => i.archetypeId === 'baked_dough')).toBe(false);
    });

    test('missing ingredients make the first step unsatisfiable (typed, zero mutations)', () => {
        const { actions, deps, inventory } = harness();
        expect(actions.startAction('a', 'mix_dough', {}, cause, deps, result())).toEqual({ ok: false, reason: 'inputsUnavailable' });
        expect(inventory.carriedInstances('a')).toHaveLength(0);
    });

    test('transforming part of a stack splits it', () => {
        const { actions, deps, inventory } = harness();
        inventory.createInstance({ archetypeId: 'raw_dough', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0, quantity: 3 });
        inventory.createInstance({ archetypeId: 'oven', owner: { kind: 'world' }, container: { kind: 'location', key: 'home' }, tick: 0 });
        expect(actions.startAction('a', 'bake_dough', {}, cause, deps, result()).ok).toBe(true);
        const kinds = inventory.carriedInstances('a').map(i => [i.archetypeId, i.quantity]);
        expect(kinds).toContainEqual(['raw_dough', 2]);
        expect(kinds).toContainEqual(['baked_dough', 1]);
    });
});
