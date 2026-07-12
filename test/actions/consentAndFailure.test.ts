import ActionEngine, { ActionDeps } from 'game/actions/ActionEngine';
import Brain, { BrainDeps, BrainHook, ActionIntent } from 'game/actions/Brain';
import { evaluateConsent } from 'game/actions/Consent';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import actionsConfig from 'json/actions.json';
import eventsConfig from 'json/events.json';
import { ActionManifest } from 'types/Action';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { TickResult, ActionLogEntry } from 'types/LifeEvent';
import { Genders } from 'types/Social';

// Consent evaluation & typed action failure (task 073): the placeholder 80%-yes policy is deterministic and
// stream-isolated; a decline is a zero-mutation, fully-logged 'failed' outcome that Brain consumes without
// retrying; sequence children resolve declines through onDecline/onStepFailure; and the completion-plan
// downgrade finally carries its reason.

const TPY = 8640;
const SEED = 9;
const ACTIONS = actionsConfig as unknown as ActionManifest;

function person(id: string, ageYears = 30): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -ageYears * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function harness(ids: string[] = ['a', 'b'], manifest: ActionManifest = ACTIONS) {
    const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
    const world = new BootstrapWorld(inventory);
    const engine = new EventEngine();
    const actions = new ActionEngine(manifest, engine.getLifeLog());
    const brain = new Brain(actions);
    const people = Object.fromEntries(ids.map(id => [id, person(id)]));
    const state: PopulationState = { worldSeed: SEED, people, drawSeed: 1, placedIds: [], nextSeq: 10, lastSimulatedYear: 0 };
    ids.forEach(id => world.register(id));
    const deps: BrainDeps & ActionDeps = { state, tick: 100, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world }, eventEngine: engine, inventory };
    return { inventory, world, engine, actions, brain, state, deps };
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });
const cause = { source: 'system' as const, causationId: null };

// Scan for a tick where the placeholder verdict goes the way the test needs — deterministic per seed.
function findTick(actionId: string, verdict: boolean, source = 'a', target = 'b', from = 100): number {
    for (let tick = from; tick < from + 500; tick++) {
        if (evaluateConsent({ actionId, params: {}, sourcePersonId: source, targetPersonId: target, tick, worldSeed: SEED }) === verdict) {
            return tick;
        }
    }
    throw new Error(`no ${verdict}-tick found for ${actionId}`);
}

describe('the consent evaluator (placeholder policy)', () => {
    test('deterministic: identical inputs give identical verdicts across full re-runs', () => {
        const run = () => Array.from({ length: 500 }, (_, i) =>
            evaluateConsent({ actionId: 'gave_object_to_person', params: {}, sourcePersonId: 'a', targetPersonId: 'b', tick: 100 + i, worldSeed: SEED }));
        expect(run()).toEqual(run());
    });

    test('standing scores acceptance: strangers ~35%, friends ~85% (consent v2, task 083)', () => {
        const sample = (relationship: { kind: string; strength: number } | null) => {
            let yes = 0;
            const n = 4000;
            for (let i = 0; i < n; i++) {
                if (evaluateConsent({ actionId: 'gave_object_to_person', params: {}, sourcePersonId: `p${i % 40}`, targetPersonId: `q${i % 37}`, tick: i, worldSeed: SEED, relationship: relationship as never })) {
                    yes += 1;
                }
            }
            return yes / n;
        };
        const strangers = sample(null);
        expect(strangers).toBeGreaterThan(0.30);
        expect(strangers).toBeLessThan(0.40);
        const friends = sample({ kind: 'friend', strength: 50 });
        expect(friends).toBeGreaterThan(0.80);
        expect(friends).toBeLessThan(0.90);
        expect(friends).toBeGreaterThan(strangers);
    });

    test('stream isolation: the verdict keys on its own salted stream, so unrelated subsystems are untouched', () => {
        // The verdict varies by every discriminant (not one global coin)...
        const base = { params: {}, sourcePersonId: 'a', targetPersonId: 'b', tick: 100, worldSeed: SEED };
        const across = (mutate: (i: number) => Partial<typeof base> & { actionId?: string }) =>
            new Set(Array.from({ length: 40 }, (_, i) => evaluateConsent({ actionId: 'x', ...base, ...mutate(i) }))).size;
        expect(across(i => ({ tick: 100 + i }))).toBe(2);
        expect(across(i => ({ targetPersonId: `t${i}` }))).toBe(2);
        expect(across(i => ({ actionId: `act${i}` }))).toBe(2);

        // ...and interleaving consent rolls does not shift any other stream: an identical Brain run with
        // thousands of extra evaluateConsent calls in between produces a bit-identical action log.
        const run = (noisy: boolean) => {
            const { brain, deps, engine } = harness(['a', 'b']);
            for (let tick = 100; tick < 140; tick++) {
                if (noisy) {
                    for (let i = 0; i < 50; i++) {
                        evaluateConsent({ actionId: 'noise', params: {}, sourcePersonId: 'a', targetPersonId: 'b', tick: tick * 100 + i, worldSeed: SEED });
                    }
                }
                brain.processTick(['a', 'b'], { ...deps, tick }, [], result());
            }
            return JSON.stringify([...engine.getPersonLog('a'), ...engine.getPersonLog('b')].map(entry => [entry.defId, entry.tick, entry.seq]));
        };
        expect(run(false)).toBe(run(true));
    });
});

