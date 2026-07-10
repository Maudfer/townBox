import ActionEngine, { ActionDeps, interleave } from '../src/app/game/ActionEngine';
import EventEngine from '../src/app/game/EventEngine';
import BootstrapWorld from '../src/app/game/BootstrapWorld';
import Inventory from '../src/app/game/Inventory';

import { ActionManifest } from '../src/types/Action';
import { EventManifest, TickResult, ActionLogEntry } from '../src/types/LifeEvent';
import { PopulationState, GenPerson } from '../src/types/Genealogy';
import { Genders, Gender } from '../src/types/Social';
import { WorldAdapter, TransitionHandle, LogicalLocation } from '../src/types/Execution';

// The Action engine (task 043): discrete commits, the continuous lifecycle (incl. the materialization wait
// behind the execution boundary), pool/sequence children, lifecycle-fired manual Events, and determinism.

const TPY = 8640;

function gen(id: string, gender: Gender, ageYears: number, tickNow: number): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender, birthTick: tickNow - ageYears * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function pool(tickNow: number): PopulationState {
    return {
        worldSeed: 33,
        people: { a: gen('a', Genders.Female, 30, tickNow), b: gen('b', Genders.Male, 8, tickNow) },
        drawSeed: 1, placedIds: [], nextSeq: 100, lastSimulatedYear: 0,
    };
}

const alive = { where: { attr: 'alive', op: '==', value: true } };

const EVENTS: EventManifest = {
    started_working: { label: 'Started working', roles: { subject: alive }, triggers: { manual: {} }, effects: [{ type: 'emit', signal: 'hired', target: 'subject' }] },
    stopped_working: { label: 'Stopped working', roles: { subject: alive }, triggers: { manual: {} }, effects: [] },
    was_interrupted: { roles: { subject: alive }, triggers: { manual: {} }, effects: [] },
} as unknown as EventManifest;

const ACTIONS: ActionManifest = {
    // Discrete with an object requirement.
    grab_pencil: { label: 'Grabbed a pencil', type: 'discrete', category: 'maintenance', requirements: { objectAtLocation: { archetype: 'pencil' } } },
    stretch: { label: 'Stretched', type: 'discrete', category: 'recovery' },
    hum: { label: 'Hummed a tune', type: 'discrete', category: 'leisure' },
    // Continuous work action with lifecycle events + duration.
    work_shift: {
        label: 'Working', type: 'continuous', category: 'work', durationTicks: 3,
        events: { onStart: 'started_working', onComplete: 'stopped_working', onInterrupt: 'was_interrupted' },
    },
    // Continuous with a required location (exercises the boundary).
    nap_at_home: { label: 'Napping', type: 'continuous', category: 'recovery', location: 'home', durationTicks: 2 },
    // Continuous with adult-only requirements.
    adult_thing: { label: 'Doing taxes', type: 'continuous', category: 'obligation', durationTicks: 1, requirements: { attr: 'age', op: '>=', value: 18 } },
    // Pool parent: two always-firing children (interleaving) + a gated child.
    play_outside: {
        label: 'Playing outside', type: 'continuous', category: 'leisure', durationTicks: 2,
        children: { mode: 'pool', entries: [
            { action: 'stretch', chancePerTick: 1, maxPerTick: 2 },
            { action: 'hum', chancePerTick: 1, maxPerTick: 2 },
            { action: 'grab_pencil', chancePerTick: 1 },
        ] },
    },
    // Pool parent with cooldown/maxTotal bookkeeping.
    idle_about: {
        label: 'Idling', type: 'continuous', category: 'leisure', durationTicks: 5,
        children: { mode: 'pool', entries: [{ action: 'stretch', chancePerTick: 1, cooldownTicks: 2, maxTotal: 2 }] },
    },
    // Sequence parent with a $parent binding and blockParent policy.
    bake: {
        label: 'Baking', type: 'continuous', category: 'maintenance',
        parameters: { recipe: { type: 'recipe', required: true } },
        children: { mode: 'sequence', onStepFailure: 'blockParent', steps: [
            { action: 'mix', params: { recipe: '$parent.recipe' } },
            { action: 'grab_pencil' }, // fails without a pencil at the location → blocks the parent
            { action: 'stretch' },
        ] },
    },
    mix: { label: 'Mixed', type: 'discrete', category: 'maintenance', parameters: { recipe: { type: 'recipe' } } },
    needs_history: { label: 'Reminisced', type: 'discrete', category: 'leisure', requirements: { hasAction: 'stretch', minCount: 2 } },
} as unknown as ActionManifest;

