import ActionEngine, { ActionDeps, interleave } from 'game/actions/ActionEngine';
import { evaluateConsent } from 'game/actions/Consent';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import EventEngine from 'game/events/EventEngine';
import Inventory from 'game/objects/Inventory';
import { ActionManifest, ActionStartOutcome } from 'types/Action';
import { LogicalLocation, SubProfiler, TransitionHandle, TransitionStatus, WorldAdapter } from 'types/Execution';
import { GenPerson, PersonTable, PopulationState } from 'types/Genealogy';
import { EventManifest, TickResult } from 'types/LifeEvent';
import { locationKey } from 'types/Objects';
import { Genders } from 'types/Social';

// Deep behavior of the Action engine's own orchestration (task 043): pool/sequence children, the location
// transition boundary (040), interruption, consent-decline routing through sequences (073/074), and the
// per-instance active index (078) — the machinery Consequences.ts's commits run inside of.
// consequences.test.ts already exercises the discrete/OAR/sequence-completion path end-to-end (the bake
// chain); this file covers the surrounding lifecycle plumbing that scenario never touches. Every harness
// below shares ONE LifeLog between the ActionEngine and EventEngine, exactly like production TickRunner
// wiring (game/City.ts) and consequences.test.ts's own harness() — actions and events are only ever
// observable on the same log when they share the instance.

const TPY = 8640;

// Narrows a (possibly failing) start outcome to its instance id, failing the test loudly (not silently
// returning undefined) if the start didn't actually succeed with a continuous instance.
function instanceIdOf(outcome: ActionStartOutcome): string {
    if (!outcome.ok) {
        throw new Error(`expected a successful start, got failure: ${outcome.reason}`);
    }
    if (!outcome.instanceId) {
        throw new Error('expected a continuous instance id, got a discrete outcome');
    }
    return outcome.instanceId;
}

function person(id: string): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function pool(ids: string[] = ['a', 'b']): PopulationState {
    const table: PersonTable = {};
    for (const id of ids) {
        table[id] = person(id);
    }
    return { worldSeed: 44, people: table, drawSeed: 1, placedIds: [], nextSeq: 100, lastSimulatedYear: 0 };
}

const cause = { source: 'system' as const, causationId: null };
const emptyResult = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });

// A controllable WorldAdapter (unlike BootstrapWorld, whose transitions always resolve immediately): lets
// tests drive the waiting_for_materialization / blocked lifecycle branches (materialize()) directly.
class ScriptedWorld implements WorldAdapter {
    readonly mode = 'live' as const;
    private locations = new Map<string, LogicalLocation>();
    private nextHandleId = 0;
    private scripted: TransitionStatus[] = [];
    handles: TransitionHandle[] = [];

    setLocation(personId: string, loc: LogicalLocation): void {
        this.locations.set(personId, loc);
    }

    // Queues the status the NEXT requestTransition call should return (defaults to 'arrived' when empty).
    scriptNext(...statuses: TransitionStatus[]): void {
        this.scripted.push(...statuses);
    }

    locationOf(personId: string): LogicalLocation {
        return this.locations.get(personId) ?? { kind: 'home' };
    }

    objectLocationOf(personId: string): LogicalLocation {
        return this.locationOf(personId);
    }

    peopleAt(location: LogicalLocation): string[] {
        const ids: string[] = [];
        for (const [id, loc] of this.locations) {
            if (locationKey(loc) === locationKey(location)) {
                ids.push(id);
            }
        }
        return ids.sort();
    }

    objectsAt(): string[] {
        return [];
    }

    hasVenue(): boolean {
        return true;
    }

    requestTransition(personId: string, target: LogicalLocation, tick: number, causationId: number | null): TransitionHandle {
        const status = this.scripted.shift() ?? 'arrived';
        const handle: TransitionHandle = { id: this.nextHandleId++, personId, target, status, requestedAtTick: tick, resolvedAtTick: status === 'pending' ? null : tick, causationId };
        if (status === 'arrived') {
            this.locations.set(personId, target);
        }
        this.handles.push(handle);
        return handle;
    }

    // Test helper: flips a still-pending handle to arrived and moves the person, mimicking the visual layer.
    resolveArrival(handle: TransitionHandle): void {
        handle.status = 'arrived';
        this.locations.set(handle.personId, handle.target);
    }
}