describe('the decline path (zero mutations, full trace)', () => {
    test('a declined give leaves the object untouched, logs consent_declined, fires no success event', () => {
        const { inventory, actions, engine, deps } = harness();
        const gift = inventory.createInstance({ archetypeId: 'wristwatch', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        const tick = findTick('gave_object_to_person', false);
        const res = result();

        const outcome = actions.startAction('a', 'gave_object_to_person', { target: 'b' }, cause, { ...deps, tick }, res);
        expect(outcome).toEqual({ ok: false, reason: 'consentDeclined' });

        // Zero consequence mutations: the watch never changed hands or owners.
        expect(inventory.getInstance(gift.id)!.owner).toEqual({ kind: 'person', personId: 'a' });
        expect(inventory.getInstance(gift.id)!.container).toEqual({ kind: 'possessions', personId: 'a' });

        // The trace: a 'failed' action entry with the typed reason and the params snapshot, plus the
        // CURATED decline event (074 wires action_declined on object transfers), chained by causation.
        const log = engine.getPersonLog('a');
        expect(log).toHaveLength(2);
        const entry = log[0] as ActionLogEntry;
        expect(entry.kind).toBe('action');
        expect(entry.lifecycle).toBe('failed');
        expect(entry.failureReason).toBe('consent_declined');
        expect(entry.params['target']).toBe('b');
        expect(log[1]).toMatchObject({ kind: 'event', defId: 'action_declined', causationId: entry.seq, params: { action: 'gave_object_to_person', reason: 'consent_declined' } });

        // No success lifecycle event (gave_gift) committed anywhere — only the decline record.
        expect(res.committed.map(commit => commit.eventId)).toEqual(['action_declined']);
        expect(engine.getPersonLog('b')).toHaveLength(0);

        // The attempt counts toward recency, so cooldowns gate immediate re-tries.
        expect(actions.hasAction('a', 'gave_object_to_person', tick, { withinTicks: 0 })).toBe(true);
    });

    test('the accept path is identical to a non-askFirst run: consequences apply, the event fires', () => {
        const { inventory, actions, engine, deps } = harness();
        const gift = inventory.createInstance({ archetypeId: 'wristwatch', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        const tick = findTick('gave_object_to_person', true);
        const res = result();

        expect(actions.startAction('a', 'gave_object_to_person', { target: 'b' }, cause, { ...deps, tick }, res).ok).toBe(true);
        expect(inventory.getInstance(gift.id)!.owner).toEqual({ kind: 'person', personId: 'b' });
        const performed = engine.getPersonLog('a').filter(entry => entry.kind === 'action' && entry.lifecycle === 'performed');
        expect(performed).toHaveLength(1);
        expect((performed[0] as ActionLogEntry).failureReason).toBeUndefined();
    });

    test('log entries with failureReason round-trip through serialization intact', () => {
        const { inventory, actions, engine, deps } = harness();
        inventory.createInstance({ archetypeId: 'wristwatch', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        const tick = findTick('gave_object_to_person', false);
        actions.startAction('a', 'gave_object_to_person', { target: 'b' }, cause, { ...deps, tick }, result());

        const revived = JSON.parse(JSON.stringify(engine.getPersonLog('a'))) as ActionLogEntry[];
        expect(revived[0]!.failureReason).toBe('consent_declined');
        expect(revived).toEqual(engine.getPersonLog('a'));
    });
});

// Fixture manifest for Brain/sequence behavior: an askFirst discrete with a selection cooldown, and
// sequence parents exercising the decline policies.
const FIXTURES: ActionManifest = {
    fixture_ask: {
        label: 'Ask', type: 'discrete', category: 'social',
        parameters: { target: { type: 'person', required: true } },
        interaction: { targetParam: 'target', requiresSameBuilding: true, askFirst: true },
        selection: { weight: 1, cooldownTicks: 5 },
    },
    // weight 0: invisible to the social-opportunity hook, so the relentless-proposer test owns its attempts.
    fixture_ask_quiet: {
        label: 'Ask (quiet)', type: 'discrete', category: 'social',
        parameters: { target: { type: 'person', required: true } },
        interaction: { targetParam: 'target', requiresSameBuilding: true, askFirst: true },
        selection: { weight: 0 },
    },
    seq_give: {
        label: 'Seq give', type: 'discrete', category: 'social',
        parameters: { target: { type: 'person', required: true } },
        interaction: { targetParam: 'target', requiresSameBuilding: true, askFirst: true },
        requirements: { carries: { tag: 'giftable' } },
        consequences: [{ op: 'transferObject', object: { carried: { tag: 'giftable' } }, owner: 'targetPerson' }],
    },
    seq_give_skippable: {
        label: 'Seq give (skippable)', type: 'discrete', category: 'social',
        parameters: { target: { type: 'person', required: true } },
        interaction: { targetParam: 'target', requiresSameBuilding: true, askFirst: true, onDecline: 'skipStep' },
        requirements: { carries: { tag: 'giftable' } },
        consequences: [{ op: 'transferObject', object: { carried: { tag: 'giftable' } }, owner: 'targetPerson' }],
    },
    seq_after: { label: 'After', type: 'discrete', category: 'social' },
    ritual_default: {
        label: 'Gift ritual', type: 'continuous', category: 'social',
        parameters: { target: { type: 'person', required: true } },
        children: { mode: 'sequence', steps: [{ action: 'seq_give', params: { target: '$parent.target' } }, { action: 'seq_after' }] },
    },
    ritual_skippable: {
        label: 'Gift ritual (skippable give)', type: 'continuous', category: 'social',
        parameters: { target: { type: 'person', required: true } },
        children: { mode: 'sequence', steps: [{ action: 'seq_give_skippable', params: { target: '$parent.target' } }, { action: 'seq_after' }] },
    },
} as unknown as ActionManifest;

describe('Brain consumes failure (no retry)', () => {
    test('onActionFailed hooks observe the decline in the same tick; declined actions respect their cooldown', () => {
        const { brain, engine, deps } = harness(['a', 'b'], FIXTURES);
        const observed: { tick: number; actionId: string; reason: string }[] = [];
        brain.registerHook({
            id: 'observer', kind: 'onActionFailed',
            propose({ deps: hookDeps, failure }): ActionIntent[] {
                observed.push({ tick: hookDeps.tick, actionId: failure!.actionId, reason: failure!.reason });
                return [];
            },
        } as BrainHook);
        // A relentless proposer: fixture_ask_quiet at 'b' every tick (Brain-side, so declines dispatch).
        brain.registerHook({
            id: 'proposer', kind: 'onTick',
            propose(): ActionIntent[] {
                return [{ actionId: 'fixture_ask_quiet', params: { target: 'b' }, sourceHook: 'proposer', priority: 50, necessity: 'optional', mayInterrupt: false, causationId: null }];
            },
        } as BrainHook);

        for (let tick = 100; tick < 200; tick++) {
            brain.processTick(['a'], { ...deps, tick }, [], result());
        }
        const attempts = engine.getPersonLog('a').filter(entry => entry.kind === 'action' && entry.defId === 'fixture_ask_quiet') as ActionLogEntry[];
        const declines = attempts.filter(entry => entry.lifecycle === 'failed');
        expect(declines.length).toBeGreaterThan(0);
        expect(attempts.some(entry => entry.lifecycle === 'performed')).toBe(true);

        // Every Brain-driven decline (the proposer's AND any social-hook fixture_ask attempts) was
        // dispatched to the failure hook in the same tick, exactly once, in log order.
        const allDeclines = engine.getPersonLog('a')
            .filter(entry => entry.kind === 'action' && entry.lifecycle === 'failed') as ActionLogEntry[];
        expect(observed).toEqual(allDeclines.map(entry => ({ tick: entry.tick, actionId: entry.defId, reason: 'consentDeclined' })));

        // No auto-retry: at most one attempt per tick even though the proposer never relents.
        const perTick = new Map<number, number>();
        attempts.forEach(entry => perTick.set(entry.tick, (perTick.get(entry.tick) ?? 0) + 1));
        expect([...perTick.values()].every(count => count === 1)).toBe(true);
    });

    test('the selection cooldown gates re-selection after a decline (the social-hook path)', () => {
        const { brain, engine, deps } = harness(['a', 'b'], FIXTURES);
        // Drive selection through the social-opportunity hook only (fixture_ask is the sole candidate).
        for (let tick = 100; tick < 400; tick++) {
            brain.processTick(['a'], { ...deps, tick }, [], result());
        }
        const attempts = engine.getPersonLog('a').filter(entry => entry.kind === 'action' && entry.defId === 'fixture_ask') as ActionLogEntry[];
        expect(attempts.length).toBeGreaterThan(0);
        // Declined or performed, every attempt is followed by >= cooldownTicks of silence.
        for (let i = 1; i < attempts.length; i++) {
            expect(attempts[i]!.tick - attempts[i - 1]!.tick).toBeGreaterThan(5);
        }
    });
});

describe('sequence children (a rejected give never lets the sequence continue)', () => {
    function runRitual(parentId: 'ritual_default' | 'ritual_skippable', giveActionId: string) {
        const { inventory, actions, engine, deps } = harness(['a', 'b'], FIXTURES);
        const gift = inventory.createInstance({ archetypeId: 'wristwatch', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        // The child's consent rolls at the ADVANCE tick — pick a declining one, then start one tick earlier
        // (a location-free continuous action enters running at T0; the give step runs at T0+1).
        const declineTick = findTick(giveActionId, false, 'a', 'b', 102);
        const t0 = declineTick - 1;
        const start = actions.startAction('a', parentId, { target: 'b' }, cause, { ...deps, tick: t0 }, result());
        expect(start.ok).toBe(true);
        const instanceId = (start as { ok: true; instanceId: string | null }).instanceId!;
        for (let tick = t0 + 1; tick <= declineTick + 2; tick++) {
            actions.advance({ ...deps, tick });
        }
        return { inventory, actions, engine, gift, instanceId };
    }

    test('default policy: the declined give terminates the parent; the object never moves', () => {
        const { inventory, engine, gift, instanceId } = runRitual('ritual_default', 'seq_give');
        // The parent instance is pruned once terminal (task 078); assert the blocked outcome from the log.
        expect(engine.getPersonLog('a').some(entry => entry.kind === 'action' && entry.instanceId === instanceId && entry.lifecycle === 'blocked')).toBe(true);
        expect(inventory.getInstance(gift.id)!.owner).toEqual({ kind: 'person', personId: 'a' });
        // seq_after never ran — the sequence did NOT continue past the decline.
        expect(engine.getPersonLog('a').some(entry => entry.kind === 'action' && entry.defId === 'seq_after')).toBe(false);
        // The declined child left its own trace.
        const decline = engine.getPersonLog('a').find(entry => entry.kind === 'action' && entry.defId === 'seq_give') as ActionLogEntry;
        expect(decline.lifecycle).toBe('failed');
        expect(decline.failureReason).toBe('consent_declined');
    });

    test("onDecline: 'skipStep' lets the sequence continue past the decline and complete", () => {
        const { inventory, engine, gift, instanceId } = runRitual('ritual_skippable', 'seq_give_skippable');
        expect(engine.getPersonLog('a').some(entry => entry.kind === 'action' && entry.instanceId === instanceId && entry.lifecycle === 'completed')).toBe(true);
        expect(inventory.getInstance(gift.id)!.owner).toEqual({ kind: 'person', personId: 'a' }); // still not given
        expect(engine.getPersonLog('a').some(entry => entry.kind === 'action' && entry.defId === 'seq_after')).toBe(true);
    });
});

describe('typed completion failure (inputs_unavailable)', () => {
    test('an unsatisfiable completion plan downgrades to failed WITH its reason', () => {
        const manifest = {
            make_thing: {
                label: 'Make', type: 'continuous', category: 'leisure', durationTicks: 2,
                consequences: [{ op: 'consumeObject', object: { carried: { archetype: 'wristwatch' } }, quantity: 1 }],
            },
        } as unknown as ActionManifest;
        const { actions, engine, deps } = harness(['a'], manifest);
        // 'a' carries no wristwatch: the completion consequence cannot plan.
        expect(actions.startAction('a', 'make_thing', {}, cause, deps, result()).ok).toBe(true);
        for (let tick = 101; tick <= 104; tick++) {
            actions.advance({ ...deps, tick });
        }
        const entries = engine.getPersonLog('a').filter(entry => entry.kind === 'action') as ActionLogEntry[];
        const terminal = entries.find(entry => entry.lifecycle === 'failed');
        expect(terminal).toBeDefined();
        expect(terminal!.failureReason).toBe('inputs_unavailable');
    });

    test('reserved action_declined / action_failed events exist, typed, and nothing auto-fires them', () => {
        const events = eventsConfig as unknown as Record<string, { triggers: Record<string, unknown>; parameters?: Record<string, { type: string; required?: boolean }> }>;
        for (const id of ['action_declined', 'action_failed']) {
            expect(events[id]).toBeDefined();
            expect(events[id]!.triggers['manual']).toBeDefined();
            expect(events[id]!.triggers['probabilistic']).toBeUndefined();
            expect(events[id]!.parameters!['action']!.required).toBe(true);
        }
        // Restraint (073/074): only actions that CURATE events.onDecline fire one — a declined casual
        // askFirst social leaves nothing but the failed log entry.
        const { actions, engine, deps } = harness();
        const tick = findTick('taught_person_something', false);
        actions.startAction('a', 'taught_person_something', { target: 'b' }, cause, { ...deps, tick }, result());
        expect(engine.getPersonLog('a').filter(entry => entry.kind === 'event')).toHaveLength(0);
        expect(engine.getPersonLog('a').filter(entry => entry.kind === 'action' && entry.lifecycle === 'failed')).toHaveLength(1);
    });
});