function makeDeps(state: PopulationState, tick: number, world: WorldAdapter = new BootstrapWorld(), inventory: Inventory | null = null): { deps: ActionDeps; engine: EventEngine; actions: ActionEngine } {
    const engine = new EventEngine(EVENTS);
    const actions = new ActionEngine(ACTIONS, engine.getLifeLog());
    const deps: ActionDeps = { state, tick, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world }, eventEngine: engine, inventory };
    return { deps, engine, actions };
}

const emptyResult = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });
const cause = { source: 'system' as const, causationId: null };

function actionEntries(engine: EventEngine, personId: string): ActionLogEntry[] {
    return engine.getPersonLog(personId).filter((entry): entry is ActionLogEntry => entry.kind === 'action');
}

describe('discrete actions', () => {
    test('commit immediately with a performed entry, params snapshot, and aggregate history', () => {
        const state = pool(1000);
        const { deps, engine, actions } = makeDeps(state, 1000);
        const outcome = actions.startAction('a', 'mix', { recipe: 'cake' }, { source: 'brain', causationId: 5 }, deps, emptyResult());
        expect(outcome).toMatchObject({ ok: true, instanceId: null });
        expect(actionEntries(engine, 'a')[0]).toMatchObject({ lifecycle: 'performed', defId: 'mix', params: { recipe: 'cake' }, triggerSource: 'brain', causationId: 5 });
        expect(actions.hasAction('a', 'mix', 1000)).toBe(true);
    });

    test('requirements gate: objectAtLocation is false without inventory/world backing, true with it', () => {
        const state = pool(1000);
        const bare = makeDeps(state, 1000);
        expect(bare.actions.startAction('a', 'grab_pencil', {}, cause, bare.deps, emptyResult())).toEqual({ ok: false, reason: 'requirementsUnmet' });

        const inventory = new Inventory();
        const world = new BootstrapWorld(inventory);
        inventory.createInstance({ archetypeId: 'pencil', owner: { kind: 'world' }, container: { kind: 'location', key: 'home' }, tick: 0 });
        const rich = makeDeps(state, 1000, world, inventory);
        // Person 'a' is at 'home' by default in the bootstrap world; the pencil is there.
        expect(rich.actions.startAction('a', 'grab_pencil', {}, cause, rich.deps, emptyResult()).ok).toBe(true);
    });

    test('missing required parameters are typed failures', () => {
        const state = pool(1000);
        const { deps, actions } = makeDeps(state, 1000);
        expect(actions.startAction('a', 'bake', {}, cause, deps, emptyResult())).toEqual({ ok: false, reason: 'missingParameter' });
    });
});

