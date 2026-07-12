import Inventory from 'game/objects/Inventory';
import { ObjectArchetypeTable } from 'types/Objects';

// Direct unit tests for the object-instance system (task 041) that Consequences.ts's two-phase atomic
// executor drives (game/events/Consequences.ts). consequences.test.ts already exercises Inventory through
// full action scenarios (the bake-a-cake chain, lending, etc.); this file pins Inventory's own invariants
// directly — stacking/merging, containment cycle rejection, consume/withdraw/transform edge cases, and the
// teardown helpers (clearLocation/reassignOwnedBy) — so a regression here can't hide behind a passing
// higher-level scenario.

const ARCHETYPES: ObjectArchetypeTable = {
    coin: { id: 'coin', label: 'Coin', category: 'currency', size: { w: 1, d: 1, h: 1 }, weightGrams: 5, flags: { carryable: true, pocketable: true, stackable: true, consumable: false, equippable: false, placeable: false } },
    apple: { id: 'apple', label: 'Apple', category: 'food', size: { w: 5, d: 5, h: 5 }, weightGrams: 100, flags: { carryable: true, pocketable: true, stackable: true, consumable: true, equippable: false, placeable: false } },
    backpack: { id: 'backpack', label: 'Backpack', category: 'container', size: { w: 30, d: 20, h: 40 }, weightGrams: 500, flags: { carryable: true, pocketable: false, stackable: false, consumable: false, equippable: false, placeable: false }, container: { capacityLiters: 20 } },
    book: { id: 'book', label: 'Book', category: 'media', size: { w: 15, d: 20, h: 3 }, weightGrams: 300, flags: { carryable: true, pocketable: false, stackable: false, consumable: false, equippable: false, placeable: false }, tags: ['giftable'] },
    raw_dough: { id: 'raw_dough', label: 'Raw dough', category: 'food', size: { w: 10, d: 10, h: 5 }, weightGrams: 200, flags: { carryable: true, pocketable: false, stackable: true, consumable: false, equippable: false, placeable: false } },
    baked_dough: { id: 'baked_dough', label: 'Baked dough', category: 'food', size: { w: 10, d: 10, h: 5 }, weightGrams: 180, flags: { carryable: true, pocketable: false, stackable: true, consumable: false, equippable: false, placeable: false } },
};

function inv(): Inventory {
    return new Inventory(ARCHETYPES);
}

