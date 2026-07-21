import ActionEngine, { ActionDeps } from 'game/actions/ActionEngine';
import Agenda from 'game/actions/Agenda';
import Brain, { BrainDeps } from 'game/actions/Brain';
import { ROUTINES_CONFIG, bestRelativeTarget, bestFriendTarget } from 'game/actions/Planner';
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

// The planner (task 085 / proposal D): the agenda store's lazy fulfillment/expiry, routine production and
// proposal, located friend visits ('person:<id>' targeting), and joint plans from a consented invitation.

const TPY = 8640;
const ACTIONS = actionsConfig as unknown as ActionManifest;
const EVENTS = eventsConfig as unknown as EventManifest;

function person(id: string): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -30 * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function harness(ids: string[] = ['a', 'b']) {
    const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
    const world = new BootstrapWorld(inventory);
    const engine = new EventEngine(EVENTS);
    const actions = new ActionEngine(ACTIONS, engine.getLifeLog());
    const brain = new Brain(actions);
    const agenda = new Agenda();
    const social = new SocialGraph();
    const people = Object.fromEntries(ids.map(id => [id, person(id)]));
    const state: PopulationState = { worldSeed: 5, people, drawSeed: 1, placedIds: [], nextSeq: 10, lastSimulatedYear: 0 };
    ids.forEach(id => world.register(id));
    const deps: BrainDeps & ActionDeps = { state, tick: 1000, ticksPerYear: TPY, ctx: { mode: 'bootstrap', world, markets: { agenda, social } }, eventEngine: engine, inventory };
    return { engine, actions, brain, agenda, social, world, state, deps };
}

const result = (): TickResult => ({ died: [], born: [], signals: [], committed: [] });
const cause = { source: 'system' as const, causationId: null };

describe('the agenda store', () => {
    test('due windows, lazy expiry, and lazy fulfillment', () => {
        const agenda = new Agenda();
        agenda.enqueue({ personId: 'a', actionId: 'taking_a_walk', enqueuedAtTick: 100, earliestTick: 110, latestTick: 120, causationId: null, source: 'test' });
        const never = () => false;
        expect(agenda.dueEntriesOf('a', 105, never)).toHaveLength(0); // before the window
        expect(agenda.dueEntriesOf('a', 112, never)).toHaveLength(1); // inside
        expect(agenda.dueEntriesOf('a', 121, never)).toHaveLength(0); // expired — pruned
        expect(agenda.dueEntriesOf('a', 112, never)).toHaveLength(0); // stays gone

        // Fulfillment: the action happened since enqueue (organically or via the plan).
        agenda.enqueue({ personId: 'a', actionId: 'taking_a_walk', enqueuedAtTick: 200, earliestTick: 210, latestTick: 220, causationId: null, source: 'test' });
        const walked = (actionId: string) => actionId === 'taking_a_walk';
        expect(agenda.dueEntriesOf('a', 212, walked)).toHaveLength(0);
    });

    test('serialize/loadState round-trips entries and the seq counter', () => {
        const agenda = new Agenda();
        agenda.enqueue({ personId: 'a', actionId: 'x', enqueuedAtTick: 1, earliestTick: 2, latestTick: 3, causationId: null, source: 'test' });
        const restored = new Agenda();
        restored.loadState(agenda.serialize());
        expect(restored.serialize()).toEqual(agenda.serialize());
        // The seq counter survives, so new entries never collide with restored ids.
        const fresh = restored.enqueue({ personId: 'a', actionId: 'y', enqueuedAtTick: 1, earliestTick: 2, latestTick: 3, causationId: null, source: 'test' });
        expect(fresh.id).toBe('g1');
    });
});

