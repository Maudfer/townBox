import EventEngine from 'game/events/EventEngine';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import LiveWorld from 'game/execution/LiveWorld';
import Person from 'game/agents/Person';
import Building from 'game/world/Building';

import { EventManifest } from 'types/LifeEvent';
import { PopulationState, GenPerson } from 'types/Genealogy';
import { Genders, Gender } from 'types/Social';

// The simulation execution boundary (task 040): live and bootstrap run the same engine and data; the world
// adapter is the only difference — bootstrap transitions resolve immediately, live ones wait for physical
// arrival, and both produce the same handle lifecycle records.

const TPY = 8640;

function gen(id: string, gender: Gender, ageYears: number, tickNow: number): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender, birthTick: tickNow - ageYears * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function pool(tickNow: number, ids: [string, Gender][]): PopulationState {
    const people: Record<string, GenPerson> = {};
    for (const [id, gender] of ids) {
        people[id] = gen(id, gender, 30, tickNow);
    }
    return { worldSeed: 11, people, drawSeed: 1, placedIds: [], nextSeq: 100, lastSimulatedYear: 0 };
}

describe('BootstrapWorld (non-visual adapter)', () => {
    test('transitions resolve immediately with the same handle lifecycle fields', () => {
        const world = new BootstrapWorld();
        const handle = world.requestTransition('p1', { kind: 'venue', venue: 'park' }, 500, 7);
        expect(handle).toMatchObject({ id: 0, personId: 'p1', status: 'arrived', requestedAtTick: 500, resolvedAtTick: 500, causationId: 7 });
        expect(world.locationOf('p1')).toEqual({ kind: 'venue', venue: 'park' });
        expect(world.peopleAt({ kind: 'venue', venue: 'park' })).toEqual(['p1']);
    });

    test('locations default to home and handle ids are a deterministic counter', () => {
        const world = new BootstrapWorld();
        expect(world.locationOf('nobody')).toEqual({ kind: 'home' });
        const first = world.requestTransition('a', { kind: 'outside' }, 1, null);
        const second = world.requestTransition('b', { kind: 'outside' }, 1, null);
        expect([first.id, second.id]).toEqual([0, 1]);
    });
});

describe('LiveWorld (map-backed adapter)', () => {
    // Minimal fakes standing in for the materialized world: the adapter only touches getCurrentBuilding,
    // social.getPersonId/getHome, and Building.getIdentifier.
    function fakeBuilding(key: string): Building {
        return { getIdentifier: () => key } as unknown as Building;
    }
    function fakePerson(personId: string, home: Building, current: { value: Building | null }): Person {
        return {
            social: { getPersonId: () => personId, getHome: () => home },
            getCurrentBuilding: () => current.value,
        } as unknown as Person;
    }

    test('a transition stays pending until arrival, then resolves with the same record shape as bootstrap', () => {
        const home = fakeBuilding('1-1');
        const work = fakeBuilding('9-9');
        const current = { value: home as Building | null };
        const person = fakePerson('p1', home, current);
        const commutes: string[] = [];

        const world = new LiveWorld({
            getPeople: () => [person],
            buildingByKey: key => (key === '9-9' ? work : key === '1-1' ? home : null),
            startCommute: (_who, destination) => commutes.push(destination.getIdentifier()),
        });

        const handle = world.requestTransition('p1', { kind: 'building', key: '9-9' }, 100, 3);
        expect(handle.status).toBe('pending');
        expect(handle.resolvedAtTick).toBeNull();
        expect(commutes).toEqual(['9-9']); // the real commute machinery was engaged

        world.pump(101);
        expect(handle.status).toBe('pending'); // not there yet

        current.value = work; // the visual layer lands the person
        world.pump(102);
        expect(handle).toMatchObject({ personId: 'p1', status: 'arrived', requestedAtTick: 100, resolvedAtTick: 102, causationId: 3 });
        expect(world.getPending()).toHaveLength(0);
        expect(world.locationOf('p1')).toEqual({ kind: 'building', key: '9-9' });
    });

    test('already-at-destination resolves immediately (like bootstrap), unknown targets cancel', () => {
        const home = fakeBuilding('1-1');
        const current = { value: home as Building | null };
        const person = fakePerson('p1', home, current);
        const world = new LiveWorld({ getPeople: () => [person], buildingByKey: () => null, startCommute: () => {} });

        const alreadyThere = world.requestTransition('p1', { kind: 'home' }, 50, null);
        expect(alreadyThere.status).toBe('arrived');
        expect(alreadyThere.resolvedAtTick).toBe(50);

        const nowhere = world.requestTransition('p1', { kind: 'building', key: 'missing' }, 51, null);
        expect(nowhere.status).toBe('cancelled');
    });
});