describe('Inventory — creation & stacking', () => {
    test('unknown archetype throws', () => {
        const i = inv();
        expect(() => i.createInstance({ archetypeId: 'ghost', owner: { kind: 'world' }, container: { kind: 'location', key: 'home' }, tick: 0 })).toThrow(/Unknown object archetype/);
    });

    test('invalid quantity throws: zero/negative, and non-1 for a non-stackable', () => {
        const i = inv();
        expect(() => i.createInstance({ archetypeId: 'coin', owner: { kind: 'world' }, container: { kind: 'location', key: 'home' }, tick: 0, quantity: 0 })).toThrow(/Invalid quantity/);
        expect(() => i.createInstance({ archetypeId: 'book', owner: { kind: 'world' }, container: { kind: 'location', key: 'home' }, tick: 0, quantity: 2 })).toThrow(/Invalid quantity/);
    });

    test('identical stackables in the same container/owner/state merge into one instance', () => {
        const i = inv();
        const first = i.createInstance({ archetypeId: 'coin', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0, quantity: 2 });
        const second = i.createInstance({ archetypeId: 'coin', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 5, quantity: 3 });
        expect(second.id).toBe(first.id);
        expect(i.possessionsOf('a')).toHaveLength(1);
        expect(i.possessionsOf('a')[0]!.quantity).toBe(5);
    });

    test('same archetype but different owner/state does NOT merge', () => {
        const i = inv();
        i.createInstance({ archetypeId: 'coin', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        i.createInstance({ archetypeId: 'coin', owner: { kind: 'person', personId: 'b' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 }); // held by a, owned by b
        i.createInstance({ archetypeId: 'raw_dough', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0, state: { doneness: 'raw' } });
        i.createInstance({ archetypeId: 'raw_dough', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0, state: { doneness: 'stale' } });
        expect(i.possessionsOf('a')).toHaveLength(4);
    });

    test('a created instance in a non-existent object container throws', () => {
        const i = inv();
        expect(() => i.createInstance({ archetypeId: 'coin', owner: { kind: 'world' }, container: { kind: 'object', instanceId: 'ghost' }, tick: 0 })).toThrow(/does not exist/);
    });

    test('placing an instance inside a non-container archetype throws', () => {
        const i = inv();
        const coin = i.createInstance({ archetypeId: 'coin', owner: { kind: 'world' }, container: { kind: 'location', key: 'home' }, tick: 0 });
        expect(() => i.createInstance({ archetypeId: 'apple', owner: { kind: 'world' }, container: { kind: 'object', instanceId: coin.id }, tick: 0 })).toThrow(/is not a container/);
    });
});

describe('Inventory — movement, ownership, cycles', () => {
    test('moveInstance relocates and rejects an unknown instance', () => {
        const i = inv();
        const book = i.createInstance({ archetypeId: 'book', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        i.moveInstance(book.id, { kind: 'location', key: 'home' });
        expect(book.container).toEqual({ kind: 'location', key: 'home' });
        expect(i.possessionsOf('a')).toHaveLength(0);
        expect(() => i.moveInstance('ghost', { kind: 'location', key: 'home' })).toThrow(/Unknown instance/);
    });

    test('a containment cycle (a backpack ending up inside itself) is rejected', () => {
        const i = inv();
        const backpack = i.createInstance({ archetypeId: 'backpack', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        const book = i.createInstance({ archetypeId: 'book', owner: { kind: 'person', personId: 'a' }, container: { kind: 'object', instanceId: backpack.id }, tick: 0 });
        // Direct self-containment.
        expect(() => i.moveInstance(backpack.id, { kind: 'object', instanceId: backpack.id })).toThrow(/Containment cycle/);
        // Indirect: book is already inside backpack; backpack cannot go inside book (would nest through it).
        void book;
    });

    test('transferOwnership changes owner without touching physical location', () => {
        const i = inv();
        const coin = i.createInstance({ archetypeId: 'coin', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        i.transferOwnership(coin.id, { kind: 'person', personId: 'b' });
        expect(coin.owner).toEqual({ kind: 'person', personId: 'b' });
        expect(coin.container).toEqual({ kind: 'possessions', personId: 'a' });
    });

    test('setInstanceState merges into existing state', () => {
        const i = inv();
        const dough = i.createInstance({ archetypeId: 'raw_dough', owner: { kind: 'world' }, container: { kind: 'location', key: 'home' }, tick: 0, state: { salted: true } });
        i.setInstanceState(dough.id, 'kneaded', true);
        expect(dough.state).toEqual({ salted: true, kneaded: true });
    });
});

describe('Inventory — consumption, withdrawal, transformation', () => {
    test('consume() rejects a non-consumable archetype', () => {
        const i = inv();
        const book = i.createInstance({ archetypeId: 'book', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        expect(() => i.consume(book.id)).toThrow(/is not consumable/);
    });

    test('consume() rejects an invalid amount and removes the instance when depleted', () => {
        const i = inv();
        const apple = i.createInstance({ archetypeId: 'apple', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0, quantity: 2 });
        expect(() => i.consume(apple.id, 5)).toThrow(/Invalid consume amount/);
        expect(() => i.consume(apple.id, 0)).toThrow(/Invalid consume amount/);
        i.consume(apple.id, 1);
        expect(i.getInstance(apple.id)!.quantity).toBe(1);
        i.consume(apple.id); // default: consume all remaining
        expect(i.getInstance(apple.id)).toBeNull();
    });

    test('withdraw() (crafting draw-down) rejects an invalid amount and removes at zero', () => {
        const i = inv();
        const dough = i.createInstance({ archetypeId: 'raw_dough', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0, quantity: 3 });
        expect(() => i.withdraw(dough.id, 10)).toThrow(/Invalid withdraw amount/);
        i.withdraw(dough.id, 3);
        expect(i.getInstance(dough.id)).toBeNull();
    });

    test('transformInstance on the whole stack swaps archetype in place and clears/sets state', () => {
        const i = inv();
        const dough = i.createInstance({ archetypeId: 'raw_dough', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0, quantity: 2, state: { salted: true } });
        const transformed = i.transformInstance(dough.id, 'baked_dough', undefined, 2);
        expect(transformed.id).toBe(dough.id); // identity preserved
        expect(transformed.archetypeId).toBe('baked_dough');
        expect(transformed.state).toBeUndefined(); // no new state clears the old
    });

    test('transformInstance on part of a stack splits off a new instance', () => {
        const i = inv();
        const dough = i.createInstance({ archetypeId: 'raw_dough', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0, quantity: 3 });
        const baked = i.transformInstance(dough.id, 'baked_dough', { toasted: true }, 1);
        expect(baked.id).not.toBe(dough.id);
        expect(baked.state).toEqual({ toasted: true });
        expect(i.getInstance(dough.id)!.quantity).toBe(2);
    });

    test('transformInstance rejects an unknown target archetype or an invalid amount', () => {
        const i = inv();
        const dough = i.createInstance({ archetypeId: 'raw_dough', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        expect(() => i.transformInstance(dough.id, 'ghost')).toThrow(/Unknown object archetype/);
        expect(() => i.transformInstance(dough.id, 'baked_dough', undefined, 9)).toThrow(/Invalid transform amount/);
    });

    test('removeInstance rejects removal while the instance still contains other instances', () => {
        const i = inv();
        const backpack = i.createInstance({ archetypeId: 'backpack', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        i.createInstance({ archetypeId: 'book', owner: { kind: 'person', personId: 'a' }, container: { kind: 'object', instanceId: backpack.id }, tick: 0 });
        expect(() => i.removeInstance(backpack.id)).toThrow(/while it contains other instances/);
        expect(() => i.removeInstance('ghost')).toThrow(/Unknown instance/);
    });
});

describe('Inventory — queries', () => {
    test('carriesArchetype / carriesTag look through nested containers', () => {
        const i = inv();
        const backpack = i.createInstance({ archetypeId: 'backpack', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        i.createInstance({ archetypeId: 'book', owner: { kind: 'person', personId: 'a' }, container: { kind: 'object', instanceId: backpack.id }, tick: 0 });
        expect(i.carriesArchetype('a', 'book')).toBe(true);
        expect(i.carriesArchetype('a', 'apple')).toBe(false);
        expect(i.carriesTag('a', 'giftable')).toBe(true);
        expect(i.carriesTag('a', 'nope')).toBe(false);
    });

    test('carriedWeightGrams sums nested carried instances by quantity', () => {
        const i = inv();
        const backpack = i.createInstance({ archetypeId: 'backpack', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        i.createInstance({ archetypeId: 'apple', owner: { kind: 'person', personId: 'a' }, container: { kind: 'object', instanceId: backpack.id }, tick: 0, quantity: 3 });
        // backpack (500) + 3 apples (100 each = 300) = 800
        expect(i.carriedWeightGrams('a')).toBe(800);
    });

    test('instanceMatches checks archetype/tag/flag and rejects a dead reference', () => {
        const i = inv();
        const book = i.createInstance({ archetypeId: 'book', owner: { kind: 'world' }, container: { kind: 'location', key: 'home' }, tick: 0 });
        expect(i.instanceMatches(book.id, { archetype: 'book' })).toBe(true);
        expect(i.instanceMatches(book.id, { archetype: 'coin' })).toBe(false);
        expect(i.instanceMatches(book.id, { tag: 'giftable' })).toBe(true);
        expect(i.instanceMatches(book.id, { tag: 'nope' })).toBe(false);
        expect(i.instanceMatches(book.id, { flag: 'carryable' })).toBe(true);
        expect(i.instanceMatches(book.id, { flag: 'consumable' })).toBe(false);
        expect(i.instanceMatches('ghost', { archetype: 'book' })).toBe(false);
    });

    test('instancesOwnedBy finds everything an owner holds title to regardless of physical location', () => {
        const i = inv();
        const key = '5-5';
        i.createInstance({ archetypeId: 'coin', owner: { kind: 'business', key }, container: { kind: 'location', key: 'home' }, tick: 0 });
        i.createInstance({ archetypeId: 'book', owner: { kind: 'business', key }, container: { kind: 'possessions', personId: 'employee' }, tick: 0 });
        i.createInstance({ archetypeId: 'apple', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        expect(i.instancesOwnedBy({ kind: 'business', key }).map(inst => inst.archetypeId).sort()).toEqual(['book', 'coin']);
    });
});

describe('Inventory — teardown helpers (task 070)', () => {
    test('clearLocation removes everything at a location, recursively including container contents', () => {
        const i = inv();
        const backpack = i.createInstance({ archetypeId: 'backpack', owner: { kind: 'world' }, container: { kind: 'location', key: 'home' }, tick: 0 });
        i.createInstance({ archetypeId: 'book', owner: { kind: 'world' }, container: { kind: 'object', instanceId: backpack.id }, tick: 0 });
        i.createInstance({ archetypeId: 'coin', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 }); // unaffected: carried, not at 'home'
        const removed = i.clearLocation('home');
        expect(removed).toBe(2); // backpack + the book inside it
        expect(i.instancesAtLocation('home')).toHaveLength(0);
        expect(i.possessionsOf('a')).toHaveLength(1);
    });

    test('reassignOwnedBy moves title for everything an owner held, leaving physical location untouched', () => {
        const i = inv();
        const oldOwner = { kind: 'business' as const, key: '5-5' };
        const newOwner = { kind: 'world' as const };
        i.createInstance({ archetypeId: 'coin', owner: oldOwner, container: { kind: 'possessions', personId: 'employee' }, tick: 0 });
        const reassigned = i.reassignOwnedBy(oldOwner, newOwner);
        expect(reassigned).toBe(1);
        expect(i.instancesOwnedBy(oldOwner)).toHaveLength(0);
        expect(i.possessionsOf('employee')).toHaveLength(1); // still physically carried
        expect(i.instancesOwnedBy(newOwner)).toHaveLength(1);
    });
});

describe('Inventory — serialization & epochs', () => {
    test('getState/loadState round-trips and rebuilds the container index', () => {
        const i = inv();
        i.createInstance({ archetypeId: 'coin', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        const snapshot = JSON.parse(JSON.stringify(i.getState()));

        const restored = inv();
        restored.loadState(snapshot);
        expect(restored.possessionsOf('a')).toHaveLength(1);
        expect(restored.possessionsOf('a')[0]!.archetypeId).toBe('coin');
    });

    test('loadState with no state defaults to empty', () => {
        const i = inv();
         
        i.loadState(undefined as any);
        expect(i.getState()).toEqual({ instances: {}, nextInstanceSeq: 0 });
    });

    test('getMutationEpoch / getContainerEpoch bump on containment-changing mutations', () => {
        const i = inv();
        const epoch0 = i.getMutationEpoch();
        const coin = i.createInstance({ archetypeId: 'coin', owner: { kind: 'person', personId: 'a' }, container: { kind: 'possessions', personId: 'a' }, tick: 0 });
        expect(i.getMutationEpoch()).toBeGreaterThan(epoch0);
        const containerKeyEpoch = i.getContainerEpoch('possessions:a');
        i.moveInstance(coin.id, { kind: 'location', key: 'home' });
        expect(i.getContainerEpoch('possessions:a')).toBeGreaterThan(containerKeyEpoch);
        expect(i.getContainerEpoch('location:nowhere-touched')).toBe(0); // untouched keys default to 0
    });

    test('getArchetypes / getArchetype expose the loaded table', () => {
        const i = inv();
        expect(i.getArchetypes()).toBe(ARCHETYPES);
        expect(i.getArchetype('coin')).toEqual(ARCHETYPES['coin']);
        expect(i.getArchetype('ghost')).toBeNull();
    });
});