describe('continuous lifecycle', () => {
    test('runs for durationTicks then completes, firing onStart/onComplete manual events with causation', () => {
        const state = pool(1000);
        const { deps, engine, actions } = makeDeps(state, 1000);
        const result = emptyResult();
        const outcome = actions.startAction('a', 'work_shift', {}, { source: 'brain', causationId: null }, deps, result);
        expect(outcome.ok).toBe(true);

        const started = actionEntries(engine, 'a').find(entry => entry.lifecycle === 'started')!;
        const startedEvent = engine.getPersonLog('a').find(entry => entry.kind === 'event' && entry.defId === 'started_working')!;
        expect(startedEvent).toMatchObject({ triggerSource: 'action', causationId: started.seq });
        expect(result.signals[0]).toMatchObject({ signal: 'hired' }); // event signals flow to the caller

        for (let tick = 1001; tick <= 1003; tick++) {
            actions.advance({ ...deps, tick });
        }
        const completed = actionEntries(engine, 'a').find(entry => entry.lifecycle === 'completed')!;
        // Terminal instances are pruned (task 078); the log is the source of truth for the outcome.
        expect(completed).toMatchObject({ instanceId: (outcome as { instanceId: string }).instanceId, tick: 1003 });
        const stoppedEvent = engine.getPersonLog('a').find(entry => entry.kind === 'event' && entry.defId === 'stopped_working')!;
        expect(stoppedEvent.causationId).toBe(completed.seq);
    });

    test('one active continuous instance per person; requirements gate continuous starts too', () => {
        const state = pool(1000);
        const { deps, actions } = makeDeps(state, 1000);
        expect(actions.startAction('a', 'work_shift', {}, cause, deps, emptyResult()).ok).toBe(true);
        expect(actions.startAction('a', 'play_outside', {}, cause, deps, emptyResult())).toEqual({ ok: false, reason: 'alreadyActive' });
        // 'b' is 8 years old: adult-only requirements reject.
        expect(actions.startAction('b', 'adult_thing', {}, cause, deps, emptyResult())).toEqual({ ok: false, reason: 'requirementsUnmet' });
    });

    test('terminal instances are pruned; the active index frees the person and survives a load (task 078)', () => {
        const state = pool(1000);
        const { deps, actions } = makeDeps(state, 1000);
        const outcome = actions.startAction('a', 'work_shift', {}, cause, deps, emptyResult());
        const instanceId = (outcome as { instanceId: string }).instanceId;
        // While active it is indexed and blocks a second continuous action.
        expect(actions.activeInstanceOf('a')?.id).toBe(instanceId);
        // A load rebuilds the active index from state, so the person is still found as active.
        actions.loadState(actions.getState());
        expect(actions.activeInstanceOf('a')?.id).toBe(instanceId);
        // Run to completion (work_shift has a short duration): the instance is pruned and the person freed.
        for (let tick = 1001; tick <= 1003; tick++) {
            actions.advance({ ...deps, tick });
        }
        expect(actions.activeInstanceOf('a')).toBeNull();
        expect(actions.getInstance(instanceId)).toBeNull(); // pruned from state.instances
        expect(actions.startAction('a', 'play_outside', {}, cause, deps, emptyResult()).ok).toBe(true);
    });

    test('interruption logs and fires onInterrupt', () => {
        const state = pool(1000);
        const { deps, engine, actions } = makeDeps(state, 1000);
        const outcome = actions.startAction('a', 'work_shift', {}, cause, deps, emptyResult());
        const instanceId = (outcome as { instanceId: string }).instanceId;
        expect(actions.interrupt(instanceId, { source: 'brain', causationId: 9 }, { ...deps, tick: 1001 }, emptyResult())).toBe(true);
        expect(actionEntries(engine, 'a').find(entry => entry.lifecycle === 'interrupted')).toMatchObject({ instanceId, tick: 1001 });
        expect(engine.getPersonLog('a').some(entry => entry.kind === 'event' && entry.defId === 'was_interrupted')).toBe(true);
    });

    test('bootstrap mode: a location-requiring action starts the same tick (immediate materialization)', () => {
        const state = pool(1000);
        const world = new BootstrapWorld();
        world.requestTransition('a', { kind: 'outside' }, 999, null); // person starts away from home
        const { deps, actions } = makeDeps(state, 1000, world);
        const outcome = actions.startAction('a', 'nap_at_home', {}, cause, deps, emptyResult());
        expect(outcome.ok).toBe(true);
        const instance = actions.getInstance((outcome as { instanceId: string }).instanceId)!;
        expect(instance.status).toBe('running'); // transition resolved immediately; 'started' logged this tick
    });

    test('live-style pending transition parks the instance in waiting_for_materialization until arrival', () => {
        const state = pool(1000);
        // A minimal fake world whose transitions stay pending until we flip them.
        let handle: TransitionHandle | null = null;
        let location: LogicalLocation = { kind: 'outside' };
        const world: WorldAdapter = {
            mode: 'live',
            locationOf: () => location,
            objectLocationOf: () => location,
            peopleAt: () => [],
            objectsAt: () => [],
            requestTransition: (personId, target, tick, causationId) => {
                handle = { id: 0, personId, target, status: 'pending', requestedAtTick: tick, resolvedAtTick: null, causationId };
                return handle;
            },
        };
        const { deps, engine, actions } = makeDeps(state, 1000, world);
        const outcome = actions.startAction('a', 'nap_at_home', {}, cause, deps, emptyResult());
        const instance = actions.getInstance((outcome as { instanceId: string }).instanceId)!;
        expect(instance.status).toBe('waiting_for_materialization');
        expect(actionEntries(engine, 'a')).toHaveLength(0); // nothing logged until the action actually starts

        actions.advance({ ...deps, tick: 1001 });
        expect(instance.status).toBe('waiting_for_materialization'); // still commuting

        handle!.status = 'arrived';
        location = { kind: 'home' };
        actions.advance({ ...deps, tick: 1002 });
        expect(instance.status).toBe('running');
        expect(actionEntries(engine, 'a')[0]).toMatchObject({ lifecycle: 'started', tick: 1002 });
    });
});