// The shared harness every test builds from: one EventEngine + one ActionEngine over the SAME LifeLog, plus
// a ready ActionDeps. `eventsManifest` defaults to empty (no probabilistic/automated events to interfere).
function harness(
    actionManifest: ActionManifest,
    options: { eventsManifest?: EventManifest; ids?: string[]; tick?: number; ctx?: ActionDeps['ctx']; inventory?: Inventory | null } = {}
): { actions: ActionEngine; engine: EventEngine; d: ActionDeps; state: PopulationState } {
    const engine = new EventEngine(options.eventsManifest ?? ({} as unknown as EventManifest));
    const actions = new ActionEngine(actionManifest, engine.getLifeLog());
    const state = pool(options.ids ?? ['a', 'b']);
    const inventory = options.inventory === undefined ? new Inventory() : options.inventory;
    // Same-building interaction checks (task 072) need a WorldAdapter even off-map — everyone defaults to
    // the same 'home' location under BootstrapWorld, mirroring how consequences.test.ts's own harness works.
    const ctx = options.ctx ?? { mode: 'bootstrap' as const, world: new BootstrapWorld(inventory) };
    const d: ActionDeps = {
        state, tick: options.tick ?? 1000, ticksPerYear: TPY,
        ctx, eventEngine: engine, inventory,
    };
    return { actions, engine, d, state };
}

describe('ActionEngine — starting: validation & the interaction contract', () => {
    const MANIFEST: ActionManifest = {
        chat: {
            label: 'Chatted', type: 'discrete', category: 'social',
            parameters: { target: { type: 'person', required: true } },
            interaction: { targetParam: 'target', requiresSameBuilding: true, askFirst: false },
        },
        self_reflect: {
            label: 'Reflected', type: 'discrete', category: 'leisure',
            parameters: { target: { type: 'person', required: true } },
            interaction: { targetParam: 'target', requiresSameBuilding: true, askFirst: false, allowSelf: true },
        },
        needs_param: { label: 'Needs param', type: 'discrete', category: 'leisure', parameters: { foo: { type: 'string', required: true } } },
        gated: { label: 'Gated', type: 'discrete', category: 'leisure', requirements: { attr: 'age', op: '>=', value: 999 } },
    } as unknown as ActionManifest;

    test('unknownAction / missingParameter / invalidParent', () => {
        const { actions, d } = harness(MANIFEST);
        expect(actions.startAction('a', 'ghost', {}, cause, d, emptyResult())).toEqual({ ok: false, reason: 'unknownAction' });
        expect(actions.startAction('a', 'needs_param', {}, cause, d, emptyResult())).toEqual({ ok: false, reason: 'missingParameter' });
        expect(actions.startAction('a', 'needs_param', { foo: 'x' }, cause, d, emptyResult(), 'ghost-instance')).toEqual({ ok: false, reason: 'invalidParent' });
    });

    test('a dead actor cannot start anything (requirementsUnmet)', () => {
        const { actions, d } = harness(MANIFEST);
        d.state.people['a']!.deathTick = 900;
        expect(actions.startAction('a', 'needs_param', { foo: 'x' }, cause, d, emptyResult())).toEqual({ ok: false, reason: 'requirementsUnmet' });
    });

    test('a failed requirements predicate rejects the start', () => {
        const { actions, d } = harness(MANIFEST);
        expect(actions.startAction('a', 'gated', {}, cause, d, emptyResult())).toEqual({ ok: false, reason: 'requirementsUnmet' });
    });

    test('targetNotPresent: missing target, dead target, self without allowSelf, different building', () => {
        const world = new ScriptedWorld();
        const { actions, d } = harness(MANIFEST, { ids: ['a', 'b', 'c'], ctx: { mode: 'live', world } });
        expect(actions.startAction('a', 'chat', {}, cause, d, emptyResult())).toEqual({ ok: false, reason: 'missingParameter' }); // target is a required param
        expect(actions.startAction('a', 'chat', { target: 'a' }, cause, d, emptyResult())).toEqual({ ok: false, reason: 'targetNotPresent' }); // self, no allowSelf

        d.state.people['b']!.deathTick = 900;
        expect(actions.startAction('a', 'chat', { target: 'b' }, cause, d, emptyResult())).toEqual({ ok: false, reason: 'targetNotPresent' }); // dead

        world.setLocation('a', { kind: 'building', key: '1-1' });
        world.setLocation('c', { kind: 'building', key: '2-2' });
        expect(actions.startAction('a', 'chat', { target: 'c' }, cause, d, emptyResult())).toEqual({ ok: false, reason: 'targetNotPresent' }); // different building

        world.setLocation('c', { kind: 'building', key: '1-1' });
        expect(actions.startAction('a', 'chat', { target: 'c' }, cause, d, emptyResult())).toEqual({ ok: true, instanceId: null, logSeq: 0 });
    });

    test('allowSelf lets an action target its own actor', () => {
        const { actions, d } = harness(MANIFEST);
        expect(actions.startAction('a', 'self_reflect', { target: 'a' }, cause, d, emptyResult())).toEqual({ ok: true, instanceId: null, logSeq: 0 });
    });
});

