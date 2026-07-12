import ActionEngine, { ActionDeps } from 'game/actions/ActionEngine';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import { ActionManifest } from 'types/Action';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { EventManifest, TickResult, ActionLogEntry } from 'types/LifeEvent';
import { Genders } from 'types/Social';

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
    ...(require('json/actions.json') as ActionManifest),
    give_coin: {
        label: 'Gave a coin', type: 'discrete', category: 'social',
        parameters: { target: { type: 'person', required: true } },
        consequences: [{ op: 'transferObject', object: { carried: { archetype: 'coin' } }, owner: 'targetPerson' }],
    },
    lend_coin: {
        label: 'Lent a coin', type: 'discrete', category: 'social',
        parameters: { target: { type: 'person', required: true } },
        consequences: [{ op: 'moveObjectToPerson', object: { carried: { archetype: 'coin' } }, target: 'targetPerson' }],
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

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });
const cause = { source: 'system' as const, causationId: null };

// Consent v2 (task 083): askFirst interactions between graph-strangers accept ~35% per attempt. These are
// consequence-MECHANICS tests, so walk deterministic ticks until one accepts rather than pinning a roll.
function startAccepted(actions: ActionEngine, personId: string, actionId: string, params: Record<string, string>, deps: ActionDeps): boolean {
    for (let tick = deps.tick; tick < deps.tick + 80; tick++) {
        const outcome = actions.startAction(personId, actionId, params, cause, { ...deps, tick }, result());
        if (outcome.ok) {
            return true;
        }
        if (outcome.reason !== 'consentDeclined') {
            return false; // a non-consent failure is a real failure
        }
    }
    return false;
}

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

    test('moveObjectToPerson lends a carried object: possession moves, ownership stays (lent_an_object)', () => {
        const { actions, deps, inventory } = harness();
        const book = inventory.createInstance({ archetypeId: 'book', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        expect(startAccepted(actions, 'a', 'lent_an_object', { target: 'b' }, deps)).toBe(true);
        expect(book.container).toEqual({ kind: 'possessions', personId: 'b' }); // b now carries it
        expect(book.owner).toEqual({ kind: 'person', personId: 'a' }); // a still owns it
    });

    test('returned_borrowed_object hands the specific instance back via a param ref, ownership untouched', () => {
        const { actions, deps, inventory } = harness();
        // b lent a book to a earlier: b owns it, a carries it.
        const book = inventory.createInstance({ archetypeId: 'book', owner: { kind: 'person', personId: 'b' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        expect(startAccepted(actions, 'a', 'returned_borrowed_object', { target: 'b', object: book.id }, deps)).toBe(true);
        expect(book.container).toEqual({ kind: 'possessions', personId: 'b' });
        expect(book.owner).toEqual({ kind: 'person', personId: 'b' });
    });

    test('borrowed_an_object picks up a giftable at the location WITHOUT taking ownership', () => {
        const { actions, deps, inventory } = harness();
        // The friend's book lies at the person's current location ('home' in bootstrap).
        const book = inventory.createInstance({ archetypeId: 'book', owner: { kind: 'person', personId: 'b' }, container: { kind: 'location', key: 'home' }, tick: 0 });
        expect(actions.startAction('a', 'borrowed_an_object', {}, cause, deps, result()).ok).toBe(true);
        expect(book.container).toEqual({ kind: 'possessions', personId: 'a' });
        expect(book.owner).toEqual({ kind: 'person', personId: 'b' }); // still the lender's
    });

    test('moveObjectToPerson fails typed: missing target param / nothing lendable, zero mutations', () => {
        const { engine, actions, deps, inventory } = harness();
        inventory.createInstance({ archetypeId: 'book', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        // target is a required parameter — the start is rejected before planning.
        expect(actions.startAction('a', 'lent_an_object', {}, cause, deps, result())).toEqual({ ok: false, reason: 'missingParameter' });
        // No coin carried → the moveObjectToPerson plan fails atomically and nothing is logged.
        expect(actions.startAction('a', 'lend_coin', { target: 'b' }, cause, deps, result())).toEqual({ ok: false, reason: 'inputsUnavailable' });
        expect(engine.getPersonLog('a')).toHaveLength(0);
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
        // Terminal instances are pruned (task 078); assert completion from the log.
        expect(engine.getPersonLog('a').some(entry => entry.kind === 'action' && entry.instanceId === instanceId && entry.lifecycle === 'completed')).toBe(true);

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

    test('no oven: the parent fails FAST at start (071 requirement) — nothing runs, nothing mixes', () => {
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const h = harness(inventory);
        inventory.createInstance({ archetypeId: 'flour_bag', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        inventory.createInstance({ archetypeId: 'egg', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0, quantity: 2 });
        // Since 071 the parent REQUIRES the oven up front (matching the OAR bake-step context), so a
        // kitchen-less bake never starts — the mid-sequence blockParent path stays covered by the engine
        // suite's fixtures; here the data contract is fail-fast.
        expect(h.actions.startAction('a', 'bake_cake', {}, cause, h.deps, result())).toEqual({ ok: false, reason: 'requirementsUnmet' });
        expect(inventory.carriedInstances('a').some(i => i.archetypeId === 'raw_dough')).toBe(false);
        expect(inventory.carriedInstances('a').some(i => i.archetypeId === 'flour_bag')).toBe(true); // untouched
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
