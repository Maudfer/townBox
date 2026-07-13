import ActionEngine, { ActionDeps } from 'game/actions/ActionEngine';
import { IssueCollector, ValidationIssue } from 'game/data/registry';
import { validateActionsSemantics } from 'game/data/validators/actions';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import actionsConfig from 'json/actions.json';
import eventsConfig from 'json/events.json';
import { ActionManifest } from 'types/Action';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { EventManifest, TickResult } from 'types/LifeEvent';
import { Genders } from 'types/Social';

// Counterpart events (task 082 / proposal C1): an interaction's target logs their half of the moment —
// same causation seq, subject = the target, '$actor' resolving to the acting person — plus the C2 flagship
// rewires over the real manifests (the fake probabilistic doubles are demoted to manual).

const TPY = 8640;
const ACTIONS = actionsConfig as unknown as ActionManifest;
const EVENTS = eventsConfig as unknown as EventManifest;

// The counterpart-link rules are cross-reference rules (they read the event manifest), so they live in the
// semantics validator; fixtures supply the FIXTURE_EVENTS as the events peer.
function semantics(data: unknown): string {
    const issues: ValidationIssue[] = [];
    validateActionsSemantics(data, { events: FIXTURE_EVENTS }, new IssueCollector('fixture', issues));
    return issues.map(issue => `${issue.path}: ${issue.message}`).join(' | ');
}

function person(id: string, ageYears = 30): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -ageYears * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

// Fixture manifests: a no-consent discrete interaction with a counterpart link, and an askFirst one with a
// target-side decline link. The event manifest declares the counterpart events as manual with a `from` param.
const FIXTURE_EVENTS: EventManifest = {
    got_it: {
        label: 'Got it', category: 'social',
        roles: { subject: { where: { attr: 'alive', op: '==', value: true } } },
        triggers: { manual: {} },
        parameters: { from: { type: 'string' } },
        effects: [],
    },
    turned_down: {
        label: 'Turned someone down', category: 'social',
        roles: { subject: { where: { attr: 'alive', op: '==', value: true } } },
        triggers: { manual: {} },
        parameters: { from: { type: 'string' } },
        effects: [],
    },
} as unknown as EventManifest;

const FIXTURE_ACTIONS: ActionManifest = {
    hand_over: {
        label: 'Handed something over', type: 'discrete', category: 'social',
        parameters: { target: { type: 'person', required: true } },
        interaction: { targetParam: 'target', requiresSameBuilding: true, askFirst: false },
        events: { onCompleteTarget: { event: 'got_it', params: { from: '$actor' } } },
    },
    offer: {
        label: 'Offered something', type: 'discrete', category: 'social',
        parameters: { target: { type: 'person', required: true } },
        interaction: { targetParam: 'target', requiresSameBuilding: true, askFirst: true },
        events: { onDeclineTarget: { event: 'turned_down', params: { from: '$actor' } } },
    },
} as unknown as ActionManifest;

function harness(actionManifest: ActionManifest = FIXTURE_ACTIONS, eventManifest: EventManifest = FIXTURE_EVENTS) {
    const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
    const world = new BootstrapWorld(inventory);
    const engine = new EventEngine(eventManifest);
    const actions = new ActionEngine(actionManifest, engine.getLifeLog());
    const people = { a: person('a'), b: person('b') };
    const state: PopulationState = { worldSeed: 9, people, drawSeed: 1, placedIds: [], nextSeq: 10, lastSimulatedYear: 0 };
    ['a', 'b'].forEach(id => world.register(id));
    const deps: ActionDeps = { state, tick: 100, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world }, eventEngine: engine, inventory };
    return { inventory, world, engine, actions, state, deps };
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });
const cause = { source: 'system' as const, causationId: null };

describe('counterpart events (C1)', () => {
    test('the target logs the counterpart with the SAME causation seq and $actor resolved', () => {
        const { actions, engine, deps } = harness();
        const outcome = actions.startAction('a', 'hand_over', { target: 'b' }, cause, deps, result());
        expect(outcome.ok).toBe(true);

        const actorEntry = engine.getPersonLog('a').find(entry => entry.kind === 'action' && entry.defId === 'hand_over')!;
        const targetEntry = engine.getPersonLog('b').find(entry => entry.kind === 'event' && entry.defId === 'got_it');
        expect(targetEntry).toBeDefined();
        expect(targetEntry!.causationId).toBe(actorEntry.seq);
        expect((targetEntry!.params as Record<string, unknown>)['from']).toBe('a');
    });

    test('no counterpart fires when the action itself fails (zero mutations)', () => {
        const { actions, engine, deps, world } = harness();
        world.requestTransition('b', { kind: 'building', key: '9-9' }, 100, null); // apart → targetNotPresent
        const outcome = actions.startAction('a', 'hand_over', { target: 'b' }, cause, deps, result());
        expect(outcome).toEqual({ ok: false, reason: 'targetNotPresent' });
        expect(engine.getPersonLog('b')).toHaveLength(0);
    });

    test('a consent decline fires the target-side decline event at the DECLINER', () => {
        const { actions, engine, deps } = harness();
        // The consent roll is deterministic per (seed, tick, pair, action); walk ticks until one declines.
        let declinedAtTick: number | null = null;
        for (let tick = 100; tick < 400; tick++) {
            const outcome = actions.startAction('a', 'offer', { target: 'b' }, cause, { ...deps, tick }, result());
            if (!outcome.ok && outcome.reason === 'consentDeclined') {
                declinedAtTick = tick;
                break;
            }
        }
        expect(declinedAtTick).not.toBeNull();
        const declinerEntry = engine.getPersonLog('b').find(entry => entry.kind === 'event' && entry.defId === 'turned_down');
        expect(declinerEntry).toBeDefined();
        expect((declinerEntry!.params as Record<string, unknown>)['from']).toBe('a');
        // Chained to the actor's failed attempt entry.
        const failedEntry = engine.getPersonLog('a').find(entry => entry.kind === 'action' && entry.failureReason === 'consent_declined')!;
        expect(declinerEntry!.causationId).toBe(failedEntry.seq);
    });
});