describe('ActionEngine — consent (task 073/074)', () => {
    const MANIFEST: ActionManifest = {
        ask_favor: {
            label: 'Asked a favor', type: 'discrete', category: 'social',
            parameters: { target: { type: 'person', required: true } },
            interaction: { targetParam: 'target', requiresSameBuilding: true, askFirst: true },
            events: { onDecline: 'favor_declined' },
        },
    } as unknown as ActionManifest;
    const EVENTS_WITH_DECLINE: EventManifest = {
        favor_declined: { roles: { subject: { where: { attr: 'alive', op: '==', value: true } } }, triggers: { manual: {} }, effects: [{ type: 'emit', signal: 'declined', target: 'subject' }] },
    } as unknown as EventManifest;

    // Consent is a deterministic 80% yes on a salted stream keyed by (worldSeed, tick, source, target, action).
    // Brute-force the smallest tick that declines/accepts for our fixed ids so the test is exact, not flaky.
    function findTick(worldSeed: number, source: string, target: string, actionId: string, wantAccept: boolean): number {
        for (let tick = 0; tick < 1000; tick++) {
            if (evaluateConsent({ actionId, params: {}, sourcePersonId: source, targetPersonId: target, tick, worldSeed }) === wantAccept) {
                return tick;
            }
        }
        throw new Error('no matching tick found in range');
    }

    test('a decline records a typed failed log entry, counts toward action history, and fires onDecline', () => {
        const declineTick = findTick(44, 'a', 'b', 'ask_favor', false);
        const { actions, engine, d } = harness(MANIFEST, { eventsManifest: EVENTS_WITH_DECLINE, tick: declineTick });

        const result = emptyResult();
        const outcome = actions.startAction('a', 'ask_favor', { target: 'b' }, cause, d, result);
        expect(outcome).toEqual({ ok: false, reason: 'consentDeclined' });
        expect(engine.getPersonLog('a')[0]).toMatchObject({ kind: 'action', lifecycle: 'failed', failureReason: 'consent_declined' });
        expect(actions.hasAction('a', 'ask_favor', declineTick)).toBe(true); // attempts count even when declined
        // onDecline fires on the ACTOR's log (fireEvent is invoked with the actor's personId, not the target's).
        expect(engine.getPersonLog('a')[1]).toMatchObject({ defId: 'favor_declined', triggerSource: 'action' });
        expect(result.signals.some(s => s.signal === 'declined')).toBe(true);
    });

    test('an accepting tick starts the action normally', () => {
        const acceptTick = findTick(44, 'a', 'b', 'ask_favor', true);
        const { actions, d } = harness(MANIFEST, { eventsManifest: EVENTS_WITH_DECLINE, tick: acceptTick });
        expect(actions.startAction('a', 'ask_favor', { target: 'b' }, cause, d, emptyResult()).ok).toBe(true);
    });
});

