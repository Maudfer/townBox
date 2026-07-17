import Inventory, { DEFAULT_OBJECT_ARCHETYPES } from 'game/objects/Inventory';
import { ObjectQuery } from 'types/Simulation';

// The per-container archetype index (generator perf, task 120 wave 2): location queries answer from
// archetype buckets instead of scanning the location's whole contents list (which grows unboundedly over a
// long offline run — uncollected garbage, accumulated creations — and made requirement checks a per-step
// cost rising with elapsed simulated time). Every ObjectQuery condition is archetype-level, so the bucket
// answer must be IDENTICAL to the old instanceMatches scan — these tests pin that equivalence through every
// mutation path.

const HOME = 'building:home:test';

function naiveHas(inventory: Inventory, key: string, query: ObjectQuery): boolean {
    return inventory.instancesAtLocation(key).some(instance => inventory.instanceMatches(instance.id, query));
}

function naiveIds(inventory: Inventory, key: string, query: ObjectQuery): string[] {
    return inventory.instancesAtLocation(key)
        .filter(instance => inventory.instanceMatches(instance.id, query))
        .map(instance => instance.id);
}

function expectEquivalence(inventory: Inventory, key: string, queries: ObjectQuery[]): void {
    for (const query of queries) {
        expect(inventory.hasMatchingAtLocation(key, query)).toBe(naiveHas(inventory, key, query));
        expect(inventory.matchingIdsAtLocation(key, query)).toEqual(naiveIds(inventory, key, query));
    }
}

const QUERIES: ObjectQuery[] = [
    { archetype: 'bread_loaf' },
    { archetype: 'toolbox' },
    { archetype: 'no_such_archetype' },
    { tag: 'ingredient' },
    { flag: 'pocketable' },
    { flag: 'container' },
    { archetype: 'bread_loaf', flag: 'stackable' },
];

describe('the per-container archetype index', () => {
    test('bucket answers equal the naive contents scan, across archetype/tag/flag queries', () => {
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        inventory.createInstance({ archetypeId: 'bread_loaf', owner: { kind: 'none' }, container: { kind: 'location', key: HOME }, tick: 0 });
        inventory.createInstance({ archetypeId: 'toolbox', owner: { kind: 'none' }, container: { kind: 'location', key: HOME }, tick: 0 });
        inventory.createInstance({ archetypeId: 'pencil', owner: { kind: 'none' }, container: { kind: 'location', key: HOME }, tick: 0 });
        expectEquivalence(inventory, HOME, QUERIES);
        // A different location stays isolated.
        expect(inventory.hasMatchingAtLocation('building:home:other', { archetype: 'bread_loaf' })).toBe(false);
    });

    test('contained instances are NOT at the location (object containers keep their own buckets)', () => {
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const box = inventory.createInstance({ archetypeId: 'toolbox', owner: { kind: 'none' }, container: { kind: 'location', key: HOME }, tick: 0 });
        inventory.createInstance({ archetypeId: 'pencil', owner: { kind: 'none' }, container: { kind: 'object', instanceId: box.id }, tick: 0 });
        expect(inventory.hasMatchingAtLocation(HOME, { archetype: 'pencil' })).toBe(false);
        expectEquivalence(inventory, HOME, QUERIES);
    });

    test('moveInstance moves bucket membership between locations', () => {
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const loaf = inventory.createInstance({ archetypeId: 'bread_loaf', owner: { kind: 'none' }, container: { kind: 'location', key: HOME }, tick: 0 });
        inventory.moveInstance(loaf.id, { kind: 'location', key: 'building:home:other' });
        expect(inventory.hasMatchingAtLocation(HOME, { archetype: 'bread_loaf' })).toBe(false);
        expect(inventory.hasMatchingAtLocation('building:home:other', { archetype: 'bread_loaf' })).toBe(true);
    });

    test('an in-place transform moves the id between archetype buckets (old gone, new queryable)', () => {
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const dough = inventory.createInstance({ archetypeId: 'raw_dough', owner: { kind: 'none' }, container: { kind: 'location', key: HOME }, tick: 0 });
        inventory.transformInstance(dough.id, 'baked_dough');
        expect(inventory.hasMatchingAtLocation(HOME, { archetype: 'raw_dough' })).toBe(false);
        expect(inventory.matchingIdsAtLocation(HOME, { archetype: 'baked_dough' })).toEqual([dough.id]);
        expectEquivalence(inventory, HOME, [...QUERIES, { archetype: 'baked_dough' }, { archetype: 'raw_dough' }]);
    });

    test('removal empties the bucket; loadState rebuilds the index', () => {
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        const loaf = inventory.createInstance({ archetypeId: 'bread_loaf', owner: { kind: 'none' }, container: { kind: 'location', key: HOME }, tick: 0 });
        inventory.createInstance({ archetypeId: 'toolbox', owner: { kind: 'none' }, container: { kind: 'location', key: HOME }, tick: 0 });
        inventory.removeInstance(loaf.id);
        expect(inventory.hasMatchingAtLocation(HOME, { archetype: 'bread_loaf' })).toBe(false);

        const restored = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        restored.loadState(JSON.parse(JSON.stringify(inventory.getState())));
        expectEquivalence(restored, HOME, QUERIES);
        expect(restored.hasMatchingAtLocation(HOME, { archetype: 'toolbox' })).toBe(true);
    });

    test('matchingIdsAtLocation returns ascending ids — the same pick order as the old sorted-contents find', () => {
        const inventory = new Inventory(DEFAULT_OBJECT_ARCHETYPES);
        // Non-stackable instances of one archetype at distinct... toolbox is non-stackable? Use distinct
        // state to defeat stacking for stackables instead — distinct owners keep loaves as separate instances.
        const a = inventory.createInstance({ archetypeId: 'bread_loaf', owner: { kind: 'person', personId: 'p1' }, container: { kind: 'location', key: HOME }, tick: 0 });
        const b = inventory.createInstance({ archetypeId: 'bread_loaf', owner: { kind: 'person', personId: 'p2' }, container: { kind: 'location', key: HOME }, tick: 0 });
        const ids = inventory.matchingIdsAtLocation(HOME, { archetype: 'bread_loaf' });
        expect(ids).toEqual([a.id, b.id].sort());
        expect(ids).toEqual(naiveIds(inventory, HOME, { archetype: 'bread_loaf' }));
    });
});