describe('the C2 flagship rewires (real manifests)', () => {
    test('a real gift lands received_gift on the receiver, chained to the giver’s entry', () => {
        const { actions, engine, deps, inventory } = harness(ACTIONS, EVENTS);
        // Give a a giftable to carry (the requirement gate + consequence input).
        const giftable = Object.entries(DEFAULT_OBJECT_ARCHETYPES).find(([, archetype]) =>
            (archetype.tags ?? []).includes('giftable'))?.[0]
            ?? Object.keys(DEFAULT_OBJECT_ARCHETYPES)[0]!;
        // Consent is an 80% roll — walk ticks until one accepts; re-arm the carried gift each attempt.
        let gaveAtTick: number | null = null;
        for (let tick = 100; tick < 400 && gaveAtTick === null; tick++) {
            if (!inventory.carriedInstances('a').some(instance => instance.archetypeId === giftable)) {
                inventory.createInstance({
                    archetypeId: giftable,
                    owner: { kind: 'person', personId: 'a' },
                    container: { kind: 'possessions', personId: 'a' },
                    tick,
                });
            }
            const outcome = actions.startAction('a', 'gave_object_to_person', { target: 'b' }, cause, { ...deps, tick }, result());
            if (outcome.ok) {
                gaveAtTick = tick;
            }
        }
        expect(gaveAtTick).not.toBeNull();
        const gave = engine.getPersonLog('a').find(entry => entry.kind === 'action' && entry.defId === 'gave_object_to_person' && entry.lifecycle === 'performed')!;
        const received = engine.getPersonLog('b').find(entry => entry.kind === 'event' && entry.defId === 'received_gift');
        expect(received).toBeDefined();
        expect(received!.causationId).toBe(gave.seq);
        expect((received!.params as Record<string, unknown>)['from']).toBe('a');
    });

    test('the fake probabilistic doubles are demoted: received_gift/gave_gift are manual-only', () => {
        expect(EVENTS['received_gift']!.triggers.probabilistic).toBeUndefined();
        expect(EVENTS['received_gift']!.triggers.manual).toBeDefined();
        expect(EVENTS['gave_gift']!.triggers.probabilistic).toBeUndefined();
        // The argument event became invokable so argued_with_person can land it on the target.
        expect(EVENTS['argument']!.triggers.manual).toBeDefined();
        expect((ACTIONS['argued_with_person']!.events?.onCompleteTarget as { event: string }).event).toBe('argument');
    });

    test('the flagship set all carries counterpart links', () => {
        for (const id of ['gave_object_to_person', 'lent_an_object', 'returned_borrowed_object', 'taught_person_something', 'hugged_person', 'shared_food_with_person']) {
            expect(ACTIONS[id]!.events?.onCompleteTarget).toBeDefined();
        }
    });
});

describe('the schema teeth (validator)', () => {
    const base = { label: 'X', type: 'discrete', category: 'social' };

    test('a counterpart link without an interaction contract is rejected', () => {
        const fixture = { x: { ...base, events: { onCompleteTarget: 'got_it' } } };
        expect(semantics(fixture)).toMatch(/no interaction contract/);
    });

    test('$actor outside a target link is rejected', () => {
        const fixture = {
            x: {
                ...base,
                parameters: { target: { type: 'person', required: true } },
                interaction: { targetParam: 'target', requiresSameBuilding: true, askFirst: false },
                events: { onComplete: { event: 'got_it', params: { from: '$actor' } } },
            },
        };
        expect(semantics(fixture)).toMatch(/only meaningful on counterpart/);
    });

    test('onDeclineTarget on a non-askFirst action is rejected', () => {
        const fixture = {
            x: {
                ...base,
                parameters: { target: { type: 'person', required: true } },
                interaction: { targetParam: 'target', requiresSameBuilding: true, askFirst: false },
                events: { onDeclineTarget: 'turned_down' },
            },
        };
        expect(semantics(fixture)).toMatch(/nothing can ever decline it/);
    });
});
