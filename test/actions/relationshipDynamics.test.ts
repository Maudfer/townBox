import ActionEngine, { ActionDeps } from 'game/actions/ActionEngine';
import { consentProbability } from 'game/actions/Consent';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import SocialGraph from 'game/population/SocialGraph';
import actionsConfig from 'json/actions.json';
import eventsConfig from 'json/events.json';
import { ActionManifest } from 'types/Action';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { EventManifest, TickResult } from 'types/LifeEvent';
import { Genders } from 'types/Social';

// Relationship dynamics through the engines (task 083): the adjustRelationship consequence grows edges and
// fires ladder transition events at BOTH sides; the relationship predicate gates intimate actions as data;
// consent v2 scores by standing.

const TPY = 8640;
const ACTIONS = actionsConfig as unknown as ActionManifest;
const EVENTS = eventsConfig as unknown as EventManifest;

function person(id: string): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function harness() {
    const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
    const world = new BootstrapWorld(inventory);
    const engine = new EventEngine(EVENTS);
    const actions = new ActionEngine(ACTIONS, engine.getLifeLog());
    const social = new SocialGraph();
    const people = { a: person('a'), b: person('b') };
    const state: PopulationState = { worldSeed: 9, people, drawSeed: 1, placedIds: [], nextSeq: 10, lastSimulatedYear: 0 };
    ['a', 'b'].forEach(id => world.register(id));
    const deps: ActionDeps = { state, tick: 100, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world, markets: { social } }, eventEngine: engine, inventory };
    return { inventory, world, engine, actions, social, state, deps };
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });
const cause = { source: 'system' as const, causationId: null };

describe('interaction deltas grow edges (the consequence path)', () => {
    test('a no-consent social (greeted_person) warms the edge', () => {
        const { actions, social, deps } = harness();
        expect(social.edgeBetween('a', 'b', 100)).toBeNull();
        expect(actions.startAction('a', 'greeted_person', { target: 'b' }, cause, deps, result()).ok).toBe(true);
        const edge = social.edgeBetween('a', 'b', 100)!;
        expect(edge.kind).toBe('acquaintance');
        expect(edge.strength).toBeGreaterThan(0);
    });

    test('repeated interaction promotes to friend and fires made_friend at BOTH sides', () => {
        const { actions, social, engine, deps } = harness();
        // consoled_person is askFirst — use talked_to_person (+1) driven repeatedly; seed close to the
        // promoteAt-22 threshold (LP-9 tune) but below it, so the promotion lands through the ACTION path.
        social.adjust('a', 'b', 20, 100);
        let tick = 100;
        // talked_to_person has a cooldown; drive with distinct ticks until the promotion lands.
        for (let i = 0; i < 200 && social.edgeBetween('a', 'b', tick)?.kind !== 'friend'; i++) {
            tick += 1;
            actions.startAction('a', 'talked_to_person', { target: 'b' }, cause, { ...deps, tick }, result());
        }
        expect(social.edgeBetween('a', 'b', tick)!.kind).toBe('friend');
        const aEntry = engine.getPersonLog('a').find(entry => entry.kind === 'event' && entry.defId === 'made_friend');
        const bEntry = engine.getPersonLog('b').find(entry => entry.kind === 'event' && entry.defId === 'made_friend');
        expect(aEntry).toBeDefined();
        expect(bEntry).toBeDefined();
        expect((aEntry!.params as Record<string, unknown>)['with']).toBe('b');
        expect((bEntry!.params as Record<string, unknown>)['with']).toBe('a');
    });

    test('argued_with_person cools the edge (and the counterpart argument lands on the target)', () => {
        const { actions, social, engine, deps } = harness();
        social.adjust('a', 'b', 40, 100);
        expect(actions.startAction('a', 'argued_with_person', { target: 'b' }, cause, deps, result()).ok).toBe(true);
        expect(social.edgeBetween('a', 'b', 100)!.strength).toBeCloseTo(32, 6);
        expect(engine.getPersonLog('b').some(entry => entry.kind === 'event' && entry.defId === 'argument')).toBe(true);
    });
});

describe('the relationship predicate gates intimacy (B3)', () => {
    test('kissed_partner fails requirements toward a stranger, succeeds toward a dating partner', () => {
        const { actions, social, deps } = harness();
        expect(actions.startAction('a', 'kissed_partner', { target: 'b' }, cause, deps, result()))
            .toEqual({ ok: false, reason: 'requirementsUnmet' });

        social.setKind('a', 'b', 'dating', 100, 80);
        // askFirst + dating standing → accept probability 0.95 + strength shift; walk a few ticks for the roll.
        let succeeded = false;
        for (let tick = 100; tick < 140 && !succeeded; tick++) {
            succeeded = actions.startAction('a', 'kissed_partner', { target: 'b' }, cause, { ...deps, tick }, result()).ok;
        }
        expect(succeeded).toBe(true);
    });
});

describe('consent v2 (B6): standing scores the accept probability', () => {
    const base = { actionId: 'hugged_person', params: {}, sourcePersonId: 'a', targetPersonId: 'b', tick: 0, worldSeed: 1 };

    test('probabilities order: rival < stranger < acquaintance < friend < dating/spouse', () => {
        const p = (kind: string, strength: number) => consentProbability({ ...base, relationship: { kind: kind as never, strength } });
        const stranger = consentProbability({ ...base, relationship: null });
        expect(p('rival', 20)).toBeLessThan(stranger);
        expect(stranger).toBeLessThan(p('acquaintance', 10));
        expect(p('acquaintance', 10)).toBeLessThan(p('friend', 50));
        expect(p('friend', 50)).toBeLessThan(p('dating', 60));
        expect(p('spouse', 75)).toBeGreaterThan(0.9);
    });

    test('strength shifts within a standing', () => {
        const weak = consentProbability({ ...base, relationship: { kind: 'friend', strength: 10 } });
        const strong = consentProbability({ ...base, relationship: { kind: 'friend', strength: 90 } });
        expect(strong).toBeGreaterThan(weak);
    });
});
