import EventEngine from '../src/app/game/EventEngine';
import BootstrapWorld from '../src/app/game/BootstrapWorld';
import LiveWorld from '../src/app/game/LiveWorld';
import Person from '../src/app/game/Person';
import Building from '../src/app/game/Building';

import { EventManifest } from '../src/types/LifeEvent';
import { PopulationState, GenPerson } from '../src/types/Genealogy';
import { Genders, Gender } from '../src/types/Social';

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
            triggers: { probabilistic: { perYear: 1000 } }, // certainty per tick
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