describe('ActionEngine — pool children', () => {
    const MANIFEST: ActionManifest = {
        loiter: {
            label: 'Loitered', type: 'continuous', category: 'leisure', durationTicks: 5,
            children: {
                mode: 'pool',
                entries: [
                    { action: 'always_hum', chancePerTick: 1, maxPerTick: 2 }, // both slots fire every tick
                    { action: 'once_only', chancePerTick: 1, maxTotal: 1 },
                    { action: 'gated_child', chancePerTick: 1, requirements: { attr: 'gateOpen', op: '==', value: true } },
                    { action: 'cooldown_child', chancePerTick: 1, cooldownTicks: 3 },
                ],
            },
        },
        always_hum: { label: 'Hummed', type: 'discrete', category: 'leisure' },
        once_only: { label: 'Did it once', type: 'discrete', category: 'leisure' },
        gated_child: { label: 'Gated child', type: 'discrete', category: 'leisure' },
        cooldown_child: { label: 'Cooldown child', type: 'discrete', category: 'leisure' },
    } as unknown as ActionManifest;

    test('cooldown, maxTotal, and a permanently-closed requirements gate all apply', () => {
        const { actions, d } = harness(MANIFEST, { tick: 0 });
        const start = actions.startAction('a', 'loiter', {}, cause, d, emptyResult());
        expect(start.ok).toBe(true);

        for (let tick = 1; tick <= 5; tick++) {
            actions.advance({ ...d, tick });
        }
        // always_hum fires both slots every running tick (maxPerTick 2); once_only caps at 1 total even
        // though its chance is certain every tick; gated_child never fires (gate closed); cooldown_child
        // fires only every 3rd tick given cooldownTicks 3.
        expect(actions.hasAction('a', 'always_hum', 10, { minCount: 2 })).toBe(true);
        expect(actions.hasAction('a', 'once_only', 10, { minCount: 1 })).toBe(true);
        expect(actions.hasAction('a', 'once_only', 10, { minCount: 2 })).toBe(false); // maxTotal: 1
        expect(actions.hasAction('a', 'gated_child', 10)).toBe(false);
        expect(actions.hasAction('a', 'cooldown_child', 10, { minCount: 1 })).toBe(true);
    });

    test('a per-child requirements gate blocks until the predicate is true, then lets the child through', () => {
        const gatedManifest: ActionManifest = {
            ...MANIFEST,
            loiter2: {
                label: 'Loitered', type: 'continuous', category: 'leisure',
                children: { mode: 'pool', entries: [{ action: 'gated_child', chancePerTick: 1, requirements: { attr: 'hourOfDay', op: '==', value: 5 } }] },
            },
        } as unknown as ActionManifest;
        const { actions, d } = harness(gatedManifest, { tick: 0 });
        const start = actions.startAction('a', 'loiter2', {}, cause, d, emptyResult());
        expect(start.ok).toBe(true);
        actions.advance({ ...d, tick: 6 }); // hourOfDay(6) = 6 -> gate closed
        expect(actions.hasAction('a', 'gated_child', 6)).toBe(false);
        actions.advance({ ...d, tick: 29 }); // hourOfDay(29) = 5 (29 % 24) -> gate open
        expect(actions.hasAction('a', 'gated_child', 29)).toBe(true);
        expect(actions.getInstance(instanceIdOf(start))).not.toBeNull(); // no durationTicks -> still running
    });
});

