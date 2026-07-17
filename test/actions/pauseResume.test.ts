import ActionEngine, { ActionDeps } from 'game/actions/ActionEngine';
import Brain, { ActionIntent, BrainDeps, ARBITRATION_CONFIG } from 'game/actions/Brain';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import { ActionManifest, IntentBand } from 'types/Action';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { EventManifest, TickResult } from 'types/LifeEvent';
import { Genders } from 'types/Social';

// Pause & resume (task 087 / proposal L5): a resumable activity displaced by a strictly higher band PARKS
// (started → paused → resumed, same instance id); the resume hook picks it back up when idle; a pause
// outliving the authored window becomes a real interruption (engine-owned expiry).

const TPY = 8640;

function person(id: string): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

const FIXTURE_ACTIONS = {
    stroll: { label: 'Strolling', type: 'continuous', category: 'leisure', durationTicks: 10, resumable: true, selection: { weight: 0 } },
    fragile: { label: 'Fragile leisure', type: 'continuous', category: 'leisure', durationTicks: 10, selection: { weight: 0 } },
    duty: { label: 'On duty', type: 'continuous', category: 'work', durationTicks: 3, selection: { weight: 0 } },
} as unknown as ActionManifest;

function harness() {
    const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
    const world = new BootstrapWorld(inventory);
    const engine = new EventEngine({} as EventManifest);
    const actions = new ActionEngine(FIXTURE_ACTIONS, engine.getLifeLog());
    const brain = new Brain(actions);
    const queue: ActionIntent[] = [];
    brain.registerHook({ id: 'test', kind: 'onTick', propose: () => queue.splice(0) });
    const state: PopulationState = { worldSeed: 3, people: { a: person('a') }, drawSeed: 1, placedIds: [], nextSeq: 10, lastSimulatedYear: 0 };
    world.register('a');
    const deps: BrainDeps & ActionDeps = { state, tick: 100, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world }, eventEngine: engine, inventory };
    return { engine, actions, brain, queue, deps };
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });

function intent(actionId: string, band: IntentBand, priority: number): ActionIntent {
    return { actionId, sourceHook: 'test', priority, necessity: 'optional', band, mayInterrupt: false, causationId: null };
}

function lifecycleTrail(engine: EventEngine, defId: string): string[] {
    return engine.getPersonLog('a')
        .filter(entry => entry.kind === 'action' && entry.defId === defId)
        .map(entry => (entry as { lifecycle: string }).lifecycle);
}

describe('pause instead of interrupt (L5)', () => {
    test('a resumable activity parks under a higher band and RESUMES afterward — same instance id', () => {
        const { engine, actions, brain, queue, deps } = harness();
        queue.push(intent('stroll', 'fallback', 10));
        brain.processTick(['a'], deps, [], result());
        const strollId = actions.activeInstanceOf('a')!.id;

        // A short obligation displaces it → the stroll pauses, not dies.
        queue.push(intent('duty', 'obligation', 100));
        brain.processTick(['a'], { ...deps, tick: 101 }, [], result());
        expect(actions.activeInstanceOf('a')?.defId).toBe('duty');
        expect(actions.pausedInstanceOf('a')?.id).toBe(strollId);
        expect(lifecycleTrail(engine, 'stroll')).toEqual(['started', 'paused']);

        // The duty completes (durationTicks 3); the resume hook then revives the SAME instance.
        for (let tick = 102; tick <= 106; tick++) {
            actions.advance({ ...deps, tick });
            brain.processTick(['a'], { ...deps, tick }, [], result());
        }
        expect(actions.activeInstanceOf('a')?.id).toBe(strollId);
        expect(lifecycleTrail(engine, 'stroll')).toEqual(['started', 'paused', 'resumed', 'started']);
    });

    test('a NON-resumable activity is interrupted outright (the pre-087 posture)', () => {
        const { engine, actions, brain, queue, deps } = harness();
        queue.push(intent('fragile', 'fallback', 10));
        brain.processTick(['a'], deps, [], result());
        queue.push(intent('duty', 'obligation', 100));
        brain.processTick(['a'], { ...deps, tick: 101 }, [], result());
        expect(actions.pausedInstanceOf('a')).toBeNull();
        expect(lifecycleTrail(engine, 'fragile')).toEqual(['started', 'interrupted']);
    });

    test('an expired pause becomes a real interruption (engine-owned sweep)', () => {
        const { engine, actions, brain, queue, deps } = harness();
        queue.push(intent('stroll', 'fallback', 10));
        brain.processTick(['a'], deps, [], result());
        queue.push(intent('duty', 'obligation', 100));
        brain.processTick(['a'], { ...deps, tick: 101 }, [], result());
        expect(actions.pausedInstanceOf('a')).not.toBeNull();

        // Keep the person busy past the resume window; the sweep abandons the stale pause.
        const past = 101 + ARBITRATION_CONFIG.decisionCooldownTicks + (13 as number) + 5;
        actions.advance({ ...deps, tick: past });
        expect(actions.pausedInstanceOf('a')).toBeNull();
        expect(lifecycleTrail(engine, 'stroll')).toEqual(['started', 'paused', 'interrupted']);
    });

    test('paused instances survive a save/load round-trip (index rebuild)', () => {
        const { actions, brain, queue, deps } = harness();
        queue.push(intent('stroll', 'fallback', 10));
        brain.processTick(['a'], deps, [], result());
        queue.push(intent('duty', 'obligation', 100));
        brain.processTick(['a'], { ...deps, tick: 101 }, [], result());
        const pausedId = actions.pausedInstanceOf('a')!.id;

        const restored = new ActionEngine(FIXTURE_ACTIONS, new EventEngine({} as EventManifest).getLifeLog());
        restored.loadState(JSON.parse(JSON.stringify(actions.getState())));
        expect(restored.pausedInstanceOf('a')?.id).toBe(pausedId);
    });
});
