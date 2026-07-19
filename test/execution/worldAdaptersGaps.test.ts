import Person from 'game/agents/Person';
import BootstrapWorld from 'game/execution/BootstrapWorld';
import LiveWorld from 'game/execution/LiveWorld';
import Inventory from 'game/objects/Inventory';
import Building from 'game/world/Building';
import House from 'game/world/House';

// Extra branch coverage for the WorldAdapters not already exercised by executionBoundary.test.ts: the
// BootstrapWorld transitions accessor, and every LiveWorld branch where the person/building lookup fails
// (unknown person, no current building, home vs. non-home buildings, objectsAt with/without an inventory,
// peopleAt filtering out unidentified people, and pump()'s cancellation path).

function fakeBuilding(key: string): Building {
    return { getIdentifier: () => key } as unknown as Building;
}

describe('BootstrapWorld.getTransitions', () => {
    test('returns every transition ever requested, in request order', () => {
        const world = new BootstrapWorld();
        const first = world.requestTransition('a', { kind: 'home' }, 0, null);
        const second = world.requestTransition('b', { kind: 'outside' }, 1, null);
        expect(world.getTransitions()).toEqual([first, second]);
    });
});

describe('LiveWorld.locationOf — every branch', () => {
    function fakePerson(personId: string, home: Building | null, current: Building | null): Person {
        return {
            social: { getPersonId: () => personId, getHome: () => home },
            getCurrentBuilding: () => current,
        } as unknown as Person;
    }

    test('an unknown person resolves to outside (findPerson returns null)', () => {
        const world = new LiveWorld({ getPeople: () => [], buildingByKey: () => null, startCommute: () => {} });
        expect(world.locationOf('ghost')).toEqual({ kind: 'outside' });
    });

    test('a known person with no current building resolves to outside', () => {
        const home = fakeBuilding('1-1');
        const person = fakePerson('p1', home, null);
        const world = new LiveWorld({ getPeople: () => [person], buildingByKey: () => null, startCommute: () => {} });
        expect(world.locationOf('p1')).toEqual({ kind: 'outside' });
    });

    test('a person currently inside their own House resolves to home', () => {
        const home = new House(0, 0, null);
        const person = fakePerson('p1', home, home);
        const world = new LiveWorld({ getPeople: () => [person], buildingByKey: () => null, startCommute: () => {} });
        expect(world.locationOf('p1')).toEqual({ kind: 'home' });
    });

    test('a person inside a House that is NOT their own home resolves to a building key (visiting)', () => {
        const ownHome = new House(0, 0, null);
        const otherHouse = new House(1, 1, null);
        const person = fakePerson('p1', ownHome, otherHouse);
        const world = new LiveWorld({ getPeople: () => [person], buildingByKey: () => null, startCommute: () => {} });
        expect(world.locationOf('p1')).toEqual({ kind: 'building', key: otherHouse.getIdentifier() });
    });
});

describe('LiveWorld outdoor co-location is cell-scoped (V2 / aliveness-4)', () => {
    function outdoorPerson(personId: string, x: number, y: number): Person {
        return {
            social: { getPersonId: () => personId, getHome: () => null },
            getCurrentBuilding: () => null,
            getPixelPosition: () => ({ x, y }),
            getPosition: () => ({ x, y }),
        } as unknown as Person;
    }

    test('two pedestrians far apart do NOT co-locate (no more town-wide lends/hugs)', () => {
        const near = outdoorPerson('a', 8, 8);       // cell 0-0
        const across = outdoorPerson('b', 400, 400); // cell 6-6 (64px cells)
        const world = new LiveWorld({ getPeople: () => [near, across], buildingByKey: () => null, startCommute: () => {} });
        expect(world.peopleAt(world.locationOf('a'))).toEqual(['a']); // b is across town, not co-located
        expect(world.peopleAt(world.locationOf('b'))).toEqual(['b']);
    });

    test('two pedestrians on the same patch of street DO co-locate', () => {
        const one = outdoorPerson('a', 8, 8);   // cell 0-0
        const two = outdoorPerson('b', 40, 24); // same cell 0-0 (< 64px)
        const world = new LiveWorld({ getPeople: () => [one, two], buildingByKey: () => null, startCommute: () => {} });
        expect(world.peopleAt(world.locationOf('a'))).toEqual(['a', 'b']);
    });

    test('a cell-less {kind:outside} query still returns everyone outdoors (the global check)', () => {
        const near = outdoorPerson('a', 8, 8);
        const across = outdoorPerson('b', 400, 400);
        const world = new LiveWorld({ getPeople: () => [near, across], buildingByKey: () => null, startCommute: () => {} });
        expect(world.peopleAt({ kind: 'outside' })).toEqual(['a', 'b']);
    });
});