describe('pool children', () => {
    test('occurrences interleave: identical children never run consecutively while others are available', () => {
        const state = pool(1000);
        const { deps, engine, actions } = makeDeps(state, 1000);
        actions.startAction('a', 'play_outside', {}, cause, deps, emptyResult());
        actions.advance({ ...deps, tick: 1001 });

        const performed = actionEntries(engine, 'a').filter(entry => entry.lifecycle === 'performed').map(entry => entry.defId);
        // stretch ×2 and hum ×2 are certainties; grab_pencil is requirement-gated off (no pencil anywhere).
        expect(performed.filter(id => id === 'stretch')).toHaveLength(2);
        expect(performed.filter(id => id === 'hum')).toHaveLength(2);
        for (let i = 1; i < performed.length; i++) {
            expect(performed[i]).not.toBe(performed[i - 1]);
        }
    });

    test('cooldowns and maxTotal bound occurrences across the parent lifetime', () => {
        const state = pool(1000);
        const { deps, engine, actions } = makeDeps(state, 1000);
        actions.startAction('a', 'idle_about', {}, cause, deps, emptyResult());
        for (let tick = 1001; tick <= 1005; tick++) {
            actions.advance({ ...deps, tick });
        }
        // chancePerTick 1 over 5 ticks, but cooldown 2 spaces occurrences and maxTotal 2 caps them.
        const stretches = actionEntries(engine, 'a').filter(entry => entry.defId === 'stretch' && entry.lifecycle === 'performed');
        expect(stretches).toHaveLength(2);
        expect(stretches[1]!.tick - stretches[0]!.tick).toBeGreaterThanOrEqual(2);
        // Children carry the parent's start entry as causation and its instance id as parent.
        const parentStart = actionEntries(engine, 'a').find(entry => entry.lifecycle === 'started')!;
        expect(stretches[0]).toMatchObject({ parentInstanceId: parentStart.instanceId, causationId: parentStart.seq });
    });
});

