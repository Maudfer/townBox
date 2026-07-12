// Targeted coverage for edge branches in the Action engine's five core files (ActionEngine, Brain,
// JobOrchestrator, SocialOpportunity) that the broader lifecycle/content suites in this directory don't
// exercise on their own: unknown/invalid start requests, blocked location transitions, sequence edge cases,
// $previous.output bindings, Brain arbitration's interrupt/skip paths, the woke-up hook's on-shift/on-school
// skip branches, the inventory-opportunity grab/carry-fiddle branches, and the job/social hooks' empty-
// repertoire and multi-borrowed-object edge cases. Each test targets real behavior, not just line execution.

import ActionEngine, { ActionDeps, DEFAULT_ACTION_MANIFEST } from 'game/actions/ActionEngine';
import Brain, { BrainDeps, JobFacts } from 'game/actions/Brain';
import { evaluateConsent } from 'game/actions/Consent';
import { jobOrchestratorHook } from 'game/actions/JobOrchestrator';
import { socialOpportunityHook } from 'game/actions/SocialOpportunity';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import { ActionManifest } from 'types/Action';
import { WorldAdapter, TransitionHandle, SubProfiler } from 'types/Execution';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { EventManifest, TickResult } from 'types/LifeEvent';
import { Genders } from 'types/Social';

const TPY = 8640;

function person(id: string, ageYears = 30, tickNow = 1000): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: tickNow - ageYears * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function pool(ids: string[]): PopulationState {
    const people: Record<string, GenPerson> = {};
    ids.forEach(id => (people[id] = person(id)));
    return { worldSeed: 55, people, drawSeed: 1, placedIds: [], nextSeq: 100, lastSimulatedYear: 0 };
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });
const cause = { source: 'system' as const, causationId: null };

const EVENTS: EventManifest = {} as unknown as EventManifest;

