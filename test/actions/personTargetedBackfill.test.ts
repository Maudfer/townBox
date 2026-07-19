import ActionEngine, { ActionDeps } from 'game/actions/ActionEngine';
import Brain, { BrainDeps } from 'game/actions/Brain';
import { evaluateConsent } from 'game/actions/Consent';
import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import actionsConfig from 'json/actions.json';
import { ActionManifest } from 'types/Action';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { TickResult, ActionLogEntry } from 'types/LifeEvent';
import { Genders } from 'types/Social';
import { actionInvokers } from 'util/eventClassification';

// The person-targeted backfill (task 074): curated askFirst postures + onDecline policies across the whole
// social repertoire, the curated action_declined wiring (object transfers only), the return-side binding
// that finally closes lending loops, and the frequency/balance pass on the social-opportunity hook.

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

const personTargeted = Object.entries(ACTIONS)
    .filter(([, def]) => Object.values(def.parameters ?? {}).some(spec => spec.type === 'person'))
    .map(([actionId]) => actionId)
    .sort();

// The ratified posture table: consent is asked where imposition is real (affection, transfers, borrowing,
// invitations, teaching); greetings/casual talk don't ask, and NOBODY consents to the hostile set.
const ASK_FIRST = ['asked_person_out', 'gave_object_to_person', 'invite_to_activity', 'kissed_partner', 'proposed_marriage', 'hugged_person', 'invited_person_over', 'lent_an_object', 'returned_borrowed_object', 'shared_food_with_person', 'taught_person_something'];
const TRANSFERS = ['gave_object_to_person', 'lent_an_object', 'returned_borrowed_object', 'shared_food_with_person'];

describe('the curated contract table', () => {
    test('every person-targeted action is contracted with the ratified askFirst posture', () => {
        expect(personTargeted.length).toBe(27); // 18 pre-074 + hugged/kissed/invite + ask-out/proposal + thanked (094) + pickpocketed (099) + shared_gossip (104) + treating_patient (111)
        for (const actionId of personTargeted) {
            const contract = ACTIONS[actionId]!.interaction!;
            expect(contract.targetParam).toBe('target');
            expect(contract.requiresSameBuilding).toBe(true);
            expect(contract.allowSelf).toBeUndefined(); // never self-targeting
            expect(contract.askFirst).toBe(ASK_FIRST.includes(actionId));
        }
        // The hostile act is explicitly non-consent (no one consents to being argued at).
        expect(ACTIONS['argued_with_person']!.interaction!.askFirst).toBe(false);
    });

    test('onDecline policies: transfers fail the parent, casual askFirst socials are skippable flavor', () => {
        for (const actionId of TRANSFERS) {
            expect(ACTIONS[actionId]!.interaction!.onDecline).toBe('failParent');
        }
        for (const actionId of ['hugged_person', 'invited_person_over', 'taught_person_something']) {
            expect(ACTIONS[actionId]!.interaction!.onDecline).toBe('skipStep');
        }
    });

    test('every person-targeted action carries curated selection metadata for the social hook', () => {
        for (const actionId of personTargeted) {
            if (actionId === 'treating_patient') {
                continue; // 111: doctorRounds-bound (weight 0) — never a social-hook pick, no curation to carry
            }
            const selection = ACTIONS[actionId]!.selection!;
            expect(selection.weight).toBeGreaterThan(0);
            expect(selection.cooldownTicks).toBeGreaterThan(0);
        }
        // Returning a borrowed object is prompt (heaviest weight); giving objects away is rare.
        expect(ACTIONS['returned_borrowed_object']!.selection!.weight).toBeGreaterThan(ACTIONS['greeted_person']!.selection!.weight!);
        expect(ACTIONS['gave_object_to_person']!.selection!.weight).toBeLessThan(0.5);
    });

    test('action_declined is wired ONLY on the curated object transfers (recorded keep/skip choice)', () => {
        const invokers = actionInvokers(ACTIONS);
        expect(invokers.get('action_declined')!.sort()).toEqual(['gave_object_to_person.onDecline', 'lent_an_object.onDecline']);
        // action_failed stays reserved — nothing fires it yet.
        expect(invokers.get('action_failed')).toBeUndefined();
    });
});