describe('sequence children', () => {
    test('steps run one per tick with $parent bindings; a failing step blocks the parent', () => {
        const state = pool(1000);
        const { deps, engine, actions } = makeDeps(state, 1000);
        const outcome = actions.startAction('a', 'bake', { recipe: 'carrot_cake' }, cause, deps, emptyResult());
        const instanceId = (outcome as { instanceId: string }).instanceId;

        actions.advance({ ...deps, tick: 1001 }); // step 1: mix (binds $parent.recipe)
        const mixed = actionEntries(engine, 'a').find(entry => entry.defId === 'mix')!;
        expect(mixed.params).toEqual({ recipe: 'carrot_cake' });

        actions.advance({ ...deps, tick: 1002 }); // step 2: grab_pencil — no pencil → blockParent
        // Terminal instances are pruned (task 078); assert the blocked outcome from the log.
        expect(actionEntries(engine, 'a').find(entry => entry.lifecycle === 'blocked')).toMatchObject({ instanceId });
        // The blocked step never ran and neither did the step after it.
        expect(actionEntries(engine, 'a').some(entry => entry.defId === 'stretch')).toBe(false);
    });

    test('skipStep policy carries the sequence to completion past failing steps', () => {
        const skipManifest = {
            ...ACTIONS,
            bake: { ...(ACTIONS as Record<string, object>)['bake'], children: { mode: 'sequence', onStepFailure: 'skipStep', steps: [
                { action: 'mix', params: { recipe: '$parent.recipe' } },
                { action: 'grab_pencil' },
                { action: 'stretch' },
            ] } },
        } as unknown as ActionManifest;
        const state = pool(1000);
        const engine = new EventEngine(EVENTS);
        const actions = new ActionEngine(skipManifest, engine.getLifeLog());
        const deps: ActionDeps = { state, tick: 1000, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world: new BootstrapWorld() }, eventEngine: engine, inventory: null };
        const outcome = actions.startAction('a', 'bake', { recipe: 'x' }, cause, deps, emptyResult());
        for (let tick = 1001; tick <= 1004; tick++) {
            actions.advance({ ...deps, tick });
        }
        expect(actionEntries(engine, 'a').find(entry => entry.lifecycle === 'completed')).toMatchObject({ instanceId: (outcome as { instanceId: string }).instanceId });
        expect(actionEntries(engine, 'a').some(entry => entry.defId === 'stretch')).toBe(true);
    });
});