describe('ActionEngine — sequence children & step-failure policies', () => {
    const base: ActionManifest = {
        step_ok: { label: 'Step ok', type: 'discrete', category: 'leisure' },
        step_missing_param: { label: 'Step missing param', type: 'discrete', category: 'leisure', parameters: { need: { type: 'string', required: true } } },
    };

    test('skipStep advances past a failing step instead of blocking', () => {
        const manifest: ActionManifest = {
            ...base,
            skippy: {
                label: 'Skippy', type: 'continuous', category: 'leisure',
                children: { mode: 'sequence', onStepFailure: 'skipStep', steps: [{ action: 'step_missing_param' }, { action: 'step_ok' }] },
            },
        } as unknown as ActionManifest;
        const { actions, d } = harness(manifest, { tick: 0 });
        const start = actions.startAction('a', 'skippy', {}, cause, d, emptyResult());
        expect(start.ok).toBe(true);
        actions.advance({ ...d, tick: 1 }); // step 1 fails (missing param) -> skipStep -> index advances
        actions.advance({ ...d, tick: 2 }); // step 2 (step_ok) runs -> sequence completes
        actions.advance({ ...d, tick: 3 });
        expect(actions.hasAction('a', 'step_ok', 3)).toBe(true);
        expect(actions.getInstance(instanceIdOf(start))).toBeNull(); // completed instances are pruned (task 078)
    });

    test('failParent ends the whole sequence as failed', () => {
        const manifest: ActionManifest = {
            ...base,
            faily: {
                label: 'Faily', type: 'continuous', category: 'leisure',
                children: { mode: 'sequence', onStepFailure: 'failParent', steps: [{ action: 'step_missing_param' }] },
            },
        } as unknown as ActionManifest;
        const { actions, engine, d } = harness(manifest, { tick: 1000 });
        actions.startAction('a', 'faily', {}, cause, d, emptyResult());
        actions.advance({ ...d, tick: 1001 });
        const entry = engine.getPersonLog('a').find(e => e.kind === 'action' && e.lifecycle === 'failed');
        expect(entry).toBeDefined();
    });

    test('blockParent (the default) leaves the parent blocked, not failed', () => {
        const manifest: ActionManifest = {
            ...base,
            blocky: {
                label: 'Blocky', type: 'continuous', category: 'leisure',
                children: { mode: 'sequence', steps: [{ action: 'step_missing_param' }] }, // no onStepFailure -> defaults to blockParent
            },
        } as unknown as ActionManifest;
        const { actions, engine, d } = harness(manifest, { tick: 1000 });
        actions.startAction('a', 'blocky', {}, cause, d, emptyResult());
        actions.advance({ ...d, tick: 1001 });
        const entry = engine.getPersonLog('a').find(e => e.kind === 'action' && e.lifecycle === 'blocked');
        expect(entry).toBeDefined();
    });

    test('a consent-declined step routes through its OWN onDecline policy, overriding onStepFailure', () => {
        const manifest: ActionManifest = {
            ...base,
            polite_ask: {
                label: 'Politely asked', type: 'discrete', category: 'social',
                parameters: { target: { type: 'person', required: true } },
                interaction: { targetParam: 'target', requiresSameBuilding: true, askFirst: true, onDecline: 'skipStep' },
            },
            courteous_sequence: {
                label: 'Courteous sequence', type: 'continuous', category: 'social',
                // onStepFailure defaults to blockParent — the decline must still skip via its OWN onDecline.
                children: { mode: 'sequence', steps: [{ action: 'polite_ask', params: { target: 'b' } }, { action: 'step_ok' }] },
            },
        } as unknown as ActionManifest;
        let declineTick = 1000;
        while (evaluateConsent({ actionId: 'polite_ask', params: {}, sourcePersonId: 'a', targetPersonId: 'b', tick: declineTick, worldSeed: 44 })) {
            declineTick++;
        }
        const { actions, d } = harness(manifest, { tick: declineTick });
        actions.startAction('a', 'courteous_sequence', {}, cause, d, emptyResult());
        actions.advance({ ...d, tick: declineTick + 1 }); // step 1 declines -> onDecline skipStep -> index advances
        actions.advance({ ...d, tick: declineTick + 2 }); // step 2 runs -> completes
        actions.advance({ ...d, tick: declineTick + 3 });
        expect(actions.hasAction('a', 'step_ok', declineTick + 3)).toBe(true);
    });
});

describe('ActionEngine — completion modes', () => {
    test('durationTicks completes after the configured number of running ticks', () => {
        const manifest: ActionManifest = { nap: { label: 'Napped', type: 'continuous', category: 'recovery', durationTicks: 2 } } as unknown as ActionManifest;
        const { actions, engine, d } = harness(manifest, { tick: 0 });
        const start = actions.startAction('a', 'nap', {}, cause, d, emptyResult());
        actions.advance({ ...d, tick: 1 });
        expect(actions.getInstance(instanceIdOf(start))).not.toBeNull(); // still running (1 tick elapsed)
        actions.advance({ ...d, tick: 2 });
        const entry = engine.getPersonLog('a').find(e => e.kind === 'action' && e.lifecycle === 'completed');
        expect(entry).toBeDefined();
    });

    test('completeWhen finishes once the predicate is true', () => {
        const manifest: ActionManifest = {
            wait_for_five: { label: 'Waited', type: 'continuous', category: 'leisure', completeWhen: { attr: 'hourOfDay', op: '==', value: 5 } },
        } as unknown as ActionManifest;
        const { actions, engine, d } = harness(manifest, { tick: 3 });
        actions.startAction('a', 'wait_for_five', {}, cause, d, emptyResult());
        actions.advance({ ...d, tick: 4 }); // hourOfDay 4 -> not yet
        expect(engine.getPersonLog('a').some(e => e.kind === 'action' && e.lifecycle === 'completed')).toBe(false);
        actions.advance({ ...d, tick: 5 }); // hourOfDay 5 -> completes
        expect(engine.getPersonLog('a').some(e => e.kind === 'action' && e.lifecycle === 'completed')).toBe(true);
    });
});

