import ActionEngine, { ActionDeps } from 'game/actions/ActionEngine';
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
import { spouseAt } from 'util/kinship';

// The romance pipeline (task 090 / proposal B4), end to end over the REAL manifests:
// strangers → asked_person_out (consented) → dating edge → kissed_partner unlocks → proposed_marriage →
// engaged edge → the marriage EVENT (probabilistic, engagedOf-bound) marries them → genealogy partnership.

const TPY = 8640;
const ACTIONS = actionsConfig as unknown as ActionManifest;
const EVENTS = eventsConfig as unknown as EventManifest;

function person(id: string, gender: Genders): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender, birthTick: -28 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function harness() {
    const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
    const world = new BootstrapWorld(inventory);
    const engine = new EventEngine(EVENTS);
    const actions = new ActionEngine(ACTIONS, engine.getLifeLog());
    const social = new SocialGraph();
    const people = { ana: person('ana', Genders.Female), bruno: person('bruno', Genders.Male) };
    const state: PopulationState = { worldSeed: 77, people, drawSeed: 1, placedIds: [], nextSeq: 10, lastSimulatedYear: 0 };
    ['ana', 'bruno'].forEach(id => world.register(id));
    const deps: ActionDeps = { state, tick: 100, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world, markets: { social } }, eventEngine: engine, inventory };
    return { engine, actions, social, world, state, deps };
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });
const cause = { source: 'system' as const, causationId: null };

// Walk deterministic ticks until an askFirst action lands (consent is a seeded roll).
function untilAccepted(actions: ActionEngine, deps: ActionDeps, personId: string, actionId: string, params: Record<string, string>, from: number, budget = 400): number | null {
    for (let tick = from; tick < from + budget; tick++) {
        const outcome = actions.startAction(personId, actionId, params, cause, { ...deps, tick }, result());
        if (outcome.ok) {
            return tick;
        }
        if (!outcome.ok && outcome.reason !== 'consentDeclined') {
            return null; // a non-consent failure means the gate itself failed — surface it
        }
    }
    return null;
}

describe('the pipeline', () => {
    test('strangers cannot kiss or propose; asking out is gated off existing partners', () => {
        const { actions, deps, social } = harness();
        expect(actions.startAction('ana', 'kissed_partner', { target: 'bruno' }, cause, deps, result()))
            .toEqual({ ok: false, reason: 'requirementsUnmet' });
        expect(actions.startAction('ana', 'proposed_marriage', { target: 'bruno' }, cause, deps, result()))
            .toEqual({ ok: false, reason: 'requirementsUnmet' });
        // Already dating → asking out again is requirementsUnmet (the not-relationship gate).
        social.setKind('ana', 'bruno', 'dating', 100, 40);
        expect(actions.startAction('ana', 'asked_person_out', { target: 'bruno' }, cause, deps, result()))
            .toEqual({ ok: false, reason: 'requirementsUnmet' });
    });

    test('asked out → dating (both halves logged); kiss unlocks; proposal → engaged; marriage event marries', () => {
        const { engine, actions, social, state, deps } = harness();

        // 1. The ask (consent walk). Creates the dating edge and logs both halves with one causation.
        const askedAt = untilAccepted(actions, deps, 'ana', 'asked_person_out', { target: 'bruno' }, 100);
        expect(askedAt).not.toBeNull();
        expect(social.edgeBetween('ana', 'bruno', askedAt!)!.kind).toBe('dating');
        expect(engine.getPersonLog('ana').some(entry => entry.kind === 'event' && entry.defId === 'asked_someone_out')).toBe(true);
        expect(engine.getPersonLog('bruno').some(entry => entry.kind === 'event' && entry.defId === 'went_on_first_date')).toBe(true);

        // 2. Dating unlocks the kiss.
        const kissedAt = untilAccepted(actions, deps, 'ana', 'kissed_partner', { target: 'bruno' }, askedAt! + 1);
        expect(kissedAt).not.toBeNull();

        // 3. Grow the bond past the proposal threshold, then propose → engaged, both log got_engaged.
        social.adjust('ana', 'bruno', 40, kissedAt!);
        const proposedAt = untilAccepted(actions, deps, 'ana', 'proposed_marriage', { target: 'bruno' }, kissedAt! + 1);
        expect(proposedAt).not.toBeNull();
        expect(social.edgeBetween('ana', 'bruno', proposedAt!)!.kind).toBe('engaged');
        expect(engine.getPersonLog('ana').some(entry => entry.kind === 'event' && entry.defId === 'got_engaged')).toBe(true);
        expect(engine.getPersonLog('bruno').some(entry => entry.kind === 'event' && entry.defId === 'got_engaged')).toBe(true);

        // 4. The marriage EVENT fires probabilistically among the engaged (engagedOf bind) — walk the engine.
        let marriedAt: number | null = null;
        for (let tick = proposedAt! + 1; tick < proposedAt! + TPY && marriedAt === null; tick += 24) {
            const tickResult = engine.simulateTick(state, ['ana', 'bruno'], tick, TPY, deps.ctx, 24);
            if (tickResult.committed.some(commit => commit.eventId === 'marriage')) {
                marriedAt = tick;
            }
        }
        expect(marriedAt).not.toBeNull();
        expect(spouseAt(state.people, 'ana', marriedAt!)).toBe('bruno');
    });

    test('no engagement, no wedding: the marriage event cannot fire for merely-dating couples', () => {
        const { engine, social, state, deps } = harness();
        social.setKind('ana', 'bruno', 'dating', 100, 90);
        for (let tick = 100; tick < 100 + TPY; tick += 24) {
            const tickResult = engine.simulateTick(state, ['ana', 'bruno'], tick, TPY, deps.ctx, 24);
            expect(tickResult.committed.every(commit => commit.eventId !== 'marriage')).toBe(true);
        }
        expect(spouseAt(state.people, 'ana', 100 + TPY)).toBeNull();
    });
});
