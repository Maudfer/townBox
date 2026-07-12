import BootstrapWorld from 'game/execution/BootstrapWorld';
import Inventory, { containerKey } from 'game/objects/Inventory';
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

    test('initial instance state round-trips, and state is part of the stacking identity', () => {
        const inventory = new Inventory();
        const owner = { kind: 'person', personId: 'p1' } as const;
        const fresh = inventory.createInstance({ archetypeId: 'raw_dough', owner, container: POSS('p1'), tick: 0, state: { batch: 1 } });
        expect(fresh.state).toEqual({ batch: 1 });

        // Same archetype/owner/container but different state must NOT merge into the same stack (findStack's
        // state comparison should reject it) — two batches of dough are not interchangeable.
        const otherBatch = inventory.createInstance({ archetypeId: 'raw_dough', owner, container: POSS('p1'), tick: 0, state: { batch: 2 } });
        expect(otherBatch.id).not.toBe(fresh.id);

        // Identical state DOES merge.
        const sameBatch = inventory.createInstance({ archetypeId: 'raw_dough', owner, container: POSS('p1'), tick: 0, state: { batch: 1 } });
        expect(sameBatch.id).toBe(fresh.id);
        expect(fresh.quantity).toBe(2);
    });

    test('setInstanceState merges into (not replaces) existing state', () => {
        const inventory = new Inventory();
        const owner = { kind: 'person', personId: 'p1' } as const;
        const book = inventory.createInstance({ archetypeId: 'book', owner, container: POSS('p1'), tick: 0 });
        inventory.setInstanceState(book.id, 'read', true);
        expect(inventory.getInstance(book.id)!.state).toEqual({ read: true });
        inventory.setInstanceState(book.id, 'bookmarked', 12);
        expect(inventory.getInstance(book.id)!.state).toEqual({ read: true, bookmarked: 12 });
    });

    test('consume rejects invalid amounts', () => {
        const inventory = new Inventory();
        const owner = { kind: 'person', personId: 'p1' } as const;
        const gum = inventory.createInstance({ archetypeId: 'chewing_gum_pack', owner, container: POSS('p1'), tick: 0, quantity: 2 });
        expect(() => inventory.consume(gum.id, 0)).toThrow(/Invalid consume amount/);
        expect(() => inventory.consume(gum.id, 3)).toThrow(/Invalid consume amount/);
    });

    test('instanceMatches evaluates archetype/tag/flag queries, and misses cleanly on unknown ids', () => {
        const inventory = new Inventory();
        const owner = { kind: 'person', personId: 'p1' } as const;
        const coin = inventory.createInstance({ archetypeId: 'coin', owner, container: POSS('p1'), tick: 0 });

        expect(inventory.instanceMatches('nonexistent', { archetype: 'coin' })).toBe(false);
        expect(inventory.instanceMatches(coin.id, { archetype: 'coin' })).toBe(true);
        expect(inventory.instanceMatches(coin.id, { archetype: 'book' })).toBe(false);
        expect(inventory.instanceMatches(coin.id, { flag: 'stackable' })).toBe(true);
        expect(inventory.instanceMatches(coin.id, { flag: 'consumable' })).toBe(false);

        const bear = inventory.createInstance({ archetypeId: 'teddy_bear', owner, container: POSS('p1'), tick: 0 });
        expect(inventory.instanceMatches(bear.id, { tag: 'giftable' })).toBe(true);
        expect(inventory.instanceMatches(bear.id, { tag: 'medical' })).toBe(false);
    });

    test('withdraw removes a bounded quantity, deleting the instance when depleted', () => {
        const inventory = new Inventory();
        const owner = { kind: 'person', personId: 'p1' } as const;
        const dough = inventory.createInstance({ archetypeId: 'raw_dough', owner, container: POSS('p1'), tick: 0, quantity: 5 });
        inventory.withdraw(dough.id, 2);
        expect(inventory.getInstance(dough.id)!.quantity).toBe(3);
        expect(() => inventory.withdraw(dough.id, 0)).toThrow(/Invalid withdraw amount/);
        expect(() => inventory.withdraw(dough.id, 99)).toThrow(/Invalid withdraw amount/);
        inventory.withdraw(dough.id); // default: withdraw everything remaining
        expect(inventory.getInstance(dough.id)).toBeNull();
    });

    test('transformInstance swaps archetype in place, splits a partial amount off a stack, and validates inputs', () => {
        const inventory = new Inventory();
        const owner = { kind: 'person', personId: 'p1' } as const;

        // In-place transform (amount === full quantity): identity preserved, new state replaces old.
        const singleDough = inventory.createInstance({ archetypeId: 'raw_dough', owner, container: POSS('p1'), tick: 0, state: { proofed: false } });
        const baked = inventory.transformInstance(singleDough.id, 'baked_dough', { proofed: true });
        expect(baked.id).toBe(singleDough.id);
        expect(baked.archetypeId).toBe('baked_dough');
        expect(baked.state).toEqual({ proofed: true });

        // Omitting `state` on an in-place transform clears any previous state.
        const anotherDough = inventory.createInstance({ archetypeId: 'raw_dough', owner, container: POSS('p1'), tick: 0, state: { proofed: false } });
        const bakedNoState = inventory.transformInstance(anotherDough.id, 'baked_dough');
        expect(bakedNoState.state).toBeUndefined();

        // Partial transform: splits a new instance off a stack, target's own (non-)stackability wins — the
        // non-stackable baked_dough gets quantity 1 even though 2 units of dough were consumed.
        const stack = inventory.createInstance({ archetypeId: 'raw_dough', owner, container: POSS('p1'), tick: 0, quantity: 5, state: { batch: 9 } });
        const split = inventory.transformInstance(stack.id, 'baked_dough', undefined, 2);
        expect(split.id).not.toBe(stack.id);
        expect(split.archetypeId).toBe('baked_dough');
        expect(split.quantity).toBe(1);
        expect(inventory.getInstance(stack.id)!.quantity).toBe(3);

        expect(() => inventory.transformInstance(stack.id, 'no_such_archetype')).toThrow(/Unknown object archetype/);
        expect(() => inventory.transformInstance(stack.id, 'baked_dough', undefined, 0)).toThrow(/Invalid transform amount/);
        expect(() => inventory.transformInstance(stack.id, 'baked_dough', undefined, 99)).toThrow(/Invalid transform amount/);
    });

    test('clearLocation recursively tears down nested containers left at a location', () => {
        const inventory = new Inventory();
        const owner = { kind: 'world' } as const;
        const backpack = inventory.createInstance({ archetypeId: 'backpack', owner, container: { kind: 'location', key: 'venue:park' }, tick: 0 });
        inventory.createInstance({ archetypeId: 'pencil', owner, container: { kind: 'object', instanceId: backpack.id }, tick: 0 });

        const removed = inventory.clearLocation('venue:park');
        expect(removed).toBe(2); // the backpack and the pencil nested inside it
        expect(inventory.instancesAtLocation('venue:park')).toHaveLength(0);
        expect(inventory.getInstance(backpack.id)).toBeNull();
    });

    test('reassignOwnedBy retitles every instance an owner holds, wherever it physically sits', () => {
        const inventory = new Inventory();
        const businessOwner = { kind: 'business', key: '7-7' } as const;
        // Carried by an employee, nowhere near the business's own location — proves the sweep is by
        // ownership, not by containment.
        const tool = inventory.createInstance({ archetypeId: 'screwdriver', owner: businessOwner, container: POSS('employee1'), tick: 0 });
        expect(inventory.instancesOwnedBy(businessOwner)).toHaveLength(1);

        const reassigned = inventory.reassignOwnedBy(businessOwner, { kind: 'world' });
        expect(reassigned).toBe(1);
        expect(inventory.instancesOwnedBy(businessOwner)).toHaveLength(0);
        expect(inventory.getInstance(tool.id)!.owner).toEqual({ kind: 'world' });
    });

    test('instancesOwnedBy sorts matches by string id, not creation order ("o10" precedes "o9")', () => {
        const inventory = new Inventory();
        const owner = { kind: 'business', key: '1-1' } as const;
        const ids: string[] = [];
        for (let i = 0; i <= 10; i++) {
            const instance = inventory.createInstance({ archetypeId: 'screwdriver', owner, container: { kind: 'location', key: `spot-${i}` }, tick: 0 });
            ids.push(instance.id);
        }
        expect(ids[9]).toBe('o9');
        expect(ids[10]).toBe('o10');

        const sortedIds = inventory.instancesOwnedBy(owner).map(instance => instance.id);
        // Lexicographic sort ("o10" < "o9") only happens if the comparator actually ran — creation order
        // would have put o9 before o10.
        expect(sortedIds.indexOf('o10')).toBeLessThan(sortedIds.indexOf('o9'));
    });

    test('unknown instance/container references throw typed errors', () => {
        const inventory = new Inventory();
        expect(() => inventory.moveInstance('bogus', { kind: 'location', key: 'x' })).toThrow(/Unknown instance/);
        expect(() =>
            inventory.createInstance({ archetypeId: 'coin', owner: { kind: 'none' }, container: { kind: 'object', instanceId: 'bogus' }, tick: 0 })
        ).toThrow(/does not exist/);
    });

    test('exposes mutation/container epochs and direct archetype lookups', () => {
        const inventory = new Inventory();
        const owner = { kind: 'person', personId: 'p1' } as const;
        expect(inventory.getMutationEpoch()).toBe(0);
        expect(inventory.getArchetype('coin')).not.toBeNull();
        expect(inventory.getArchetype('no_such_archetype')).toBeNull();

        const key = containerKey(POSS('p1'));
        expect(inventory.getContainerEpoch(key)).toBe(0);
        inventory.createInstance({ archetypeId: 'coin', owner, container: POSS('p1'), tick: 0 });
        expect(inventory.getMutationEpoch()).toBeGreaterThan(0);
        expect(inventory.getContainerEpoch(key)).toBeGreaterThan(0);
        // A different, untouched container key stays at epoch 0 — invalidation is scoped per key.
        expect(inventory.getContainerEpoch(containerKey(POSS('p2')))).toBe(0);
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
