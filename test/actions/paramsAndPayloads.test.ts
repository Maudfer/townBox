import ActionEngine, { ActionDeps } from 'game/actions/ActionEngine';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import Inventory from 'game/objects/Inventory';
import { notificationForSignal } from 'util/notifications';

import { ActionManifest } from 'types/Action';
import { EventManifest, TickResult, EventLogEntry } from 'types/LifeEvent';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { Genders } from 'types/Social';
import { ObjectArchetype } from 'types/Objects';

// Parameterized requirements & event payloads (task 067): archetypeParam object queries, the typed event
// payload channel (invoke → log entry → signals → feed), and the action→event payload bridge.

const TPY = 8640;

const ARCHETYPES: Record<string, ObjectArchetype> = {
    pencil: { label: 'Pencil', category: 'stationery', size: { w: 1, d: 1, h: 14 }, weightGrams: 8, flags: { carryable: true, pocketable: true, stackable: true, consumable: false, equippable: false, placeable: false }, tags: [] },
    stapler: { label: 'Stapler', category: 'stationery', size: { w: 6, d: 3, h: 4 }, weightGrams: 250, flags: { carryable: true, pocketable: false, stackable: false, consumable: false, equippable: false, placeable: true }, tags: [] },
} as unknown as Record<string, ObjectArchetype>;

const alive = { where: { attr: 'alive', op: '==', value: true } };

const EVENTS: EventManifest = {
    object_acquired: {
        label: 'Acquired an object',
        roles: { subject: alive },
        triggers: { manual: {} },
        parameters: { object: { type: 'string', required: true }, bought: { type: 'boolean' } },
        effects: [{ type: 'emit', signal: 'hired', target: 'subject' }], // any known signal works for the ride-along test
    },
    no_params_event: { roles: { subject: alive }, triggers: { manual: {} }, effects: [] },
} as unknown as EventManifest;

const ACTIONS: ActionManifest = {
    // The generic verb the sweep (068) will author: requires THE PASSED archetype at the location.
    grab: {
        label: 'Grabbed something', type: 'discrete', category: 'maintenance',
        parameters: { object: { type: 'objectArchetype', required: true } },
        requirements: { objectAtLocation: { archetypeParam: 'object' } },
        events: { onComplete: { event: 'object_acquired', params: { object: '$params.object', bought: false } } },
    },
} as unknown as ActionManifest;

function pool(): PopulationState {
    const person: GenPerson = { id: 'a', firstName: 'A', familyName: 'F', gender: Genders.Female, birthTick: -30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
    return { worldSeed: 5, people: { a: person }, drawSeed: 1, placedIds: [], nextSeq: 10, lastSimulatedYear: 0 };
}

function harness() {
    const inventory = new Inventory(ARCHETYPES);
    const world = new BootstrapWorld(inventory);
    const engine = new EventEngine(EVENTS);
    const actions = new ActionEngine(ACTIONS, engine.getLifeLog());
    const deps: ActionDeps = { state: pool(), tick: 50, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world }, eventEngine: engine, inventory };
    return { inventory, world, engine, actions, deps };
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });
const cause = { source: 'system' as const, causationId: null };

describe('param-aware object queries (archetypeParam)', () => {
    test('grab(object=pencil) requires a pencil at the location — satisfied and unsatisfied both ways', () => {
        const { inventory, actions, deps } = harness();
        // A pencil lies at the person's location (bootstrap default: home).
        inventory.createInstance({ archetypeId: 'pencil', owner: { kind: 'none' }, container: { kind: 'location', key: 'home' }, tick: 0 });

        expect(actions.startAction('a', 'grab', { object: 'pencil' }, cause, deps, result()).ok).toBe(true);
        // Asking for a stapler that isn't there fails the requirement.
        const missing = actions.startAction('a', 'grab', { object: 'stapler' }, cause, deps, result());
        expect(missing).toEqual({ ok: false, reason: 'requirementsUnmet' });
    });

    test('a param-referencing requirement without the required param is a typed missingParameter failure', () => {
        const { actions, deps } = harness();
        expect(actions.startAction('a', 'grab', {}, cause, deps, result())).toEqual({ ok: false, reason: 'missingParameter' });
    });
});