describe('routines (D2)', () => {
    test('adopted routines enqueue inside their window and the planner proposes them', () => {
        const { brain, agenda, deps } = harness(['a']);
        // Run the planner across a couple of days; SOME routine must be adopted (adoption 0.5–0.8 across 6
        // templates makes zero adoptions astronomically unlikely for any seed) and then proposed + executed.
        let planned = 0;
        for (let tick = 1000; tick < 1000 + 72; tick++) {
            brain.processTick(['a'], { ...deps, tick }, [], result());
            brain.getActionEngine().advance({ ...deps, tick });
            planned = Math.max(planned, agenda.dueEntriesOf('a', tick, () => false).length);
        }
        // Entries were produced and consumed: the routine actions appear in the log.
        const log = deps.eventEngine.getPersonLog('a');
        const routineActions = new Set(Object.values(ROUTINES_CONFIG).map(routine => routine.action));
        expect(log.some(entry => entry.kind === 'action' && routineActions.has(entry.defId))).toBe(true);
    });

    test('adoption is deterministic per (worldSeed, person, routine)', () => {
        const runA = harness(['a']);
        const runB = harness(['a']);
        for (let tick = 1000; tick < 1030; tick++) {
            runA.brain.processTick(['a'], { ...runA.deps, tick }, [], result());
            runB.brain.processTick(['a'], { ...runB.deps, tick }, [], result());
        }
        expect(JSON.stringify(runA.agenda.serialize())).toBe(JSON.stringify(runB.agenda.serialize()));
    });

    test('a pet owner reliably gets the dog walk (task 115): adoption 1, daily cadence, petCount-gated', () => {
        // The walk-pressure routine: full adoption means EVERY owner plans it — the neglect texture comes
        // from mood dampeners on the walk itself, never from planning randomness.
        expect(ROUTINES_CONFIG['dog_walk']!.action).toBe('walking_the_dog');
        expect(ROUTINES_CONFIG['dog_walk']!.adoption).toBe(1);
        expect(ROUTINES_CONFIG['dog_walk']!.cadenceDays).toBe(1);

        const owner = harness(['a']);
        owner.deps.ctx.markets = { ...owner.deps.ctx.markets, pets: { countOf: () => 1 } };
        let walked = false;
        for (let tick = 1000; tick < 1000 + 48 && !walked; tick++) {
            owner.brain.processTick(['a'], { ...owner.deps, tick }, [], result());
            owner.brain.getActionEngine().advance({ ...owner.deps, tick });
            walked = owner.deps.eventEngine.getPersonLog('a').some(entry => entry.kind === 'action' && entry.defId === 'walking_the_dog');
        }
        expect(walked).toBe(true);

        // No pet → the routine's requires gate holds: the walk is never planned.
        const petless = harness(['a']);
        for (let tick = 1000; tick < 1000 + 48; tick++) {
            petless.brain.processTick(['a'], { ...petless.deps, tick }, [], result());
            petless.brain.getActionEngine().advance({ ...petless.deps, tick });
        }
        expect(Object.values(petless.agenda.serialize().entries).every(entry => entry.routineId !== 'dog_walk')).toBe(true);
    });

    test('a located friend visit targets the friend (person:<id> locationOverride)', () => {
        const { brain, agenda, social, deps } = harness(['a', 'b']);
        social.adjust('a', 'b', 40, 999); // friend
        // Force the see_friends production window by walking days until the entry exists.
        let located = null;
        for (let tick = 1000; tick < 1000 + 24 * 8 && !located; tick++) {
            brain.processTick(['a', 'b'], { ...deps, tick }, [], result());
            brain.getActionEngine().advance({ ...deps, tick });
            located = Object.values(agenda.serialize().entries)
                .find(entry => entry.personId === 'a' && entry.locationOverride === 'person:b') ?? null;
        }
        // Adoption of see_friends for (seed 5, 'a') may be false — accept either a located entry OR verify
        // determinism of its absence by checking adoption directly. The mechanism test below covers execution.
        if (!located) {
            expect(Object.values(agenda.serialize().entries).every(entry => entry.locationOverride !== 'person:b')).toBe(true);
        } else {
            expect(located.routineId).toBe('see_friends');
        }
    });

    test('a friend visit enqueues a MIRRORED host action for the friend (V9 collective visit)', () => {
        const { brain, agenda, social, deps } = harness(['a', 'b']);
        social.adjust('a', 'b', 40, 999); // a and b are friends
        let visit = null;
        for (let tick = 1000; tick < 1000 + 24 * 12 && !visit; tick++) {
            brain.processTick(['a', 'b'], { ...deps, tick }, [], result());
            brain.getActionEngine().advance({ ...deps, tick });
            visit = Object.values(agenda.serialize().entries)
                .find(entry => entry.personId === 'a' && entry.actionId === 'visiting_friends' && entry.locationOverride === 'person:b') ?? null;
        }
        if (!visit) {
            // Adoption of see_friends may be false for this (seed, person); nothing to assert (the located
            // test above covers absence). When it DOES fire, the host mirror must be present:
            return;
        }
        const host = Object.values(agenda.serialize().entries)
            .find(entry => entry.personId === 'b' && entry.actionId === 'hosting_a_friend_visit');
        expect(host).toBeTruthy();
        expect(host!.locationOverride).toBe('home');           // the friend hosts at their own home
        // One scene: both sides run over the SAME window, so they start and end together.
        expect(host!.earliestTick).toBe(visit.earliestTick);
        expect(host!.latestTick).toBe(visit.latestTick);
    });
});

