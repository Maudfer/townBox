import ActionEngine, { ActionDeps } from 'game/actions/ActionEngine';
import Brain, { ActionIntent, BrainDeps, bandOf, scoreIntent, ARBITRATION_CONFIG } from 'game/actions/Brain';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import { ActionManifest, IntentBand } from 'types/Action';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { EventManifest, TickResult } from 'types/LifeEvent';
import { Genders } from 'types/Social';

// Arbitration v2 (task 086 / proposal L2–L7): band ordering, the interruption matrix (higher band displaces;
// same band needs the hysteresis delta AND the decision cooldown; lower band never), instance tagging, and
// the L7 equivalence corpus (what matches the old necessity sort, and the documented divergences).

const TPY = 8640;

function person(id: string): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

const FIXTURE_EVENTS = {} as unknown as EventManifest;
// weight 0 keeps the built-in idleFallback out of these tests (not free-time-selectable) — arbitration is
// driven purely by the controllable test hook below.
const FIXTURE_ACTIONS = {
    leisure_a: { label: 'Leisure A', type: 'continuous', category: 'leisure', durationTicks: 10, selection: { weight: 0 } },
    leisure_b: { label: 'Leisure B', type: 'continuous', category: 'leisure', durationTicks: 10, selection: { weight: 0 } },
    work_x: { label: 'Working X', type: 'continuous', category: 'work', durationTicks: 10, selection: { weight: 0 } },
    errand: { label: 'Planned errand', type: 'continuous', category: 'maintenance', durationTicks: 10, selection: { weight: 0 } },
    quick_chat: { label: 'Chatted', type: 'discrete', category: 'social' },
} as unknown as ActionManifest;

// A controllable intent source: tests set `queue` per tick; the hook drains it.
function harness() {
    const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
    const world = new BootstrapWorld(inventory);
    const engine = new EventEngine(FIXTURE_EVENTS);
    const actions = new ActionEngine(FIXTURE_ACTIONS, engine.getLifeLog());
    const brain = new Brain(actions);
    const queue: ActionIntent[] = [];
    brain.registerHook({
        id: 'test',
        kind: 'onTick',
        propose: () => queue.splice(0),
    });
    const people = { a: person('a') };
    const state: PopulationState = { worldSeed: 3, people, drawSeed: 1, placedIds: [], nextSeq: 10, lastSimulatedYear: 0 };
    world.register('a');
    const deps: BrainDeps & ActionDeps = { state, tick: 100, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world }, eventEngine: engine, inventory };
    return { engine, actions, brain, queue, deps };
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });

function intent(actionId: string, band: IntentBand, priority: number): ActionIntent {
    return { actionId, sourceHook: 'test', priority, necessity: 'optional', band, mayInterrupt: false, causationId: null };
}

describe('band ordering (L2) & the utility currency (L3)', () => {
    test('a higher band wins regardless of priority; utility breaks ties within a band', () => {
        const { actions, brain, queue, deps } = harness();
        queue.push(intent('leisure_a', 'fallback', 999), intent('errand', 'commitment', 1));
        brain.processTick(['a'], deps, [], result());
        expect(actions.activeInstanceOf('a')?.defId).toBe('errand'); // band beat priority

        const { actions: actions2, brain: brain2, queue: queue2, deps: deps2 } = harness();
        queue2.push(intent('leisure_a', 'fallback', 10), intent('leisure_b', 'fallback', 40));
        brain2.processTick(['a'], deps2, [], result());
        expect(actions2.activeInstanceOf('a')?.defId).toBe('leisure_b'); // utility within the band
    });

    test('the mechanical necessity mapping covers band-less intents (the L7 migration rule)', () => {
        const legacy: ActionIntent = { actionId: 'x', sourceHook: 't', priority: 1, necessity: 'required', mayInterrupt: false, causationId: null };
        expect(bandOf(legacy)).toBe('obligation');
        expect(bandOf({ ...legacy, necessity: 'emergency' })).toBe('survival');
        expect(bandOf({ ...legacy, necessity: 'optional' })).toBe('opportunity');
        expect(scoreIntent(legacy)).toBe(1);
    });
});