describe('ActionEngine — interruption & death mid-run', () => {
    const manifest: ActionManifest = { idle: { label: 'Idling', type: 'continuous', category: 'leisure', durationTicks: 100 } } as unknown as ActionManifest;

    test('interrupt() ends an active instance and returns false for an unknown/inactive one', () => {
        const { actions, d } = harness(manifest, { tick: 0 });
        const start = actions.startAction('a', 'idle', {}, cause, d, emptyResult());
        expect(actions.interrupt(instanceIdOf(start), cause, d, emptyResult())).toBe(true);
        expect(actions.getInstance(instanceIdOf(start))).toBeNull(); // pruned
        expect(actions.interrupt(instanceIdOf(start), cause, d, emptyResult())).toBe(false); // already gone
        expect(actions.interrupt('never-existed', cause, d, emptyResult())).toBe(false);
    });

    test('advance() auto-interrupts an instance whose person died', () => {
        const { actions, engine, d } = harness(manifest, { tick: 0 });
        actions.startAction('a', 'idle', {}, cause, d, emptyResult());
        d.state.people['a']!.deathTick = 1;
        actions.advance({ ...d, tick: 2 });
        expect(engine.getPersonLog('a').some(e => e.kind === 'action' && e.lifecycle === 'interrupted')).toBe(true);
    });

    test('a second continuous action cannot start while one is already active', () => {
        const { actions, d } = harness(manifest, { tick: 0 });
        actions.startAction('a', 'idle', {}, cause, d, emptyResult());
        expect(actions.startAction('a', 'idle', {}, cause, d, emptyResult())).toEqual({ ok: false, reason: 'alreadyActive' });
    });
});

describe('ActionEngine — location transitions (execution boundary, task 040)', () => {
    const manifest: ActionManifest = { commute_task: { label: 'Commuted', type: 'continuous', category: 'work', location: 'building:5-5', durationTicks: 1 } } as unknown as ActionManifest;

    test('a pending transition parks the instance in waiting_for_materialization; arrival lets it start running', () => {
        const world = new ScriptedWorld();
        world.scriptNext('pending');
        const { actions, engine, d } = harness(manifest, { tick: 0, ctx: { mode: 'live', world } });
        const start = actions.startAction('a', 'commute_task', {}, cause, d, emptyResult());
        expect(start.ok).toBe(true);
        expect(actions.getInstance(instanceIdOf(start))!.status).toBe('waiting_for_materialization');
        expect(engine.getPersonLog('a').some(e => e.kind === 'action' && e.lifecycle === 'started')).toBe(false);

        // The visual layer resolves arrival; the next advance() re-checks the same handle and enters running.
        world.resolveArrival(world.handles[0]!);
        actions.advance({ ...d, tick: 1 });
        expect(actions.getInstance(instanceIdOf(start))!.status).toBe('running');
        expect(engine.getPersonLog('a').some(e => e.kind === 'action' && e.lifecycle === 'started')).toBe(true);
    });

    test('a cancelled transition blocks the action (no route to the required location)', () => {
        const world = new ScriptedWorld();
        world.scriptNext('cancelled');
        const { actions, engine, d } = harness(manifest, { tick: 0, ctx: { mode: 'live', world } });
        const start = actions.startAction('a', 'commute_task', {}, cause, d, emptyResult());
        expect(start.ok).toBe(true);
        const entry = engine.getPersonLog('a').find(e => e.kind === 'action' && e.lifecycle === 'blocked');
        expect(entry).toBeDefined();
    });

    test('an immediately-arriving transition (no visual wait) requests once and runs straight away', () => {
        const world = new ScriptedWorld(); // no scriptNext queued -> requestTransition defaults to 'arrived'
        const { actions, d } = harness(manifest, { tick: 0, ctx: { mode: 'live', world } });
        const start = actions.startAction('a', 'commute_task', {}, cause, d, emptyResult());
        expect(actions.getInstance(instanceIdOf(start))!.status).toBe('running');
        expect(world.handles).toHaveLength(1);
        expect(world.locationOf('a')).toEqual({ kind: 'building', key: '5-5' });
    });

    test('already being at the required location skips the transition entirely', () => {
        const world = new ScriptedWorld();
        world.setLocation('a', { kind: 'building', key: '5-5' });
        const { actions, d } = harness(manifest, { tick: 0, ctx: { mode: 'live', world } });
        const start = actions.startAction('a', 'commute_task', {}, cause, d, emptyResult());
        expect(actions.getInstance(instanceIdOf(start))!.status).toBe('running'); // no transition requested
        expect(world.handles).toHaveLength(0);
    });
});