describe('consent postures at runtime', () => {
    test('a hostile act never consults consent: it succeeds even on a declining tick', () => {
        const { actions, deps } = harness();
        // Find a tick where consent WOULD decline for this pair+action — argued_with_person ignores it.
        let tick = 100;
        while (evaluateConsent({ actionId: 'argued_with_person', params: {}, sourcePersonId: 'a', targetPersonId: 'b', tick, worldSeed: SEED })) {
            tick += 1;
        }
        expect(actions.startAction('a', 'argued_with_person', { target: 'b' }, cause, { ...deps, tick }, result()).ok).toBe(true);
    });

    test('a declined hug is a plain failed entry (no curated event), a declined lend fires action_declined', () => {
        const { inventory, actions, engine, deps } = harness();
        inventory.createInstance({ archetypeId: 'wristwatch', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        let hugTick = 100;
        while (evaluateConsent({ actionId: 'hugged_person', params: {}, sourcePersonId: 'a', targetPersonId: 'b', tick: hugTick, worldSeed: SEED })) {
            hugTick += 1;
        }
        expect(actions.startAction('a', 'hugged_person', { target: 'b' }, cause, { ...deps, tick: hugTick }, result())).toEqual({ ok: false, reason: 'consentDeclined' });
        expect(engine.getPersonLog('a').filter(entry => entry.kind === 'event')).toHaveLength(0);

        let lendTick = 100;
        while (evaluateConsent({ actionId: 'lent_an_object', params: {}, sourcePersonId: 'a', targetPersonId: 'b', tick: lendTick, worldSeed: SEED })) {
            lendTick += 1;
        }
        expect(actions.startAction('a', 'lent_an_object', { target: 'b' }, cause, { ...deps, tick: lendTick }, result())).toEqual({ ok: false, reason: 'consentDeclined' });
        const declineEvents = engine.getPersonLog('a').filter(entry => entry.kind === 'event');
        expect(declineEvents).toHaveLength(1);
        expect(declineEvents[0]).toMatchObject({ defId: 'action_declined', params: { action: 'lent_an_object', reason: 'consent_declined' } });
    });
});

describe('return-side coherence (the lending loop closes over time)', () => {
    // A minimal manifest keeps the couple co-located (no location-bearing free-time actions to wander off to).
    const LOOP_MANIFEST = {
        returned_borrowed_object: ACTIONS['returned_borrowed_object'],
        greeted_person: ACTIONS['greeted_person'],
    } as unknown as ActionManifest;

    test('the hook binds the OWNER of a carried borrowed instance and the loop closes', () => {
        const { inventory, brain, engine, deps } = harness(['a', 'b'], LOOP_MANIFEST);
        // 'a' carries b's watch (borrowed: possession a, ownership b — the 044 split).
        const watch = inventory.createInstance({ archetypeId: 'wristwatch', owner: { kind: 'person', personId: 'b' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });

        for (let tick = 100; tick < 400 && inventory.getInstance(watch.id)!.container.kind === 'possessions' && (inventory.getInstance(watch.id)!.container as { personId: string }).personId === 'a'; tick++) {
            brain.processTick(['a', 'b'], { ...deps, tick }, [], result());
        }
        expect(inventory.getInstance(watch.id)!.container).toEqual({ kind: 'possessions', personId: 'b' });
        const returns = engine.getPersonLog('a').filter(entry => entry.kind === 'action' && entry.defId === 'returned_borrowed_object' && entry.lifecycle === 'performed') as ActionLogEntry[];
        expect(returns).toHaveLength(1);
        expect(returns[0]!.params).toMatchObject({ target: 'b', object: watch.id }); // owner-bound, not random
    });

    test('with nothing borrowed the hook never proposes an unstartable return (no missingParameter noise)', () => {
        const { brain, engine, deps } = harness(['a', 'b'], LOOP_MANIFEST);
        for (let tick = 100; tick < 300; tick++) {
            brain.processTick(['a', 'b'], { ...deps, tick }, [], result());
        }
        const returnAttempts = engine.getPersonLog('a').filter(entry => entry.kind === 'action' && entry.defId === 'returned_borrowed_object');
        expect(returnAttempts).toHaveLength(0);
        // The hook still socialises normally (greetings flow).
        expect(engine.getPersonLog('a').some(entry => entry.kind === 'action' && entry.defId === 'greeted_person')).toBe(true);
    });

    test('a borrowed instance whose owner is NOT co-located is not returnable', () => {
        const { inventory, world, brain, engine, deps } = harness(['a', 'b'], LOOP_MANIFEST);
        inventory.createInstance({ archetypeId: 'wristwatch', owner: { kind: 'person', personId: 'b' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        world.requestTransition('b', { kind: 'building', key: '9-9' }, 100, null); // b leaves
        for (let tick = 100; tick < 300; tick++) {
            brain.processTick(['a'], { ...deps, tick }, [], result());
        }
        expect(engine.getPersonLog('a').filter(entry => entry.kind === 'action' && entry.defId === 'returned_borrowed_object')).toHaveLength(0);
    });
});

describe('frequency & balance (the recorded bands)', () => {
    function sample() {
        const { brain, actions, engine, deps } = harness(['a', 'b', 'c']);
        const DAYS = 30;
        for (let tick = 0; tick < DAYS * 24; tick++) {
            const tickDeps = { ...deps, tick };
            actions.advance(tickDeps);
            brain.processTick(['a', 'b', 'c'], tickDeps, [], result());
        }
        const social = ['a', 'b', 'c'].flatMap(id => engine.getPersonLog(id)
            .filter(entry => entry.kind === 'action' && ACTIONS[entry.defId]?.interaction) as ActionLogEntry[]);
        const askFirstAttempts = social.filter(entry => ACTIONS[entry.defId]!.interaction!.askFirst);
        const declined = askFirstAttempts.filter(entry => entry.lifecycle === 'failed' && entry.failureReason === 'consent_declined');
        return {
            perPersonDay: social.length / (3 * DAYS),
            askFirstAttempts: askFirstAttempts.length,
            declineRate: askFirstAttempts.length ? declined.length / askFirstAttempts.length : NaN,
            fingerprint: JSON.stringify(social.map(entry => [entry.defId, entry.tick, entry.lifecycle])),
        };
    }

    test('social rates land in plausible bands; strangers RARELY propose intimacy (the W6 pricing)', () => {
        const run = sample();
        if (process.env['PRINT_RATES']) {
            console.log(`sampled: ${run.perPersonDay.toFixed(2)} social actions/person/day, ${run.askFirstAttempts} askFirst attempts, decline rate ${(run.declineRate * 100).toFixed(1)}%`);
        }
        // Recorded band: a co-located trio produces a modest social cadence, not spam.
        expect(run.perPersonDay).toBeGreaterThan(0.3);
        expect(run.perPersonDay).toBeLessThan(4);
        // The W6 askFirst pricing (proposal simulation-aliveness-3 Part 4.4): the proposer reads the same
        // standing consent will, so a trio of STRANGERS barely asks — the pre-W6 regime (25-30 attempts,
        // ~85% declined: the asset's 1,142 lifetime rejected hugs) is exactly what this band retires.
        // Casual no-consent socials (greetings, chat) keep the cadence; intimacy waits for real edges.
        expect(run.askFirstAttempts).toBeLessThan(10);
    });

    test('deterministic: two identical sampling runs are bit-identical', () => {
        expect(sample().fingerprint).toBe(sample().fingerprint);
    });
});