describe('the interruption matrix (L4) & decision cooldown (L6)', () => {
    test('a strictly higher band displaces a running action', () => {
        const { actions, brain, queue, deps } = harness();
        queue.push(intent('leisure_a', 'fallback', 10));
        brain.processTick(['a'], deps, [], result());
        expect(actions.activeInstanceOf('a')?.defId).toBe('leisure_a');

        queue.push(intent('work_x', 'obligation', 100));
        brain.processTick(['a'], { ...deps, tick: 105 }, [], result());
        expect(actions.activeInstanceOf('a')?.defId).toBe('work_x');
        // The displaced instance logged an interruption.
        expect(deps.eventEngine.getPersonLog('a').some(entry => entry.kind === 'action' && entry.defId === 'leisure_a' && entry.lifecycle === 'interrupted')).toBe(true);
    });

    test('a lower band NEVER displaces (commitment yields to a running obligation)', () => {
        const { actions, brain, queue, deps } = harness();
        queue.push(intent('work_x', 'obligation', 100));
        brain.processTick(['a'], deps, [], result());
        queue.push(intent('errand', 'commitment', 55));
        brain.processTick(['a'], { ...deps, tick: 105 }, [], result());
        expect(actions.activeInstanceOf('a')?.defId).toBe('work_x');
    });

    test('same band: hysteresis + cooldown gate the swap (commitment inertia)', () => {
        const { actions, brain, queue, deps } = harness();
        queue.push(intent('leisure_a', 'fallback', 10));
        brain.processTick(['a'], deps, [], result());

        // Below the hysteresis delta: no swap even after the cooldown.
        queue.push(intent('leisure_b', 'fallback', 10 + ARBITRATION_CONFIG.sameBandUtilityDelta - 1));
        brain.processTick(['a'], { ...deps, tick: 100 + ARBITRATION_CONFIG.decisionCooldownTicks + 1 }, [], result());
        expect(actions.activeInstanceOf('a')?.defId).toBe('leisure_a');

        // Above the delta but INSIDE the cooldown: still no swap.
        const { actions: a2, brain: b2, queue: q2, deps: d2 } = harness();
        q2.push(intent('leisure_a', 'fallback', 10));
        b2.processTick(['a'], d2, [], result());
        q2.push(intent('leisure_b', 'fallback', 90));
        b2.processTick(['a'], { ...d2, tick: 100 + ARBITRATION_CONFIG.decisionCooldownTicks - 1 }, [], result());
        expect(a2.activeInstanceOf('a')?.defId).toBe('leisure_a');

        // Above the delta AND past the cooldown: the swap happens.
        q2.push(intent('leisure_b', 'fallback', 90));
        b2.processTick(['a'], { ...d2, tick: 100 + ARBITRATION_CONFIG.decisionCooldownTicks + 2 }, [], result());
        expect(a2.activeInstanceOf('a')?.defId).toBe('leisure_b');
    });

    test('instances carry their band/utility provenance (tagInstance)', () => {
        const { actions, brain, queue, deps } = harness();
        queue.push(intent('errand', 'commitment', 55));
        brain.processTick(['a'], deps, [], result());
        const instance = actions.activeInstanceOf('a')!;
        expect(instance.band).toBe('commitment');
        expect(instance.utility).toBe(55);
    });
});

describe('the L7 equivalence corpus (old sort vs bands)', () => {
    test('MATCHES: obligations beat leisure; discrete opportunities execute on later on-duty ticks', () => {
        const { actions, brain, queue, deps } = harness();
        queue.push(intent('leisure_a', 'fallback', 40), intent('work_x', 'obligation', 100), intent('quick_chat', 'opportunity', 20));
        brain.processTick(['a'], deps, [], result());
        expect(actions.activeInstanceOf('a')?.defId).toBe('work_x');
        // On a later tick with only the discrete proposed (the orchestrator's on-duty pattern), it commits
        // without contesting the running continuous — same as the old sort.
        queue.push(intent('quick_chat', 'opportunity', 20));
        brain.processTick(['a'], { ...deps, tick: 101 }, [], result());
        expect(actions.activeInstanceOf('a')?.defId).toBe('work_x');
        expect(deps.eventEngine.getPersonLog('a').some(entry => entry.kind === 'action' && entry.defId === 'quick_chat')).toBe(true);
    });

    test('DIVERGENCE (intentional): survival now outranks a running obligation — lunch breaks are real', () => {
        const { actions, brain, queue, deps } = harness();
        queue.push(intent('work_x', 'obligation', 100));
        brain.processTick(['a'], deps, [], result());
        queue.push(intent('leisure_a', 'survival', 60)); // "eat" standing in
        brain.processTick(['a'], { ...deps, tick: 110 }, [], result());
        expect(actions.activeInstanceOf('a')?.defId).toBe('leisure_a');
    });

    test('DIVERGENCE (intentional): commitments now interrupt running leisure — plans actually happen', () => {
        const { actions, brain, queue, deps } = harness();
        queue.push(intent('leisure_a', 'fallback', 40));
        brain.processTick(['a'], deps, [], result());
        queue.push(intent('errand', 'commitment', 55));
        brain.processTick(['a'], { ...deps, tick: 110 }, [], result());
        expect(actions.activeInstanceOf('a')?.defId).toBe('errand');
    });
});