describe('event payloads', () => {
    test('a valid payload commits into the log entry and rides the signal to the feed builder', () => {
        const { engine } = harness();
        const tickResult = result();
        const { outcome, result: invokeResult } = engine.invoke(pool(), 'object_acquired', 'a', 50, TPY, cause, {}, {}, { object: 'pencil', bought: true });
        expect(outcome.ok).toBe(true);

        const entry = engine.getPersonLog('a').find(logEntry => logEntry.kind === 'event' && logEntry.defId === 'object_acquired') as EventLogEntry;
        expect(entry.params).toEqual({ object: 'pencil', bought: true });
        // The payload rides the emitted signal…
        expect(invokeResult.signals[0]!.params).toEqual({ object: 'pencil', bought: true });
        // …and reaches the feed builder untouched (builders may interpolate it).
        expect(notificationForSignal('hired', 'A', invokeResult.signals[0]!.params)).not.toBeNull();
        void tickResult;
    });

    test('invalid payloads are typed rejections that never commit', () => {
        const { engine } = harness();
        // Missing REQUIRED param.
        expect(engine.invoke(pool(), 'object_acquired', 'a', 50, TPY, cause, {}, {}, { bought: true }).outcome)
            .toEqual({ ok: false, reason: 'invalidParams' });
        // Wrong scalar type.
        expect(engine.invoke(pool(), 'object_acquired', 'a', 50, TPY, cause, {}, {}, { object: 42 }).outcome)
            .toEqual({ ok: false, reason: 'invalidParams' });
        // Unknown key.
        expect(engine.invoke(pool(), 'no_params_event', 'a', 50, TPY, cause, {}, {}, { rogue: 'x' }).outcome)
            .toEqual({ ok: false, reason: 'invalidParams' });
        expect(engine.getPersonLog('a')).toHaveLength(0);
    });
});

describe('the action → event payload bridge', () => {
    test('onComplete forwards $params mappings and literals into the event payload with causation intact', () => {
        const { inventory, actions, engine, deps } = harness();
        inventory.createInstance({ archetypeId: 'pencil', owner: { kind: 'none' }, container: { kind: 'location', key: 'home' }, tick: 0 });

        const start = actions.startAction('a', 'grab', { object: 'pencil' }, cause, deps, result());
        expect(start.ok).toBe(true);

        const log = engine.getPersonLog('a');
        const performed = log.find(entry => entry.kind === 'action' && entry.defId === 'grab')!;
        const acquired = log.find(entry => entry.kind === 'event' && entry.defId === 'object_acquired') as EventLogEntry;
        expect(acquired).toBeDefined();
        expect(acquired.params).toEqual({ object: 'pencil', bought: false });
        expect(acquired.triggerSource).toBe('action');
        expect(acquired.causationId).toBe(performed.seq);
    });
});

describe('the shipped generic verbs (task 068, real manifests)', () => {
    function realHarness() {
        const inventory = new Inventory(); // real objects.json archetypes
        const world = new BootstrapWorld(inventory);
        const engine = new EventEngine(); // real events.json
        const actions = new ActionEngine(undefined, engine.getLifeLog()); // real actions.json
        const deps: ActionDeps = { state: pool(), tick: 50, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world }, eventEngine: engine, inventory };
        return { inventory, engine, actions, deps };
    }

    test('grab -> put_down -> grab -> discard moves ONE real instance end to end (never conjured)', () => {
        const { inventory, engine, actions, deps } = realHarness();
        const pencil = inventory.createInstance({ archetypeId: 'pencil', owner: { kind: 'none' }, container: { kind: 'location', key: 'home' }, tick: 0 });

        expect(actions.startAction('a', 'grab', { object: 'pencil' }, cause, deps, result()).ok).toBe(true);
        expect(inventory.possessionsOf('a').map(instance => instance.id)).toEqual([pencil.id]);
        expect(inventory.getInstance(pencil.id)!.owner).toEqual({ kind: 'person', personId: 'a' });
        // The generic parameterized event narrates it.
        const acquired = engine.getPersonLog('a').find(entry => entry.kind === 'event' && entry.defId === 'object_acquired');
        expect((acquired as { params?: Record<string, unknown> }).params).toEqual({ object: 'pencil' });

        expect(actions.startAction('a', 'put_down', { object: 'pencil' }, cause, deps, result()).ok).toBe(true);
        expect(inventory.getInstance(pencil.id)!.container).toEqual({ kind: 'location', key: 'home' });
        expect(inventory.getInstance(pencil.id)!.owner).toEqual({ kind: 'person', personId: 'a' }); // still theirs

        expect(actions.startAction('a', 'grab', { object: 'pencil' }, cause, deps, result()).ok).toBe(true);
        expect(actions.startAction('a', 'discard_object', { object: 'pencil' }, cause, deps, result()).ok).toBe(true);
        expect(inventory.getInstance(pencil.id)!.owner).toEqual({ kind: 'world' });
        expect(engine.getPersonLog('a').some(entry => entry.kind === 'event' && entry.defId === 'object_lost')).toBe(true);
        // Exactly one pencil instance ever existed.
        expect(inventory.getState().instances[pencil.id]).toBeDefined();
        expect(Object.keys(inventory.getState().instances)).toHaveLength(1);
    });

    test('grab refuses non-carryable archetypes (a real refrigerator stays put)', () => {
        const { inventory, actions, deps } = realHarness();
        inventory.createInstance({ archetypeId: 'refrigerator', owner: { kind: 'none' }, container: { kind: 'location', key: 'home' }, tick: 0 });
        expect(actions.startAction('a', 'grab', { object: 'refrigerator' }, cause, deps, result()))
            .toEqual({ ok: false, reason: 'requirementsUnmet' });
        expect(inventory.possessionsOf('a')).toHaveLength(0);
    });
});
