import BootstrapWorld from 'game/execution/BootstrapWorld';
import Inventory from 'game/objects/Inventory';
import { ObjectContainerRef } from 'types/Objects';

// The object system (task 041): archetypes vs instances, ownership vs containment as independent axes,
// containers with cycle rejection, stacking, Possessions queries, and serialization.

const POSS = (personId: string): ObjectContainerRef => ({ kind: 'possessions', personId });

describe('Inventory (task 041)', () => {
    test('creates instances with deterministic ids and provenance', () => {
        const inventory = new Inventory();
        const pen = inventory.createInstance({ archetypeId: 'ballpoint_pen', owner: { kind: 'person', personId: 'p1' }, container: POSS('p1'), tick: 100, provenance: 42 });
        expect(pen).toMatchObject({ id: 'o0', archetypeId: 'ballpoint_pen', quantity: 1, createdAtTick: 100, provenance: 42 });
        const apple = inventory.createInstance({ archetypeId: 'apple', owner: { kind: 'person', personId: 'p1' }, container: POSS('p1'), tick: 100 });
        expect(apple.id).toBe('o1');
        expect(() => inventory.createInstance({ archetypeId: 'phlebotinum', owner: { kind: 'none' }, container: POSS('p1'), tick: 0 })).toThrow(/Unknown object archetype/);
    });

    test('stackables merge on identical archetype + owner + container + state; others never do', () => {
        const inventory = new Inventory();
        const owner = { kind: 'person', personId: 'p1' } as const;
        const first = inventory.createInstance({ archetypeId: 'coin', owner, container: POSS('p1'), tick: 0, quantity: 3 });
        const merged = inventory.createInstance({ archetypeId: 'coin', owner, container: POSS('p1'), tick: 5, quantity: 2 });
        expect(merged.id).toBe(first.id);
        expect(first.quantity).toBe(5);

        // A different owner (a borrowed coin?) must not merge into my stack.
        const other = inventory.createInstance({ archetypeId: 'coin', owner: { kind: 'business', key: '3-3' }, container: POSS('p1'), tick: 5 });
        expect(other.id).not.toBe(first.id);

        // Non-stackables always get identity.
        const book1 = inventory.createInstance({ archetypeId: 'book', owner, container: POSS('p1'), tick: 0 });
        const book2 = inventory.createInstance({ archetypeId: 'book', owner, container: POSS('p1'), tick: 0 });
        expect(book1.id).not.toBe(book2.id);
        expect(() => inventory.createInstance({ archetypeId: 'book', owner, container: POSS('p1'), tick: 0, quantity: 2 })).toThrow(/Invalid quantity/);
    });

    test('containment: objects nest in container archetypes, cycles are rejected', () => {
        const inventory = new Inventory();
        const owner = { kind: 'person', personId: 'p1' } as const;
        const backpack = inventory.createInstance({ archetypeId: 'backpack', owner, container: POSS('p1'), tick: 0 });
        const pencil = inventory.createInstance({ archetypeId: 'pencil', owner, container: POSS('p1'), tick: 0 });

        inventory.moveInstance(pencil.id, { kind: 'object', instanceId: backpack.id });
        expect(inventory.contentsOf({ kind: 'object', instanceId: backpack.id })).toHaveLength(1);
        // Top-level Possessions no longer lists the pencil, but carried queries see through containers.
        expect(inventory.possessionsOf('p1').map(instance => instance.archetypeId)).toEqual(['backpack']);
        expect(inventory.carriesArchetype('p1', 'pencil')).toBe(true);

        // A non-container can't contain; a container can't contain its own ancestor.
        const apple = inventory.createInstance({ archetypeId: 'apple', owner, container: POSS('p1'), tick: 0 });
        expect(() => inventory.moveInstance(backpack.id, { kind: 'object', instanceId: apple.id })).toThrow(/not a container/);
        const wallet = inventory.createInstance({ archetypeId: 'wallet', owner, container: { kind: 'object', instanceId: backpack.id }, tick: 0 });
        expect(() => inventory.moveInstance(backpack.id, { kind: 'object', instanceId: wallet.id })).toThrow(/Containment cycle/);
    });

    test('ownership and containment are independent axes', () => {
        const inventory = new Inventory();
        // A business-owned tool carried by a person: transfer of location never touches ownership and vice versa.
        const tool = inventory.createInstance({ archetypeId: 'screwdriver', owner: { kind: 'business', key: '7-7' }, container: POSS('p1'), tick: 0 });
        expect(inventory.possessionsOf('p1')).toHaveLength(1);
        expect(tool.owner).toEqual({ kind: 'business', key: '7-7' });

        inventory.transferOwnership(tool.id, { kind: 'person', personId: 'p1' });
        expect(tool.owner).toEqual({ kind: 'person', personId: 'p1' });
        inventory.moveInstance(tool.id, { kind: 'location', key: 'building:7-7' });
        expect(inventory.possessionsOf('p1')).toHaveLength(0);
        expect(tool.owner).toEqual({ kind: 'person', personId: 'p1' }); // still mine, just left at work
    });

    test('consumption depletes stacks and removes empties; containers refuse removal while full', () => {
        const inventory = new Inventory();
        const owner = { kind: 'person', personId: 'p1' } as const;
        const gum = inventory.createInstance({ archetypeId: 'chewing_gum_pack', owner, container: POSS('p1'), tick: 0, quantity: 2 });
        inventory.consume(gum.id, 1);
        expect(inventory.getInstance(gum.id)!.quantity).toBe(1);
        inventory.consume(gum.id);
        expect(inventory.getInstance(gum.id)).toBeNull();

        const book = inventory.createInstance({ archetypeId: 'book', owner, container: POSS('p1'), tick: 0 });
        expect(() => inventory.consume(book.id)).toThrow(/not consumable/);

        const backpack = inventory.createInstance({ archetypeId: 'backpack', owner, container: POSS('p1'), tick: 0 });
        inventory.moveInstance(book.id, { kind: 'object', instanceId: backpack.id });
        expect(() => inventory.removeInstance(backpack.id)).toThrow(/contains other instances/);
    });

    test('carried weight sums nested contents', () => {
        const inventory = new Inventory();
        const owner = { kind: 'person', personId: 'p1' } as const;
        const backpack = inventory.createInstance({ archetypeId: 'backpack', owner, container: POSS('p1'), tick: 0 }); // 800g
        inventory.createInstance({ archetypeId: 'book', owner, container: { kind: 'object', instanceId: backpack.id }, tick: 0 }); // 350g
        inventory.createInstance({ archetypeId: 'coin', owner, container: POSS('p1'), tick: 0, quantity: 5 }); // 5×8g
        expect(inventory.carriedWeightGrams('p1')).toBe(800 + 350 + 40);
    });

    test('state round-trips through getState/loadState with indexes rebuilt', () => {
        const first = new Inventory();
        const owner = { kind: 'person', personId: 'p1' } as const;
        const backpack = first.createInstance({ archetypeId: 'backpack', owner, container: POSS('p1'), tick: 0 });
        first.createInstance({ archetypeId: 'pencil', owner, container: { kind: 'object', instanceId: backpack.id }, tick: 0 });
        first.createInstance({ archetypeId: 'apple', owner: { kind: 'world' }, container: { kind: 'location', key: 'venue:park' }, tick: 3 });

        const second = new Inventory();
        second.loadState(JSON.parse(JSON.stringify(first.getState())));
        expect(second.possessionsOf('p1')).toHaveLength(1);
        expect(second.carriesArchetype('p1', 'pencil')).toBe(true);
        expect(second.instancesAtLocation('venue:park')).toHaveLength(1);
        // The id counter continues without collisions.
        const next = second.createInstance({ archetypeId: 'coin', owner, container: POSS('p1'), tick: 9 });
        expect(second.getState().instances[next.id]).toBeDefined();
        expect(Object.keys(second.getState().instances)).toHaveLength(4);
    });

    test('tag queries see carried items', () => {
        const inventory = new Inventory();
        const owner = { kind: 'person', personId: 'p1' } as const;
        inventory.createInstance({ archetypeId: 'teddy_bear', owner, container: POSS('p1'), tick: 0 });
        expect(inventory.carriesTag('p1', 'giftable')).toBe(true);
        expect(inventory.carriesTag('p1', 'medical')).toBe(false);
    });
});

describe('WorldAdapter.objectsAt (task 041)', () => {
    test('the bootstrap world answers from the shared inventory', () => {
        const inventory = new Inventory();
        inventory.createInstance({ archetypeId: 'flyer', owner: { kind: 'none' }, container: { kind: 'location', key: 'venue:park' }, tick: 0 });
        const world = new BootstrapWorld(inventory);
        expect(world.objectsAt({ kind: 'venue', venue: 'park' })).toHaveLength(1);
        expect(world.objectsAt({ kind: 'outside' })).toEqual([]);

        // A world without an inventory (pure event tests) degrades to empty, not to a crash.
        expect(new BootstrapWorld().objectsAt({ kind: 'outside' })).toEqual([]);
    });
});