describe('engine under the boundary (roll-before-resolve)', () => {
    const SEARCH_EVENT: EventManifest = {
        // A marriage-shaped event: candidate `where` search on a non-subject role. Pre-040 the bootstrap had
        // to filter these out; now they run in both modes because the search happens only after a successful
        // probability roll.
        pair_up: {
            roles: {
                subject: { where: { all: [{ attr: 'alive', op: '==', value: true }, { attr: 'gender', op: '==', value: 'female' }] } },
                partner: { where: { all: [{ attr: 'alive', op: '==', value: true }, { attr: 'gender', op: '==', value: 'male' }] } },
            },
            triggers: { probabilistic: { perYear: 200000 } }, // certainty per tick
            effects: [{ type: 'marry', role: 'partner' }],
        },
        never_event: {
            roles: {
                subject: { where: { attr: 'alive', op: '==', value: true } },
                partner: { where: { attr: 'alive', op: '==', value: true } },
            },
            triggers: { probabilistic: { perYear: 0 } },
            effects: [],
        },
    } as unknown as EventManifest;

    test('candidate-search events fire under a bootstrap-style context (no markets, no filtering)', () => {
        const engine = new EventEngine(SEARCH_EVENT);
        const state = pool(1000, [['f', Genders.Female], ['m', Genders.Male]]);
        engine.simulateTick(state, ['f', 'm'], 1000, TPY, { mode: 'bootstrap', world: new BootstrapWorld() });
        expect(state.people['f']!.partnerships).toHaveLength(1);
        expect(engine.getPersonLog('f')[0]).toMatchObject({ defId: 'pair_up', triggerSource: 'probability' });
    });

    test('role resolution is only paid after a successful roll', () => {
        const engine = new EventEngine(SEARCH_EVENT);
        const state = pool(1000, [['f', Genders.Female], ['m', Genders.Male]]);
        const resolveSpy = jest.spyOn(engine as unknown as { resolveRoles: (...args: unknown[]) => unknown }, 'resolveRoles');
        engine.simulateTick(state, ['f', 'm'], 1000, TPY, {});
        // pair_up rolls certainty → resolves roles (once for the eligible female subject; the male subject
        // fails the subject predicate). never_event rolls 0 for both subjects → never resolves.
        expect(resolveSpy).toHaveBeenCalledTimes(1);
    });

    test('identical results across modes: the context changes nothing about event outcomes', () => {
        const run = (mode: 'live' | 'bootstrap') => {
            const engine = new EventEngine(SEARCH_EVENT);
            const state = pool(1000, [['f', Genders.Female], ['m', Genders.Male]]);
            const world = new BootstrapWorld(); // stands in for both; events don't consult the world yet
            for (let tick = 1000; tick < 1005; tick++) {
                engine.simulateTick(state, ['f', 'm'], tick, TPY, { mode, world });
            }
            return { log: engine.getLog(), people: state.people };
        };
        expect(JSON.stringify(run('live'))).toBe(JSON.stringify(run('bootstrap')));
    });
});

// Off-map co-location seam (task 076/H2): the offline generator (055) runs the full enriched sim with no map.
// The social layer works off-map ONLY if the host registers its agent roster with the BootstrapWorld so
// peopleAt can enumerate co-located people. This proves the seam: with a registered, co-located roster the
// social-opportunity hook fires in bootstrap mode; separated, it does not. (The remaining logical-world plan
// inputs — jobs/economy/school/skillProgression/onCommitted — are the documented 055 build-out.)
describe('off-map co-location seam (task 076/H2)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ActionEngine = require('game/actions/ActionEngine').default;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DEFAULT_ACTION_MANIFEST } = require('game/actions/ActionEngine');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Brain = require('game/actions/Brain').default;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { socialOpportunityHook } = require('game/actions/SocialOpportunity');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Inventory = require('game/objects/Inventory').default;

    function socialProposalsOver(ticks: number, coLocated: boolean): number {
        const state = pool(30 * TPY, [['p1', Genders.Female], ['p2', Genders.Male]]);
        const engine = new EventEngine({} as EventManifest);
        const actionEngine = new ActionEngine(DEFAULT_ACTION_MANIFEST);
        const brain = new Brain(actionEngine);
        const inventory = new Inventory();
        const world = new BootstrapWorld(inventory);
        // The host registers its roster (what 055 must do) and places people logically.
        world.register('p1');
        world.register('p2');
        world.requestTransition('p1', { kind: 'building', key: 'b1' }, 0, null);
        world.requestTransition('p2', { kind: 'building', key: coLocated ? 'b1' : 'b2' }, 0, null);

        let proposals = 0;
        for (let tick = 0; tick < ticks; tick++) {
            const deps = { state, tick, ticksPerYear: TPY, ctx: { mode: 'bootstrap' as const, world }, eventEngine: engine, inventory };
            proposals += socialOpportunityHook.propose({ personId: 'p1', deps, brain }).length;
        }
        return proposals;
    }

    test('a registered, co-located roster lets the social hook fire off-map', () => {
        expect(socialProposalsOver(200, true)).toBeGreaterThan(0);
    });

    test('separated people never trigger a social proposal (co-location is the discriminator)', () => {
        expect(socialProposalsOver(200, false)).toBe(0);
    });
});
