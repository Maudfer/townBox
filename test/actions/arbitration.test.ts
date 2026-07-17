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