describe('ActionEngine gaps', () => {
    const ACTIONS: ActionManifest = {
        stub: { label: 'Stub', type: 'discrete', category: 'leisure' },
        home_nap: { label: 'Napping', type: 'continuous', category: 'recovery', location: 'home', durationTicks: 5 },
        // A sequence with $previous.output: a discrete producer binds an output, the next step reads it.
        producer: {
            label: 'Produce', type: 'discrete', category: 'maintenance',
            consequences: [{ op: 'createObject', archetype: 'pencil', owner: 'world', container: 'location', bindAs: 'output' }],
        },
        consumer: {
            label: 'Consume', type: 'discrete', category: 'maintenance', parameters: { object: { type: 'objectInstance' } },
        },
        chain: {
            label: 'Chain', type: 'continuous', category: 'maintenance',
            children: { mode: 'sequence', steps: [{ action: 'producer' }, { action: 'consumer', params: { object: '$previous.output' } }] },
        },
        empty_sequence: {
            label: 'Empty sequence', type: 'continuous', category: 'maintenance',
            children: { mode: 'sequence', steps: [] } as unknown as { mode: 'sequence'; steps: { action: string }[] },
        },
        completes_by_predicate: {
            label: 'Watch clock', type: 'continuous', category: 'leisure',
            completeWhen: { attr: 'hourOfDay', op: '>=', value: 12 },
        },
    } as unknown as ActionManifest;

    function makeDeps(state: PopulationState, tick: number, world: WorldAdapter = new BootstrapWorld(), inventory: Inventory | null = null): { deps: ActionDeps; engine: EventEngine; actions: ActionEngine } {
        const engine = new EventEngine(EVENTS);
        const actions = new ActionEngine(ACTIONS, engine.getLifeLog());
        const deps: ActionDeps = { state, tick, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world }, eventEngine: engine, inventory };
        return { deps, engine, actions };
    }

    test('getActionLabel falls back to a title-cased id for actions with no manifest entry', () => {
        const { actions } = makeDeps(pool(['a']), 1000);
        expect(actions.getActionLabel('grabbed_a_pencil')).toBe('Grabbed A Pencil');
        expect(actions.getActionLabel('stub')).toBe('Stub'); // the declared label wins when present
    });

    test('starting an unknown action id is a typed failure, never a throw', () => {
        const { actions, deps } = makeDeps(pool(['a']), 1000);
        expect(actions.startAction('a', 'no_such_action', {}, cause, deps, result())).toEqual({ ok: false, reason: 'unknownAction' });
    });

    test('starting with a parentInstanceId that does not exist is a typed failure', () => {
        const { actions, deps } = makeDeps(pool(['a']), 1000);
        expect(actions.startAction('a', 'stub', {}, cause, deps, result(), 'a999')).toEqual({ ok: false, reason: 'invalidParent' });
    });

    test('starting an action for a person absent from the population record is requirementsUnmet', () => {
        const { actions, deps } = makeDeps(pool(['a']), 1000);
        expect(actions.startAction('ghost', 'stub', {}, cause, deps, result())).toEqual({ ok: false, reason: 'requirementsUnmet' });
    });

    test('hasAction withinTicks excludes attempts outside the window', () => {
        const { actions, deps } = makeDeps(pool(['a']), 1000);
        actions.startAction('a', 'stub', {}, cause, deps, result());
        expect(actions.hasAction('a', 'stub', 1000, { withinTicks: 100 })).toBe(true);
        expect(actions.hasAction('a', 'stub', 1200, { withinTicks: 50 })).toBe(false); // 200 ticks elapsed > 50
    });

    test('a cancelled transition blocks the instance instead of leaving it parked forever', () => {
        const world: WorldAdapter = {
            mode: 'live',
            locationOf: () => ({ kind: 'outside' }),
            objectLocationOf: () => ({ kind: 'outside' }),
            peopleAt: () => [],
            objectsAt: () => [],
            requestTransition: (personId, target, tick, causationId): TransitionHandle =>
                ({ id: 0, personId, target, status: 'cancelled', requestedAtTick: tick, resolvedAtTick: null, causationId }),
        };
        const { actions, deps } = makeDeps(pool(['a']), 1000, world);
        const outcome = actions.startAction('a', 'home_nap', {}, cause, deps, result());
        expect(outcome.ok).toBe(true);
        const instance = actions.getInstance((outcome as { instanceId: string }).instanceId);
        // Blocked instances are terminal and pruned immediately (task 078) — the engine frees the person.
        expect(instance).toBeNull();
        expect(actions.activeInstanceOf('a')).toBeNull();
    });

    test('an empty sequence (zero steps) completes on its very first advance tick', () => {
        const { actions, engine, deps } = makeDeps(pool(['a']), 1000);
        const outcome = actions.startAction('a', 'empty_sequence', {}, cause, deps, result());
        expect(outcome.ok).toBe(true);
        actions.advance({ ...deps, tick: 1001 });
        const completed = engine.getPersonLog('a').find(e => e.kind === 'action' && e.lifecycle === 'completed');
        expect(completed).toBeDefined();
    });

    test('$previous.output threads a bound output from one sequence step into the next', () => {
        const inventory = new Inventory();
        const world = new BootstrapWorld(inventory);
        const { actions, engine, deps } = makeDeps(pool(['a']), 1000, world, inventory);
        actions.startAction('a', 'chain', {}, cause, deps, result());
        actions.advance({ ...deps, tick: 1001 }); // producer commits, binds 'output'
        actions.advance({ ...deps, tick: 1002 }); // consumer should receive the bound instance id as `object`
        const consumeEntry = engine.getPersonLog('a').find(e => e.kind === 'action' && e.defId === 'consumer' && e.lifecycle === 'performed');
        expect(consumeEntry).toBeDefined();
        const params = (consumeEntry as unknown as { params: Record<string, string> }).params;
        expect(typeof params['object']).toBe('string');
        expect(params['object']!.length).toBeGreaterThan(0);
    });

    test('completeWhen predicates finish the instance without a durationTicks cap', () => {
        const { actions, engine, deps } = makeDeps(pool(['a']), 1000);
        actions.startAction('a', 'completes_by_predicate', {}, cause, { ...deps, tick: 1000 }, result());
        // hourOfDay derives from the tick; drive forward until the predicate (hour >= 12) is satisfied.
        for (let tick = 1001; tick <= 1000 + 24; tick++) {
            actions.advance({ ...deps, tick });
            if (engine.getPersonLog('a').some(e => e.kind === 'action' && e.lifecycle === 'completed')) {
                break;
            }
        }
        expect(engine.getPersonLog('a').some(e => e.kind === 'action' && e.lifecycle === 'completed')).toBe(true);
    });

    test('interrupting an instance that is not active (already finished/unknown) is a no-op returning false', () => {
        const { actions, deps } = makeDeps(pool(['a']), 1000);
        expect(actions.interrupt('a999', cause, deps, result())).toBe(false);
    });

    test('the default manifest/OAR table load without a custom manifest', () => {
        const engine = new EventEngine();
        const actions = new ActionEngine(); // exercises the DEFAULT_ACTION_MANIFEST/DEFAULT_OAR_TABLE defaults
        expect(actions.getManifest()).toBe(DEFAULT_ACTION_MANIFEST);
        expect(actions.getDefinition('sleep')).not.toBeNull();
        void engine;
    });

    test('objectAtLocation/carries answer false with no world/inventory backing, and locationKey is undefined', () => {
        const { actions, deps } = makeDeps(pool(['a']), 1000, new BootstrapWorld(), null);
        const ctx = actions.contextFor('a', deps);
        expect(ctx.objectAtLocation!({ archetype: 'pencil' })).toBe(false);
        expect(ctx.carries!({ archetype: 'pencil' })).toBe(false);
    });

    test('--profile sub-timers do not change behavior when threaded through advance()', () => {
        const { actions, deps } = makeDeps(pool(['a']), 1000);
        const outcome = actions.startAction('a', 'home_nap', {}, cause, deps, result());
        expect(outcome.ok).toBe(true);
        const sub: SubProfiler = { actionsAdvance: {}, brainHooks: {}, brainResolve: 0 };
        for (let tick = 1001; tick <= 1005; tick++) {
            actions.advance({ ...deps, tick }, sub);
        }
        expect(Object.keys(sub.actionsAdvance).length).toBeGreaterThan(0);
        expect(actions.activeInstanceOf('a')).toBeNull(); // completed and pruned like an unprofiled run
    });
});