describe('shared requirements & determinism', () => {
    test('hasAction requirements read the action aggregate', () => {
        const state = pool(1000);
        const { deps, actions } = makeDeps(state, 1000);
        expect(actions.startAction('a', 'needs_history', {}, cause, deps, emptyResult())).toEqual({ ok: false, reason: 'requirementsUnmet' });
        actions.startAction('a', 'stretch', {}, cause, deps, emptyResult());
        actions.startAction('a', 'stretch', {}, cause, deps, emptyResult());
        expect(actions.startAction('a', 'needs_history', {}, cause, deps, emptyResult()).ok).toBe(true);
    });

    // The per-context memo (task 079): a single context caches its attribute / objects-here / carried-list
    // reads so a candidate loop doesn't recompute them per candidate. It must be per-context — a FRESH context
    // reflects current state (no global leak) — and stable WITHIN a context.
    test('contextFor memo: stable within a context, fresh across contexts (no leak)', () => {
        const state = pool(1000);
        const inventory = new Inventory();
        const world = new BootstrapWorld(inventory);
        inventory.createInstance({ archetypeId: 'pencil', owner: { kind: 'world' }, container: { kind: 'location', key: 'home' }, tick: 0 });
        const { deps, actions } = makeDeps(state, 1000, world, inventory);

        const ctx1 = actions.contextFor('a', deps);
        // Repeated identical queries are stable within one context (the memo path).
        expect(ctx1.objectAtLocation!({ archetype: 'pencil' })).toBe(true);
        expect(ctx1.objectAtLocation!({ archetype: 'pencil' })).toBe(true);
        expect(ctx1.getAttr('age')).toBe(ctx1.getAttr('age'));
        expect(ctx1.getAttr('age')).toBe(30);

        // A different backing (no pencil) → a fresh context sees the new state; the earlier memo never leaks.
        const emptyInv = new Inventory();
        const emptyDeps = makeDeps(state, 1000, new BootstrapWorld(emptyInv), emptyInv).deps;
        expect(actions.contextFor('a', emptyDeps).objectAtLocation!({ archetype: 'pencil' })).toBe(false);
        // And the original context still reads its own (memoized) backing — proving isolation, not mutation.
        expect(ctx1.objectAtLocation!({ archetype: 'pencil' })).toBe(true);
    });

    // The engine-level object-query cache (task 079 pass 2) is validated against the location's container
    // epoch — a mutation at the location must invalidate the cached answer for the NEXT context, while the
    // proposal-phase context memo is dropped at every execution point (startAction/interrupt/finish).
    test('object-query cache: a mutation at the location invalidates the cached answer', () => {
        const state = pool(1000);
        const inventory = new Inventory();
        const world = new BootstrapWorld(inventory);
        const pencil = inventory.createInstance({ archetypeId: 'pencil', owner: { kind: 'world' }, container: { kind: 'location', key: 'home' }, tick: 0 });
        const { deps, actions } = makeDeps(state, 1000, world, inventory);

        expect(actions.contextFor('a', deps).objectAtLocation!({ archetype: 'pencil' })).toBe(true);
        // Remove the pencil from the location (containment mutation → container epoch bump).
        inventory.moveInstance(pencil.id, { kind: 'possessions', personId: 'b' });
        expect(actions.contextFor('a', deps).objectAtLocation!({ archetype: 'pencil' })).toBe(false);
        // And back again — the cache must follow the epoch, not stick to either answer.
        inventory.moveInstance(pencil.id, { kind: 'location', key: 'home' });
        expect(actions.contextFor('a', deps).objectAtLocation!({ archetype: 'pencil' })).toBe(true);
    });

    test('proposal context memo: same (person, tick, backing) shares; startAction drops it', () => {
        const state = pool(1000);
        const inventory = new Inventory();
        const world = new BootstrapWorld(inventory);
        inventory.createInstance({ archetypeId: 'pencil', owner: { kind: 'world' }, container: { kind: 'location', key: 'home' }, tick: 0 });
        const { deps, actions } = makeDeps(state, 1000, world, inventory);

        // Param-less contexts for the same (person, tick, world, inventory) are the SAME object (the memo).
        const ctx1 = actions.contextFor('a', deps);
        expect(actions.contextFor('a', deps)).toBe(ctx1);
        // A different person or tick misses the memo.
        expect(actions.contextFor('b', deps)).not.toBe(ctx1);
        expect(actions.contextFor('a', { ...deps, tick: 1001 })).not.toBe(ctx1);
        // Executing an action (a mutation point) drops the memo — the next context is rebuilt fresh.
        const ctx2 = actions.contextFor('a', deps);
        actions.startAction('a', 'grab_pencil', {}, cause, deps, emptyResult());
        expect(actions.contextFor('a', deps)).not.toBe(ctx2);
    });

    test('same seed → identical logs; state round-trips and the instance counter continues', () => {
        const run = () => {
            const state = pool(1000);
            const { deps, engine, actions } = makeDeps(state, 1000);
            actions.startAction('a', 'play_outside', {}, cause, deps, emptyResult());
            for (let tick = 1001; tick <= 1002; tick++) {
                actions.advance({ ...deps, tick });
            }
            return { log: engine.getLog(), state: actions.getState() };
        };
        const first = run();
        expect(JSON.stringify(run().log)).toBe(JSON.stringify(first.log));

        const engine = new EventEngine(EVENTS);
        const restored = new ActionEngine(ACTIONS, engine.getLifeLog());
        restored.loadState(JSON.parse(JSON.stringify(first.state)));
        const deps: ActionDeps = { state: pool(1000), tick: 1010, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world: new BootstrapWorld() }, eventEngine: engine, inventory: null };
        const outcome = restored.startAction('b', 'rest_stub' in ACTIONS ? 'rest_stub' : 'work_shift', {}, cause, deps, emptyResult());
        expect(outcome.ok).toBe(true);
        expect((outcome as { instanceId: string }).instanceId).toBe(`a${first.state.nextInstanceSeq}`);
    });
});

describe('interleave()', () => {
    test('orders a multiset with no adjacent repeats when avoidable', () => {
        expect(interleave(['x', 'x', 'y'])).toEqual(['x', 'y', 'x']);
        expect(interleave(['x', 'x', 'x'])).toEqual(['x', 'x', 'x']); // sole child may repeat
        const big = interleave(['a', 'a', 'b', 'b', 'c']);
        for (let i = 1; i < big.length; i++) {
            expect(big[i]).not.toBe(big[i - 1]);
        }
    });
});