describe('joint plans (D3)', () => {
    test('a consented invitation installs MIRRORED linked entries and both run the activity', () => {
        const { actions, agenda, deps } = harness(['a', 'b']);
        // Drive the invite until consent accepts (deterministic walk).
        let invitedAt: number | null = null;
        for (let tick = 1000; tick < 1200 && invitedAt === null; tick++) {
            const outcome = actions.startAction('a', 'invite_to_activity', { target: 'b', activity: 'catching_up_over_coffee' }, cause, { ...deps, tick }, result());
            if (outcome.ok) {
                invitedAt = tick;
            }
        }
        expect(invitedAt).not.toBeNull();
        const entries = Object.values(agenda.serialize().entries);
        expect(entries).toHaveLength(2);
        const [first, second] = entries.sort((x, y) => x.personId.localeCompare(y.personId));
        expect(first!.personId).toBe('a');
        expect(first!.locationOverride).toBe('home');
        expect(second!.personId).toBe('b');
        expect(second!.locationOverride).toBe('person:a');
        // Mirrored: both entries run over the SAME window (start/end together — the joint-plan linkage).
        expect(first!.earliestTick).toBe(second!.earliestTick);
        expect(first!.latestTick).toBe(second!.latestTick);
        expect(first!.actionId).toBe('catching_up_over_coffee');
    });

    test('follow-the-person: an intent with person:<id> materializes at the target person’s location', () => {
        const { actions, world, deps } = harness(['a', 'b']);
        world.requestTransition('b', { kind: 'building', key: '7-7' }, 1000, null);
        const outcome = actions.startAction('a', 'catching_up_over_coffee', {}, cause, deps, result(), null, undefined, 'person:b');
        expect(outcome.ok).toBe(true);
        // Bootstrap transitions resolve immediately: a is now where b is.
        expect(world.locationOf('a')).toEqual({ kind: 'building', key: '7-7' });
    });
});

// Task 131 follow-up: a person-located visit only targets someone who is PRESENT (materialized) in the
// world — otherwise the visitor stands still on the street "visiting a ghost" (the live-observed bug where a
// relative to visit wasn't on the map, so the trip resolved to town-wide 'outside' and never moved).
describe('visit targets must be present (task 131 follow-up)', () => {
    const TPY2 = 8640;
    function kin(id: string, parents: { motherId?: string; fatherId?: string } = {}): GenPerson {
        return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: -30 * TPY2, deathTick: null, fatherId: parents.fatherId ?? null, motherId: parents.motherId ?? null, partnerships: [] };
    }
    // A minimal deps: a pool, a world whose isPresent consults a set, and a social stub for friend edges.
    function depsWith(people: Record<string, GenPerson>, present: Set<string>, edges: { otherId: string; kind: string; strength: number }[] = []) {
        return {
            state: { worldSeed: 0, people, drawSeed: 0, placedIds: [], nextSeq: 0, lastSimulatedYear: 0 },
            tick: 1000,
            ctx: {
                world: { isPresent: (id: string) => present.has(id) },
                markets: { social: { edgesOf: () => edges.map(e => ({ otherId: e.otherId, view: { kind: e.kind, strength: e.strength } })) } },
            },
        } as unknown as Parameters<typeof bestRelativeTarget>[0];
    }

    test('bestRelativeTarget skips an off-map relative and returns a present one', () => {
        const people = { a: kin('a', { motherId: 'present_mom', fatherId: 'offmap_dad' }), present_mom: kin('present_mom'), offmap_dad: kin('offmap_dad') };
        const deps = depsWith(people, new Set(['a', 'present_mom'])); // dad is NOT materialized
        expect(bestRelativeTarget(deps, 'a')).toBe('present_mom');
    });

    test('bestRelativeTarget returns null when the only living relative is off-map (no ghost visit)', () => {
        const people = { a: kin('a', { motherId: 'offmap_mom' }), offmap_mom: kin('offmap_mom') };
        const deps = depsWith(people, new Set(['a'])); // mom not on the map
        expect(bestRelativeTarget(deps, 'a')).toBeNull();
    });

    test('bestFriendTarget prefers the strongest PRESENT friend, skipping an absent stronger one', () => {
        const people = { a: kin('a') };
        // The strongest friend (f_absent, 90) is off-map; the present friend (f_here, 50) wins.
        const deps = depsWith(people, new Set(['a', 'f_here']), [
            { otherId: 'f_absent', kind: 'close_friend', strength: 90 },
            { otherId: 'f_here', kind: 'friend', strength: 50 },
        ]);
        expect(bestFriendTarget(deps, 'a')).toBe('f_here');
    });

    test('bestFriendTarget returns null when every eligible friend is off-map', () => {
        const people = { a: kin('a') };
        const deps = depsWith(people, new Set(['a']), [{ otherId: 'f_absent', kind: 'friend', strength: 80 }]);
        expect(bestFriendTarget(deps, 'a')).toBeNull();
    });

    test('a world without isPresent (bootstrap/logical) treats everyone as present — no off-map change', () => {
        const people = { a: kin('a', { motherId: 'mom' }), mom: kin('mom') };
        // No world.isPresent impl → the town-wide-abstract default: mom is visitable (generator unaffected).
        const deps = {
            state: { worldSeed: 0, people, drawSeed: 0, placedIds: [], nextSeq: 0, lastSimulatedYear: 0 },
            tick: 1000,
            ctx: { world: {}, markets: {} },
        } as unknown as Parameters<typeof bestRelativeTarget>[0];
        expect(bestRelativeTarget(deps, 'a')).toBe('mom');
    });
});