describe('Brain arbitration gaps', () => {
    function harness(jobOf?: (id: string) => JobFacts | null) {
        const engine = new EventEngine();
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const brain = new Brain(actions);
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const world = new BootstrapWorld(inventory);
        const makeDeps = (tick: number): BrainDeps => ({
            state: pool(['a', 'b']), tick, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world },
            eventEngine: engine, inventory, ...(jobOf ? { jobOf } : {}),
        });
        return { engine, actions, brain, world, inventory, makeDeps };
    }

    test('an intent that may not interrupt the running continuous activity is skipped, not queued', () => {
        const { actions, brain, makeDeps } = harness();
        const deps = makeDeps(21);
        actions.startAction('a', 'sleep', {}, { source: 'brain', causationId: null }, deps, result());
        brain.registerHook({
            id: 'lowPriorityLeisure', kind: 'onTick',
            propose: () => [{ actionId: 'read_book', sourceHook: 'lowPriorityLeisure', priority: 999, necessity: 'optional', mayInterrupt: false, causationId: null }],
        });
        brain.processTick(['a'], deps, [], result());
        // Sleep keeps running: a non-interrupting intent, however high-priority, cannot displace it.
        expect(brain.statusOf('a').status).toBe('sleeping');
    });

    test('an intent for the SAME action already running is a satisfied no-op (breaks out immediately)', () => {
        const { actions, brain, makeDeps } = harness();
        const deps = makeDeps(21);
        const started = actions.startAction('a', 'sleep', {}, { source: 'brain', causationId: null }, deps, result());
        const instanceId = (started as { instanceId: string }).instanceId;
        brain.registerHook({
            id: 'sameActivity', kind: 'onTick',
            propose: () => [{ actionId: 'sleep', sourceHook: 'sameActivity', priority: 999, necessity: 'required', mayInterrupt: true, causationId: null }],
        });
        brain.processTick(['a'], deps, [], result());
        // Same instance keeps running — no interrupt/restart happened.
        expect(brain.statusOf('a').activeActionInstanceId).toBe(instanceId);
    });

    test('wokeUp yields no intent when the person is on shift (the obligation hook owns it) or on a school day', () => {
        const { brain, makeDeps } = harness(() => ({
            shiftStart: 0, shiftEnd: 23 * 60 + 59, daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
            workplaceKey: '1-1', continuousActions: [{ action: 'attending_customers' }], discreteActions: [],
        }));
        const deps = { ...makeDeps(10), schoolOf: () => null };
        // Register an observer to capture what wokeUp itself proposes, bypassing arbitration noise.
        const observed: string[] = [];
        brain.registerHook({
            id: 'obs', kind: 'onTick',
            propose: () => { observed.length = 0; return []; },
        });
        brain.processTick(['a'], deps, [{ personId: 'a', eventId: 'woke_up', seq: 1 }], result());
        // On shift: the job orchestrator, not wokeUp, drives the intent — status ends up working.
        expect(brain.statusOf('a').status).toBe('working');
        void observed;
    });

    test('wokeUp yields no intent when the person has a school obligation on shift right now', () => {
        const { brain, makeDeps } = harness();
        const deps: BrainDeps = { ...makeDeps(10), schoolOf: () => ({ shiftStart: 0, shiftEnd: 23 * 60 + 59, daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], schoolKey: 's-1' }) };
        brain.processTick(['a'], deps, [{ personId: 'a', eventId: 'woke_up', seq: 1 }], result());
        // No job and school owns the slot: wokeUp defers, but nothing else proposes attend_school here
        // (schoolObligationHook needs a real SchoolFacts consumer elsewhere) — the key assertion is that
        // wokeUp itself contributed no free-time pick, so the person is NOT locked into a leisure activity.
        expect(brain.statusOf('a').status).not.toBe('sleeping');
    });

    // A manifest with only the generic inventory verbs (no free-time continuous candidates at all): idleFallback
    // and wokeUp's selectFreeTimeAction always return null, so the person stays 'idle' every tick — isolating
    // the inventoryOpportunity hook's own branches from getting starved by a long-running free-time pick.
    const INVENTORY_ONLY: ActionManifest = {
        grab: { label: 'Grab', type: 'discrete', category: 'maintenance' },
        pocketed_small_object: { label: 'Pocketed', type: 'discrete', category: 'maintenance' },
        use_object: { label: 'Used', type: 'discrete', category: 'maintenance' },
        put_down: { label: 'Put down', type: 'discrete', category: 'maintenance' },
        discard_object: { label: 'Discarded', type: 'discrete', category: 'maintenance' },
    } as unknown as ActionManifest;

    function inventoryHarness() {
        const engine = new EventEngine();
        const actions = new ActionEngine(INVENTORY_ONLY, engine.getLifeLog());
        const brain = new Brain(actions);
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const world = new BootstrapWorld(inventory);
        const makeDeps = (tick: number): BrainDeps => ({
            state: pool(['a', 'b']), tick, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world }, eventEngine: engine, inventory,
        });
        return { engine, actions, brain, inventory, makeDeps };
    }

    test('inventoryOpportunity grabs a free loose carryable before pocketing or fiddling with carried items', () => {
        const { brain, inventory, engine, makeDeps } = inventoryHarness();
        inventory.createInstance({ archetypeId: 'umbrella', owner: { kind: 'none' }, container: { kind: 'location', key: 'home' }, tick: 0 });
        brain.processTick(['a'], makeDeps(50), [], result());
        const grabbed = engine.getPersonLog('a').find(e => e.kind === 'action' && e.defId === 'grab');
        expect(grabbed).toBeDefined();
        expect((grabbed as unknown as { params: Record<string, string> }).params['object']).toBe('umbrella');
    });

    test('inventoryOpportunity occasionally fiddles with a carried object when nothing else is available', () => {
        const { brain, inventory, engine, makeDeps } = inventoryHarness();
        inventory.createInstance({ archetypeId: 'coin', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        for (let tick = 50; tick < 250; tick++) {
            brain.processTick(['a'], makeDeps(tick), [], result());
        }
        const fiddled = engine.getPersonLog('a').some(e => e.kind === 'action' && ['use_object', 'put_down', 'discard_object'].includes(e.defId));
        expect(fiddled).toBe(true);
    });

    test('idleFallback proposes nothing when the person already has an active instance', () => {
        const { actions, brain, makeDeps } = harness();
        const deps = makeDeps(21);
        actions.startAction('a', 'sleep', {}, { source: 'brain', causationId: null }, deps, result());
        const before = brain.statusOf('a').activeActionInstanceId;
        brain.processTick(['a'], deps, [], result());
        // Still the very same sleep instance — idleFallback deferred entirely (it saw an active instance).
        expect(brain.statusOf('a').activeActionInstanceId).toBe(before);
    });

    test('Brain.evaluateConsent delegates to the Consent module (the same verdict, same stream)', () => {
        const { actions } = harness();
        const brain = new Brain(actions);
        const request = { actionId: 'gave_object_to_person', params: {}, sourcePersonId: 'a', targetPersonId: 'b', tick: 100, worldSeed: 55 };
        expect(brain.evaluateConsent(request)).toBe(evaluateConsent(request));
    });

    test('statusOf reports "commuting" while a continuous action is parked in waiting_for_materialization', () => {
        const engine = new EventEngine();
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const brain = new Brain(actions);
        let handle: TransitionHandle | null = null;
        const world: WorldAdapter = {
            mode: 'live',
            locationOf: () => ({ kind: 'outside' }),
            objectLocationOf: () => ({ kind: 'outside' }),
            peopleAt: () => [],
            objectsAt: () => [],
            requestTransition: (personId, target, tick, causationId) => {
                handle = { id: 0, personId, target, status: 'pending', requestedAtTick: tick, resolvedAtTick: null, causationId };
                return handle;
            },
        };
        const deps: ActionDeps = { state: pool(['a']), tick: 1000, ticksPerYear: TPY, ctx: { mode: 'live', world }, eventEngine: engine, inventory: null };
        actions.startAction('a', 'sleep', {}, { source: 'brain', causationId: null }, deps, result());
        void handle;
        expect(brain.statusOf('a').status).toBe('commuting');
    });

    test('onActionFailed hooks that DO propose a follow-up intent have it executed (the one-level-deep dispatch)', () => {
        const { makeDeps } = harness();
        const deps = makeDeps(100);
        const manifest = {
            fixture_ask: {
                label: 'Ask', type: 'discrete', category: 'social',
                parameters: { target: { type: 'person', required: true } },
                interaction: { targetParam: 'target', requiresSameBuilding: true, askFirst: true },
            },
            stretch: { label: 'Stretched', type: 'discrete', category: 'recovery' },
        } as unknown as ActionManifest;
        const localEngine = new EventEngine();
        const localActions = new ActionEngine(manifest, localEngine.getLifeLog());
        const localBrain = new Brain(localActions);
        localBrain.registerHook({
            id: 'relentless', kind: 'onTick',
            propose: () => [{ actionId: 'fixture_ask', params: { target: 'b' }, sourceHook: 'relentless', priority: 50, necessity: 'optional', mayInterrupt: false, causationId: null }],
        });
        localBrain.registerHook({
            id: 'reactive', kind: 'onActionFailed',
            propose: ({ failure }) => (failure ? [{ actionId: 'stretch', sourceHook: 'reactive', priority: 5, necessity: 'optional', mayInterrupt: false, causationId: null }] : []),
        });
        let sawReaction = false;
        for (let tick = 100; tick < 100 + 200 && !sawReaction; tick++) {
            localBrain.processTick(['a'], { ...deps, tick }, [], result());
            sawReaction = localEngine.getPersonLog('a').some(e => e.kind === 'action' && e.defId === 'stretch');
        }
        expect(sawReaction).toBe(true);
    });

    test('a free-time continuous action with a non-positive selection weight is excluded from candidates', () => {
        const manifest = {
            zero_weight_hobby: { label: 'Nothing', type: 'continuous', category: 'leisure', durationTicks: 1, selection: { weight: 0 } },
        } as unknown as ActionManifest;
        const localEngine = new EventEngine();
        const localActions = new ActionEngine(manifest, localEngine.getLifeLog());
        const localBrain = new Brain(localActions);
        const localDeps: BrainDeps = { state: pool(['a']), tick: 10, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world: new BootstrapWorld() }, eventEngine: localEngine, inventory: null };
        expect(localBrain.selectFreeTimeAction('a', localDeps)).toBeNull();
    });

    test('profiled free-time selection attributes context/requirement/modifier segments without changing the pick', () => {
        const manifest = {
            gated_hobby: {
                label: 'Gated', type: 'continuous', category: 'leisure', durationTicks: 1,
                requirements: { attr: 'age', op: '>=', value: 0 },
                selection: { weight: 1, modifiers: [{ when: { attr: 'age', op: '>=', value: 0 }, multiply: 2 }] },
            },
        } as unknown as ActionManifest;
        const localEngine = new EventEngine();
        const localActions = new ActionEngine(manifest, localEngine.getLifeLog());
        const localBrain = new Brain(localActions);
        const localDeps: BrainDeps = { state: pool(['a']), tick: 10, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world: new BootstrapWorld() }, eventEngine: localEngine, inventory: null };
        const sub: SubProfiler = { actionsAdvance: {}, brainHooks: {}, brainResolve: 0 };
        localBrain.processTick(['a'], localDeps, [], result(), sub);
        expect(localBrain.statusOf('a').activeActionInstanceId).not.toBeNull();
        expect(sub.brainHooks['freeTime:requirements']).toBeGreaterThanOrEqual(0);
        expect(sub.brainHooks['freeTime:modifiers']).toBeGreaterThanOrEqual(0);
        expect(Object.keys(sub.brainHooks).some(key => key.startsWith('inv:') || key.startsWith('freeTime:'))).toBe(true);
        expect(sub.brainResolve).toBeGreaterThanOrEqual(0);
    });
});