describe('ActionEngine — event links & payload mapping (task 067)', () => {
    test('the object EventLink form maps $params.<name> and literal scalars into the fired event payload', () => {
        const manifest: ActionManifest = {
            report_mood: {
                label: 'Reported mood', type: 'discrete', category: 'social',
                parameters: { mood: { type: 'string', required: true } },
                events: { onComplete: { event: 'mood_logged', params: { mood: '$params.mood', source: 'action' } } },
            },
        } as unknown as ActionManifest;
        const eventsManifest: EventManifest = {
            mood_logged: {
                roles: { subject: { where: { attr: 'alive', op: '==', value: true } } },
                triggers: { manual: {} },
                parameters: { mood: { type: 'string' }, source: { type: 'string' } },
                effects: [],
            },
        } as unknown as EventManifest;
        const { actions, engine, d } = harness(manifest, { eventsManifest, tick: 0 });
        actions.startAction('a', 'report_mood', { mood: 'happy' }, cause, d, emptyResult());
        const entry = engine.getPersonLog('a').find(e => e.kind === 'event') as { params?: Record<string, unknown> };
        expect(entry?.params).toEqual({ mood: 'happy', source: 'action' });
    });

    test('the string EventLink shorthand fires with no payload', () => {
        const manifest: ActionManifest = {
            wave: { label: 'Waved', type: 'discrete', category: 'social', events: { onComplete: 'waved_event' } },
        } as unknown as ActionManifest;
        const eventsManifest: EventManifest = {
            waved_event: { roles: { subject: { where: { attr: 'alive', op: '==', value: true } } }, triggers: { manual: {} }, effects: [] },
        } as unknown as EventManifest;
        const { actions, engine, d } = harness(manifest, { eventsManifest, tick: 0 });
        actions.startAction('a', 'wave', {}, cause, d, emptyResult());
        expect(engine.getPersonLog('a').some(e => e.kind === 'event' && e.defId === 'waved_event')).toBe(true);
    });
});

describe('ActionEngine — hasAction / labels / definitions', () => {
    const manifest: ActionManifest = {
        labeled: { label: 'A Labeled Thing', type: 'discrete', category: 'leisure' },
        unlabeled_thing: { label: '', type: 'discrete', category: 'leisure' },
    } as unknown as ActionManifest;

    test('hasAction respects minCount and withinTicks', () => {
        const { actions, d } = harness(manifest, { tick: 1000 });
        actions.startAction('a', 'labeled', {}, cause, d, emptyResult());
        expect(actions.hasAction('a', 'labeled', 1000)).toBe(true);
        expect(actions.hasAction('a', 'labeled', 1000, { minCount: 2 })).toBe(false);
        expect(actions.hasAction('a', 'labeled', 1000, { withinTicks: 0 })).toBe(true);
        expect(actions.hasAction('a', 'labeled', 5000, { withinTicks: 10 })).toBe(false);
        expect(actions.hasAction('a', 'never_done', 1000)).toBe(false);
    });

    test('getActionLabel falls back to a prettified id when no label is authored', () => {
        const { actions } = harness(manifest);
        expect(actions.getActionLabel('labeled')).toBe('A Labeled Thing');
        expect(actions.getActionLabel('unlabeled_thing')).toBe('Unlabeled Thing');
        expect(actions.getActionLabel('totally_unknown')).toBe('Totally Unknown');
    });

    test('getDefinition/getManifest expose the loaded manifest', () => {
        const { actions } = harness(manifest);
        expect(actions.getDefinition('labeled')).toEqual(manifest['labeled']);
        expect(actions.getDefinition('ghost')).toBeNull();
        expect(actions.getManifest()).toBe(manifest);
    });
});

