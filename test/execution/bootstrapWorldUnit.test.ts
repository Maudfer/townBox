import BootstrapWorld, { sameLocation } from 'game/execution/BootstrapWorld';
import Inventory from 'game/objects/Inventory';
import { LogicalLocation } from 'types/Execution';

// Direct unit tests for the non-visual WorldAdapter (task 040) that backs `bootstrap` mode — the same code
// path the offline history generator and the ActionEngine consequences fixtures (consequences.test.ts) use
// for location transitions/co-location. Those tests only ever request a single transition per person; this
// file pins the adapter's own contract directly: registration, peopleAt across every LogicalLocation kind,
// objectsAt with and without a backing Inventory, and requestTransition's always-immediate resolution.

describe('BootstrapWorld — location & registration', () => {
    test('an unregistered/untransitioned person defaults to home', () => {
        const world = new BootstrapWorld();
        expect(world.locationOf('a')).toEqual({ kind: 'home' });
        expect(world.objectLocationOf('a')).toEqual({ kind: 'home' }); // off-map: object location mirrors location
    });

    test('register() seeds home only once (does not clobber a real location)', () => {
        const world = new BootstrapWorld();
        world.requestTransition('a', { kind: 'building', key: '1-1' }, 0, null);
        world.register('a'); // already present — must not reset to home
        expect(world.locationOf('a')).toEqual({ kind: 'building', key: '1-1' });

        world.register('b'); // not present — seeded to home
        expect(world.locationOf('b')).toEqual({ kind: 'home' });
    });

    test('peopleAt enumerates only KNOWN (registered/transitioned) people at a matching location', () => {
        const world = new BootstrapWorld();
        world.register('a');
        world.register('b');
        world.requestTransition('c', { kind: 'building', key: '2-2' }, 0, null);
        expect(world.peopleAt({ kind: 'home' })).toEqual(['a', 'b']); // sorted
        expect(world.peopleAt({ kind: 'building', key: '2-2' })).toEqual(['c']);
        expect(world.peopleAt({ kind: 'building', key: '9-9' })).toEqual([]);
    });

    test('requestTransition resolves immediately (arrived), moves the person, and records the handle', () => {
        const world = new BootstrapWorld();
        const handle = world.requestTransition('a', { kind: 'venue', venue: 'park' }, 100, 42);
        expect(handle).toMatchObject({ id: 0, personId: 'a', status: 'arrived', requestedAtTick: 100, resolvedAtTick: 100, causationId: 42 });
        expect(world.locationOf('a')).toEqual({ kind: 'venue', venue: 'park' });
        const second = world.requestTransition('b', { kind: 'outside' }, 101, null);
        expect(second.id).toBe(1); // monotonic counter
        expect(world.getTransitions()).toEqual([handle, second]);
    });

    test('objectsAt with no inventory backing returns empty; with one, resolves via locationKey', () => {
        const bare = new BootstrapWorld();
        expect(bare.objectsAt({ kind: 'home' })).toEqual([]);

        const inventory = new Inventory();
        const withInv = new BootstrapWorld(inventory);
        const archetypeId = Object.keys(inventory.getArchetypes())[0]!;
        const coin = inventory.createInstance({ archetypeId, owner: { kind: 'world' }, container: { kind: 'location', key: 'building:3-3' }, tick: 0 });
        expect(withInv.objectsAt({ kind: 'building', key: '3-3' })).toEqual([coin.id]);
        expect(withInv.objectsAt({ kind: 'building', key: '9-9' })).toEqual([]);
    });
});

describe('sameLocation()', () => {
    const cases: [LogicalLocation, LogicalLocation, boolean][] = [
        [{ kind: 'home' }, { kind: 'home' }, true],
        [{ kind: 'home' }, { kind: 'outside' }, false],
        [{ kind: 'building', key: '1-1' }, { kind: 'building', key: '1-1' }, true],
        [{ kind: 'building', key: '1-1' }, { kind: 'building', key: '2-2' }, false],
        [{ kind: 'venue', venue: 'park' }, { kind: 'venue', venue: 'park' }, true],
        [{ kind: 'venue', venue: 'park' }, { kind: 'venue', venue: 'gym' }, false],
        [{ kind: 'outside' }, { kind: 'outside' }, true],
    ];
    test.each(cases)('sameLocation(%o, %o) === %s', (a, b, expected) => {
        expect(sameLocation(a, b)).toBe(expected);
    });
});