// W3 — scenes, not events (proposal simulation-aliveness-3 P1-3): natural conclusions, work handovers,
// and the aftershock dampener.
describe('W3: interruption semantics', () => {
    const W3_ACTIONS = {
        napping: { label: 'Napping', type: 'continuous', category: 'recovery', durationTicks: 3, selection: { weight: 0 }, events: { onComplete: 'rested_up' } },
        work_a: { label: 'Working the desk', type: 'continuous', category: 'work', durationTicks: 10, selection: { weight: 0 }, events: { onInterrupt: 'clocked_out' } },
        work_b: { label: 'Helping a customer', type: 'continuous', category: 'work', durationTicks: 10, selection: { weight: 0 } },
        stroll: { label: 'Strolling', type: 'continuous', category: 'leisure', durationTicks: 10, selection: { weight: 0 } },
    } as unknown as ActionManifest;
    const W3_EVENTS = {
        rested_up: { roles: { subject: { where: { attr: 'alive', op: '==', value: true } } }, triggers: { manual: {} }, effects: [] },
        clocked_out: { roles: { subject: { where: { attr: 'alive', op: '==', value: true } } }, triggers: { manual: {} }, effects: [] },
    } as unknown as EventManifest;

    function w3harness() {
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const world = new BootstrapWorld(inventory);
        const engine = new EventEngine(W3_EVENTS);
        const actions = new ActionEngine(W3_ACTIONS, engine.getLifeLog());
        const brain = new Brain(actions);
        const queue: ActionIntent[] = [];
        brain.registerHook({ id: 'test', kind: 'onTick', propose: () => queue.splice(0) });
        const state: PopulationState = { worldSeed: 3, people: { a: person('a') }, drawSeed: 1, placedIds: [], nextSeq: 10, lastSimulatedYear: 0 };
        world.register('a');
        const deps: BrainDeps & ActionDeps = { state, tick: 100, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world }, eventEngine: engine, inventory };
        return { engine, actions, brain, queue, deps };
    }

    test('interrupting an instance that ran its FULL duration records a completion — the morning wake is not an interruption', () => {
        const { engine, actions, deps } = w3harness();
        const started = actions.startAction('a', 'napping', {}, { source: 'system', causationId: null }, deps, result());
        expect(started.ok).toBe(true);
        const instanceId = (started as { instanceId: string }).instanceId;
        // Displaced at tick 103 — exactly its 3-tick duration elapsed: a natural conclusion.
        actions.interrupt(instanceId, { source: 'brain', causationId: null }, { ...deps, tick: 103 }, result());
        const log = engine.getPersonLog('a');
        expect(log.some(e => e.kind === 'action' && e.defId === 'napping' && e.lifecycle === 'completed')).toBe(true);
        expect(log.some(e => e.kind === 'action' && e.defId === 'napping' && e.lifecycle === 'interrupted')).toBe(false);
        expect(log.some(e => e.kind === 'event' && e.defId === 'rested_up')).toBe(true); // onComplete fired
    });

    test('interrupting MID-duration stays an interruption', () => {
        const { engine, actions, deps } = w3harness();
        const started = actions.startAction('a', 'napping', {}, { source: 'system', causationId: null }, deps, result());
        actions.interrupt((started as { instanceId: string }).instanceId, { source: 'brain', causationId: null }, { ...deps, tick: 101 }, result());
        const log = engine.getPersonLog('a');
        expect(log.some(e => e.kind === 'action' && e.defId === 'napping' && e.lifecycle === 'interrupted')).toBe(true);
        expect(log.some(e => e.kind === 'event' && e.defId === 'rested_up')).toBe(false);
    });

    test('a work→work HANDOVER suppresses the clock-out event; a work→leisure switch fires it', () => {
        const { engine, actions, brain, queue, deps } = w3harness();
        // On the desk…
        actions.startAction('a', 'work_a', {}, { source: 'brain', causationId: null }, deps, result());
        // …a same-band work intent displaces it (utility high enough to clear the hysteresis + cooldown).
        queue.push({ actionId: 'work_b', sourceHook: 'test', priority: 200, necessity: 'required', band: 'obligation', mayInterrupt: true, causationId: null });
        brain.processTick(['a'], { ...deps, tick: 104 }, [], result());
        let log = engine.getPersonLog('a');
        expect(log.some(e => e.kind === 'action' && e.defId === 'work_a' && e.lifecycle === 'interrupted')).toBe(true);
        expect(log.some(e => e.kind === 'event' && e.defId === 'clocked_out')).toBe(false); // the handover

        // Now a leisure intent displaces work: clear work_b (handover — silent), restart work_a, then stroll.
        const activeB = actions.activeInstanceOf('a')!;
        actions.interrupt(activeB.id, { source: 'brain', causationId: null }, { ...deps, tick: 110 }, result(), true);
        expect(actions.startAction('a', 'work_a', {}, { source: 'brain', causationId: null }, { ...deps, tick: 110 }, result()).ok).toBe(true);
        queue.push({ actionId: 'stroll', sourceHook: 'test', priority: 400, necessity: 'required', band: 'survival', mayInterrupt: true, causationId: null });
        brain.processTick(['a'], { ...deps, tick: 114 }, [], result());
        log = engine.getPersonLog('a');
        expect(log.some(e => e.kind === 'event' && e.defId === 'clocked_out')).toBe(true); // a REAL exit fires it
    });
});