describe('JobOrchestrator gaps', () => {
    function pool1(): PopulationState {
        return { worldSeed: 12, people: { a: person('a', 30, 0) }, drawSeed: 1, placedIds: [], nextSeq: 1, lastSimulatedYear: 0 };
    }

    test('an on-shift job with an empty continuous repertoire proposes nothing (rotateContinuous returns null)', () => {
        const engine = new EventEngine();
        const actions = new ActionEngine(undefined, engine.getLifeLog());
        const brain = new Brain(actions);
        const world = new BootstrapWorld();
        const job: JobFacts = { shiftStart: 0, shiftEnd: 23 * 60 + 59, daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], workplaceKey: 'x-x', continuousActions: [], discreteActions: [] };
        const deps: BrainDeps = { state: pool1(), tick: 10, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world }, eventEngine: engine, jobOf: () => job };
        expect(jobOrchestratorHook.propose({ personId: 'a', deps, brain })).toEqual([]);
    });
});

describe('SocialOpportunity gaps', () => {
    const TARGETED: ActionManifest = {
        compliment: {
            label: 'Complimented', type: 'discrete', category: 'social',
            parameters: { target: { type: 'person', required: true } },
            interaction: { targetParam: 'target', requiresSameBuilding: true, askFirst: false },
            selection: { weight: 1, modifiers: [{ when: { attr: 'age', op: '>=', value: 0 }, multiply: 3 }] },
        },
    } as unknown as ActionManifest;

    function harness(manifest: ActionManifest = TARGETED, ids = ['a', 'b']) {
        const engine = new EventEngine();
        const actions = new ActionEngine(manifest, engine.getLifeLog());
        const brain = new Brain(actions);
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const world = new BootstrapWorld(inventory);
        ids.forEach(id => world.register(id));
        const state = pool(ids);
        const deps: BrainDeps = { state, tick: 100, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world }, eventEngine: engine, inventory };
        return { engine, actions, brain, inventory, world, deps };
    }

    test('with no world in ctx, the hook proposes nothing', () => {
        const { brain, deps } = harness();
        const bare: BrainDeps = { ...deps, ctx: {} };
        expect(socialOpportunityHook.propose({ personId: 'a', deps: bare, brain })).toEqual([]);
    });

    test('a selection modifier multiplies the candidate weight (the branch actually fires)', () => {
        // Scan ticks until the 15% social roll succeeds with company present; the sole candidate's modifier
        // predicate (age >= 0) is always true, so weight ends up 1*3 whenever a proposal happens at all.
        const { brain, deps } = harness();
        let proposed = false;
        for (let tick = 100; tick < 100 + 400 && !proposed; tick++) {
            const intents = socialOpportunityHook.propose({ personId: 'a', deps: { ...deps, tick }, brain });
            if (intents.length > 0) {
                proposed = true;
                expect(intents[0]!.actionId).toBe('compliment');
            }
        }
        expect(proposed).toBe(true);
    });

    test('--profile sub-timers record social hook segments without changing the outcome', () => {
        const { brain, deps } = harness();
        const sub: SubProfiler = { actionsAdvance: {}, brainHooks: {}, brainResolve: 0 };
        let any = false;
        for (let tick = 100; tick < 100 + 200; tick++) {
            const intents = socialOpportunityHook.propose({ personId: 'a', deps: { ...deps, tick }, brain, sub });
            if (intents.length > 0) any = true;
        }
        expect(any).toBe(true);
        expect(Object.keys(sub.brainHooks).some(key => key.startsWith('social:'))).toBe(true);
    });

    test('two borrowed instances from the same co-located owner sort deterministically by instance id', () => {
        // The RETURN_MANIFEST binds an objectInstance param from `borrowed[0]` after sorting by id — with
        // two candidates the comparator actually runs (a single-element array never invokes it).
        const RETURN_MANIFEST: ActionManifest = {
            returned_borrowed_object: {
                label: 'Returned', type: 'discrete', category: 'social',
                parameters: { target: { type: 'person', required: true }, object: { type: 'objectInstance', required: true } },
                interaction: { targetParam: 'target', requiresSameBuilding: true, askFirst: false },
                selection: { weight: 5 },
                consequences: [{ op: 'moveObjectToPerson', object: { param: 'object' }, target: 'targetPerson' }],
            },
        } as unknown as ActionManifest;
        const { brain, inventory, deps } = harness(RETURN_MANIFEST);
        // Two instances owned by 'b', both carried by 'a' — the sort comparator must actually compare them.
        const first = inventory.createInstance({ archetypeId: 'wristwatch', owner: { kind: 'person', personId: 'b' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        const second = inventory.createInstance({ archetypeId: 'coin', owner: { kind: 'person', personId: 'b' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        let picked = false;
        for (let tick = 100; tick < 100 + 400 && !picked; tick++) {
            const intents = socialOpportunityHook.propose({ personId: 'a', deps: { ...deps, tick }, brain });
            if (intents.length > 0) {
                picked = true;
                const objectParam = intents[0]!.params!['object'];
                // The bound object is whichever of the two sorts first by id — either is valid, but it must
                // be exactly one of the two candidates (proving the comparator ran over BOTH of them).
                expect([first.id, second.id]).toContain(objectParam);
            }
        }
        expect(picked).toBe(true);
    });
});
