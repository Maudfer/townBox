import ActionEngine, { ActionDeps } from 'game/actions/ActionEngine';
import Brain, { BrainDeps } from 'game/actions/Brain';
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

// Reactions & witnesses (task 094 / proposal C3–C4): the receiving side ANSWERS — a thank-you for a gift, a
// retort to an argument — same tick, one level deep (reaction commits never re-dispatch); co-located third
// parties log witnessed_a_scene for witnessable moments, capped and once per day.

const TPY = 8640;
const ACTIONS = actionsConfig as unknown as ActionManifest;
const EVENTS = eventsConfig as unknown as EventManifest;

function person(id: string): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function harness(ids: string[]) {
    const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
    const world = new BootstrapWorld(inventory);
    const engine = new EventEngine(EVENTS);
    const actions = new ActionEngine(ACTIONS, engine.getLifeLog());
    const brain = new Brain(actions);
    const social = new SocialGraph();
    const people = Object.fromEntries(ids.map(id => [id, person(id)]));
    const state: PopulationState = { worldSeed: 31, people, drawSeed: 1, placedIds: [], nextSeq: 10, lastSimulatedYear: 0 };
    ids.forEach(id => world.register(id));
    const deps: BrainDeps & ActionDeps = { state, tick: 100, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world, markets: { social } }, eventEngine: engine, inventory };
    return { engine, actions, brain, social, world, state, deps };
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });

describe('reactions (C3)', () => {
    test('a real argument gets answered: the target retorts or apologizes across deterministic ticks', () => {
        const { engine, actions, brain, deps } = harness(['a', 'b']);
        // Drive arguments across ticks; the counterpart lands on b with the aggressor in the payload, and
        // the reactions hook (0.3 retort / 0.1 apology) eventually answers. Deterministic per seed.
        let answered = false;
        for (let tick = 100; tick < 300 && !answered; tick++) {
            const tickResult = result();
            const outcome = actions.startAction('a', 'argued_with_person', { target: 'b' }, { source: 'system', causationId: null }, { ...deps, tick }, tickResult);
            if (outcome.ok) {
                brain.processTick(['a', 'b'], { ...deps, tick }, tickResult.committed, tickResult);
                answered = engine.getPersonLog('b').some(entry => entry.kind === 'action'
                    && (entry.defId === 'argued_with_person' || entry.defId === 'apologized_to_person'));
            }
        }
        expect(answered).toBe(true);
        // And the retort's own counterpart never re-dispatched a reaction the same tick (one level deep):
        // no unbounded back-and-forth — the log stays finite and the suite terminates at all is the proof.
    });

    test('reactions bind targets from the payload; a payload-less commit reacts at nobody', () => {
        const { engine, brain, deps, state } = harness(['a', 'b']);
        // Invoke received_gift on b WITHOUT a `from` payload: the reaction has no counterpart to thank.
        const { result: invoked } = engine.invoke(state, 'received_gift', 'b', 100, TPY, { source: 'system', causationId: null }, {}, deps.ctx);
        brain.processTick(['a', 'b'], deps, invoked.committed, invoked);
        expect(engine.getPersonLog('b').some(entry => entry.kind === 'action' && entry.defId === 'thanked_person')).toBe(false);
    });

    test('the shipped reaction tables landed on the counterpart events', () => {
        expect(EVENTS['received_gift']!.reactions!.some(reaction => reaction.action === 'thanked_person')).toBe(true);
        expect(EVENTS['argument']!.reactions!.some(reaction => reaction.action === 'argued_with_person')).toBe(true);
        expect(EVENTS['got_engaged']!.reactions!.some(reaction => reaction.action === 'celebrated_with_person')).toBe(true);
    });
});

describe('witnesses (C4)', () => {
    test('a witnessable moment lands witnessed_a_scene on co-located third parties, once per day, capped', () => {
        const { engine, actions, brain, deps } = harness(['a', 'b', 'c', 'd', 'e', 'f']);
        // Everyone shares the bootstrap 'home'; a argues with b; c–f are bystanders (cap 3).
        let argued = false;
        for (let tick = 100; tick < 200 && !argued; tick++) {
            const tickResult = result();
            const outcome = actions.startAction('a', 'argued_with_person', { target: 'b' }, { source: 'system', causationId: null }, { ...deps, tick }, tickResult);
            if (outcome.ok) {
                argued = true;
                brain.processTick(['a', 'b', 'c', 'd', 'e', 'f'], { ...deps, tick }, tickResult.committed, tickResult);
            }
        }
        expect(argued).toBe(true);
        const witnesses = ['c', 'd', 'e', 'f'].filter(id =>
            engine.getPersonLog(id).some(entry => entry.kind === 'event' && entry.defId === 'witnessed_a_scene'));
        expect(witnesses.length).toBeGreaterThan(0);
        expect(witnesses.length).toBeLessThanOrEqual(3); // the cap
        // The witnessed entry names the scene.
        const entry = engine.getPersonLog(witnesses[0]!).find(e => e.kind === 'event' && e.defId === 'witnessed_a_scene')!;
        expect((entry.params as Record<string, unknown>)['event']).toBeDefined();
        expect((entry.params as Record<string, unknown>)['about']).toBeDefined();
    });

    test('non-witnessable events draw no audience', () => {
        const { engine, brain, deps, state } = harness(['a', 'b', 'c']);
        const { result: invoked } = engine.invoke(state, 'woke_up', 'a', 100, TPY, { source: 'system', causationId: null }, {}, deps.ctx);
        brain.processTick(['a', 'b', 'c'], deps, invoked.committed, invoked);
        for (const id of ['b', 'c']) {
            expect(engine.getPersonLog(id).some(entry => entry.kind === 'event' && entry.defId === 'witnessed_a_scene')).toBe(false);
        }
    });
});