describe('W3: the aftershock — lying low after a shock', () => {
    test('a fresh was_arrested dampens outgoing picks toward home for the config window', () => {
        const AFTERSHOCK_ACTIONS = {
            out_socializing: { label: 'Out socializing', type: 'continuous', category: 'leisure', durationTicks: 1, selection: { weight: 1 } },
            puttering_at_home: { label: 'Puttering at home', type: 'continuous', category: 'maintenance', durationTicks: 1, selection: { weight: 1 } },
        } as unknown as ActionManifest;
        const AFTERSHOCK_EVENTS = {
            was_arrested: { roles: { subject: { where: { attr: 'alive', op: '==', value: true } } }, triggers: { manual: {} }, effects: [] },
        } as unknown as EventManifest;
        const run = (arrested: boolean): number => {
            const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
            const world = new BootstrapWorld(inventory);
            const engine = new EventEngine(AFTERSHOCK_EVENTS);
            const actions = new ActionEngine(AFTERSHOCK_ACTIONS, engine.getLifeLog());
            const brain = new Brain(actions);
            const state: PopulationState = { worldSeed: 9, people: { a: person('a') }, drawSeed: 1, placedIds: [], nextSeq: 10, lastSimulatedYear: 0 };
            world.register('a');
            if (arrested) {
                engine.invoke(state, 'was_arrested', 'a', 99, TPY, { source: 'system', causationId: null });
            }
            let outings = 0;
            for (let tick = 100; tick < 111; tick++) { // inside the 12-tick aftershock window
                const deps: BrainDeps = { state, tick, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world }, eventEngine: engine, inventory };
                if (brain.selectFreeTimeAction('a', deps) === 'out_socializing') {
                    outings++;
                }
            }
            return outings;
        };
        const calm = run(false);
        const shaken = run(true);
        expect(shaken).toBeLessThan(calm); // the 0.25 dampener bites (same seed, same ticks)
    });
});

describe('the standing location gate (aliveness-3 follow-up)', () => {
    test('a running home-located instance whose person is displaced reverts to pending — Sleeping can never run on the street', () => {
        const GATE_ACTIONS = {
            napping_at_home: { label: 'Napping', type: 'continuous', category: 'recovery', location: 'home', durationTicks: 8, selection: { weight: 0 } },
        } as unknown as ActionManifest;
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const world = new BootstrapWorld(inventory);
        const engine = new EventEngine({} as never);
        const actions = new ActionEngine(GATE_ACTIONS, engine.getLifeLog());
        const state: PopulationState = { worldSeed: 3, people: { a: person('a') }, drawSeed: 1, placedIds: [], nextSeq: 10, lastSimulatedYear: 0 };
        world.register('a');
        const deps: ActionDeps = { state, tick: 100, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world }, eventEngine: engine, inventory };

        const started = actions.startAction('a', 'napping_at_home', {}, { source: 'brain', causationId: null }, deps, result());
        expect(started.ok).toBe(true);
        actions.advance({ ...deps, tick: 101 });
        expect(actions.activeInstanceOf('a')?.status).toBe('running');

        // Displacement (the ejection class): the person is physically moved elsewhere mid-nap.
        world.requestTransition('a', { kind: 'building', key: '9-9' }, 102, null);
        actions.advance({ ...deps, tick: 102 });
        // The standing gate bounced the instance out of running — it re-materializes (transition home)
        // instead of napping in the street.
        expect(actions.activeInstanceOf('a')?.status).not.toBe('running');
        actions.advance({ ...deps, tick: 103 });
        // Bootstrap transitions resolve immediately: back home, running resumes honestly.
        expect(actions.activeInstanceOf('a')?.status).toBe('running');
    });
});