describe('ActionEngine — sequence param bindings ($parent./$previous.)', () => {
    test('$parent reads the parent instance params; $previous reads the prior step output; literals pass through', () => {
        const manifest: ActionManifest = {
            source_coin: {
                label: 'Sourced a coin', type: 'discrete', category: 'work',
                consequences: [{ op: 'createObject', archetype: 'coin', owner: 'person', container: 'possessions', bindAs: 'coin' }],
            },
            report: {
                label: 'Reported', type: 'discrete', category: 'work',
                parameters: { flavor: { type: 'string', required: true }, coinRef: { type: 'objectInstance' } },
            },
            work_sequence: {
                label: 'Work sequence', type: 'continuous', category: 'work',
                parameters: { flavor: { type: 'string' } },
                children: {
                    mode: 'sequence',
                    steps: [
                        { action: 'source_coin' },
                        { action: 'report', params: { flavor: '$parent.flavor', coinRef: '$previous.coin', literalTag: 'fixed' } },
                    ],
                },
            },
        } as unknown as ActionManifest;
        const { actions, engine, d } = harness(manifest, { tick: 0 });
        actions.startAction('a', 'work_sequence', { flavor: 'cheerful' }, cause, d, emptyResult());
        actions.advance({ ...d, tick: 1 }); // step 1: source_coin
        actions.advance({ ...d, tick: 2 }); // step 2: report, reading bindings from step 1's output + parent params
        const reportEntry = engine.getPersonLog('a').find(e => e.kind === 'action' && e.defId === 'report') as { params: Record<string, unknown> };
        expect(reportEntry.params['flavor']).toBe('cheerful');
        expect(typeof reportEntry.params['coinRef']).toBe('string'); // resolved to the created coin's instance id
        expect(reportEntry.params['literalTag']).toBe('fixed');
    });
});

describe('ActionEngine — state serialization & the active-instance index (task 078)', () => {
    const manifest: ActionManifest = { idle: { label: 'Idling', type: 'continuous', category: 'leisure', durationTicks: 100 } } as unknown as ActionManifest;

    test('getState/loadState round-trips and rebuildActiveIndex restores activeInstanceOf', () => {
        const { actions, d } = harness(manifest, { tick: 0 });
        const start = actions.startAction('a', 'idle', {}, cause, d, emptyResult());
        expect(actions.activeInstanceOf('a')!.id).toBe(instanceIdOf(start));

        const snapshot = JSON.parse(JSON.stringify(actions.getState()));
        const restored = new ActionEngine(manifest);
        restored.loadState(snapshot);
        expect(restored.activeInstanceOf('a')!.id).toBe(instanceIdOf(start));
        expect(restored.getInstance(instanceIdOf(start))).not.toBeNull();
    });

    test('loadState with no state defaults to empty and activeInstanceOf returns null', () => {
        const actions = new ActionEngine(manifest);
         
        actions.loadState(undefined as any);
        expect(actions.activeInstanceOf('a')).toBeNull();
        expect(actions.getState()).toEqual({ instances: {}, nextInstanceSeq: 0, actionHistory: {} });
    });
});

describe('ActionEngine — --profile sub-timing (task 079)', () => {
    test('advance() attributes wall-clock across scan/materialize/pool/sequence/duration/completeWhen phases', () => {
        const manifest: ActionManifest = {
            profiled: {
                label: 'Profiled', type: 'continuous', category: 'leisure', durationTicks: 1,
                children: { mode: 'pool', entries: [{ action: 'tick_child', chancePerTick: 1 }] },
            },
            tick_child: { label: 'Tick child', type: 'discrete', category: 'leisure' },
        } as unknown as ActionManifest;
        const { actions, d } = harness(manifest, { tick: 0 });
        actions.startAction('a', 'profiled', {}, cause, d, emptyResult());
        const sub: SubProfiler = { brainHooks: {}, brainResolve: 0, actionsAdvance: {} };
        actions.advance({ ...d, tick: 1 }, sub);
        expect(Object.keys(sub.actionsAdvance).length).toBeGreaterThan(0);
        expect(sub.actionsAdvance['scan']).toBeGreaterThanOrEqual(0);
    });
});

describe('interleave() — pool-child occurrence ordering', () => {
    test('empty input yields empty output', () => {
        expect(interleave([])).toEqual([]);
    });

    test('a single occurrence passes through unchanged', () => {
        expect(interleave(['x'])).toEqual(['x']);
    });

    test('never repeats the same id back-to-back when a balanced alternative exists', () => {
        // 3 x's + 2 y's: the greedy highest-count-first rule alternates perfectly here.
        expect(interleave(['x', 'x', 'x', 'y', 'y'])).toEqual(['x', 'y', 'x', 'y', 'x']);
    });

    test('falls back to a forced repeat once only one id remains', () => {
        // Three x's and one y: x,y,x,x is the only order with no avoidable repeat.
        const ordered = interleave(['x', 'x', 'x', 'y']);
        expect(ordered).toEqual(['x', 'y', 'x', 'x']);
    });

    test('ties break by id (deterministic)', () => {
        expect(interleave(['b', 'a'])).toEqual(['a', 'b']); // both count 1 -> alphabetical
    });
});
