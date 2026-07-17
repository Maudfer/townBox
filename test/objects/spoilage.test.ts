import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';

// Spoilage (task 089 / proposal F3): perishables past their shelf life are removed by the daily sweep —
// deterministic, no RNG; bread rots, the shelf drains, production resumes below the ceiling.

describe('sweepExpired', () => {
    test('removes expired perishables, keeps fresh ones and non-perishables', () => {
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const stale = inventory.createInstance({ archetypeId: 'bread_loaf', owner: { kind: 'none' }, container: { kind: 'location', key: 'home' }, tick: 0 });
        // A different location so the stackable loaves do NOT merge (a merged stack ages as one, by design).
        const fresh = inventory.createInstance({ archetypeId: 'bread_loaf', owner: { kind: 'none' }, container: { kind: 'location', key: 'other' }, tick: 100 });
        const durable = inventory.createInstance({ archetypeId: 'toolbox', owner: { kind: 'none' }, container: { kind: 'location', key: 'home' }, tick: 0 });

        // bread_loaf expires after 120 ticks; at tick 130 the tick-0 loaf is gone, the tick-100 one is fine.
        const removed = inventory.sweepExpired(130);
        expect(removed).toBe(1);
        expect(inventory.getInstance(stale.id)).toBeNull();
        expect(inventory.getInstance(fresh.id)).not.toBeNull();
        expect(inventory.getInstance(durable.id)).not.toBeNull();
    });

    test('the shipped manifest declares shelf lives on the audit\'s worst accumulators', () => {
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        for (const archetypeId of ['baked_dough', 'bread_loaf', 'cake']) {
            expect(inventory.getArchetype(archetypeId)?.expiresAfterTicks).toBeGreaterThan(0);
        }
        // Non-food stays timeless.
        expect(inventory.getArchetype('toolbox')?.expiresAfterTicks).toBeUndefined();
    });

    // The expiring-candidates set (generator perf): the sweep iterates only instances that CAN expire, not
    // the whole table. Membership must track every path an instance's expirability can change through.
    test('sweeps instances that arrived via load and via in-place transform; never resurrects removed ones', () => {
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        inventory.createInstance({ archetypeId: 'bread_loaf', owner: { kind: 'none' }, container: { kind: 'location', key: 'home' }, tick: 0 });
        // Round-trip through loadState: the rebuilt set must still find the loaf.
        const restored = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        restored.loadState(JSON.parse(JSON.stringify(inventory.getState())));
        expect(restored.sweepExpired(130)).toBe(1);
        expect(restored.sweepExpired(130)).toBe(0); // gone — not resurrected, not double-counted

        // An in-place transform INTO a perishable joins the sweep; OUT of one leaves it.
        const kitchen = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const dough = kitchen.createInstance({ archetypeId: 'raw_dough', owner: { kind: 'none' }, container: { kind: 'location', key: 'bakery' }, tick: 0 });
        expect(kitchen.getArchetype('raw_dough')?.expiresAfterTicks).toBeUndefined(); // fixture sanity: starts non-perishable
        kitchen.transformInstance(dough.id, 'baked_dough');
        expect(kitchen.sweepExpired(100_000)).toBe(1); // far past any shelf life — the transformed loaf spoils
        expect(kitchen.getInstance(dough.id)).toBeNull();
    });
});