describe('LiveWorld.objectLocationOf', () => {
    function fakePerson(personId: string, current: Building | null): Person {
        return { social: { getPersonId: () => personId, getHome: () => null }, getCurrentBuilding: () => current } as unknown as Person;
    }

    test('an unknown person resolves to outside', () => {
        const world = new LiveWorld({ getPeople: () => [], buildingByKey: () => null, startCommute: () => {} });
        expect(world.objectLocationOf('ghost')).toEqual({ kind: 'outside' });
    });

    test('a known person with no current building resolves to outside', () => {
        const person = fakePerson('p1', null);
        const world = new LiveWorld({ getPeople: () => [person], buildingByKey: () => null, startCommute: () => {} });
        expect(world.objectLocationOf('p1')).toEqual({ kind: 'outside' });
    });

    test('a known person inside a building resolves to that building\'s own key (task 070: every house has its own object pool)', () => {
        const building = fakeBuilding('4-4');
        const person = fakePerson('p1', building);
        const world = new LiveWorld({ getPeople: () => [person], buildingByKey: () => null, startCommute: () => {} });
        expect(world.objectLocationOf('p1')).toEqual({ kind: 'building', key: '4-4' });
    });
});

describe('LiveWorld.peopleAt filters out unidentified people', () => {
    test('a person with no pool personId is skipped even if co-located', () => {
        const building = fakeBuilding('5-5');
        const identified = { social: { getPersonId: () => 'p1', getHome: () => null }, getCurrentBuilding: () => building } as unknown as Person;
        const unidentified = { social: { getPersonId: () => null, getHome: () => null }, getCurrentBuilding: () => building } as unknown as Person;
        const world = new LiveWorld({ getPeople: () => [identified, unidentified], buildingByKey: () => null, startCommute: () => {} });
        expect(world.peopleAt({ kind: 'building', key: '5-5' })).toEqual(['p1']);
    });
});

describe('LiveWorld.objectsAt', () => {
    test('with no getInventory dep, returns an empty list', () => {
        const world = new LiveWorld({ getPeople: () => [], buildingByKey: () => null, startCommute: () => {} });
        expect(world.objectsAt({ kind: 'building', key: '1-1' })).toEqual([]);
    });

    test('with an inventory, returns the instance ids at that location', () => {
        const inventory = new Inventory();
        const instance = inventory.createInstance({
            archetypeId: 'wristwatch', owner: { kind: 'world' }, container: { kind: 'location', key: 'building:1-1' }, tick: 0,
        });
        const world = new LiveWorld({ getPeople: () => [], buildingByKey: () => null, startCommute: () => {}, getInventory: () => inventory });
        expect(world.objectsAt({ kind: 'building', key: '1-1' })).toEqual([instance.id]);
    });
});

describe('LiveWorld.pump — cancellation of pending transitions', () => {
    function fakePerson(personId: string, home: Building, current: { value: Building | null }): Person {
        return { social: { getPersonId: () => personId, getHome: () => home }, getCurrentBuilding: () => current.value } as unknown as Person;
    }

    test('a pending transition cancels when the target building disappears mid-commute', () => {
        const home = fakeBuilding('1-1');
        const work = fakeBuilding('9-9');
        const current = { value: home as Building | null };
        const person = fakePerson('p1', home, current);
        // buildingByKey initially resolves '9-9' so the transition starts pending, then "vanishes" (e.g. bulldozed).
        let workExists = true;
        const world = new LiveWorld({
            getPeople: () => [person],
            buildingByKey: key => (key === '9-9' && workExists ? work : null),
            startCommute: () => {},
        });

        const handle = world.requestTransition('p1', { kind: 'building', key: '9-9' }, 10, null);
        expect(handle.status).toBe('pending');

        workExists = false; // the destination building is gone
        world.pump(11);
        expect(handle.status).toBe('cancelled');
        expect(handle.resolvedAtTick).toBe(11);
        expect(world.getPending()).toHaveLength(0);
    });

    test('a pending transition cancels when the traveling person vanishes (e.g. died mid-commute)', () => {
        const home = fakeBuilding('1-1');
        const work = fakeBuilding('9-9');
        const current = { value: home as Building | null };
        let personGone = false;
        const person = fakePerson('p1', home, current);
        const world = new LiveWorld({
            getPeople: () => (personGone ? [] : [person]),
            buildingByKey: key => (key === '9-9' ? work : null),
            startCommute: () => {},
        });

        const handle = world.requestTransition('p1', { kind: 'building', key: '9-9' }, 10, null);
        expect(handle.status).toBe('pending');

        personGone = true;
        world.pump(12);
        expect(handle.status).toBe('cancelled');
        expect(handle.resolvedAtTick).toBe(12);
    });

    test('pump with no pending transitions is a no-op', () => {
        const world = new LiveWorld({ getPeople: () => [], buildingByKey: () => null, startCommute: () => {} });
        expect(() => world.pump(5)).not.toThrow();
        expect(world.getPending()).toHaveLength(0);
    });
});
