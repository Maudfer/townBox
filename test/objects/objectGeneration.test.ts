import Inventory from 'game/objects/Inventory';
import { generateBuildingObjects } from 'game/objects/ObjectGeneration';

import { ObjectArchetype } from 'types/Objects';

import residencesConfig from 'json/residences.json';
import businessesConfig from 'json/businesses.json';

// Deterministic contextual object generation (task 070): tag-intersection candidates, guaranteed essentials,
// caps/uniqueness, ownership resolution, teardown symmetry, and determinism — over the REAL manifests.

const HOUSE_TAGS = (residencesConfig as { house: { tags: string[] } }).house.tags;
const BAKERY_TAGS = (businessesConfig as Record<string, { tags: string[] }>)['bakery']!.tags;

function fill(anchorKey: string, tags: readonly string[], host: 'house' | 'business', worldSeed = 42, generationIndex?: number) {
    const inventory = new Inventory();
    const created = generateBuildingObjects({ anchorKey, tags, host, worldSeed, tick: 10, ...(generationIndex !== undefined ? { generationIndex } : {}) }, inventory);
    return { inventory, created };
}

function idsAt(inventory: Inventory, anchorKey: string): string[] {
    return inventory.instancesAtLocation(`building:${anchorKey}`).map(instance => `${instance.archetypeId}#${instance.quantity}`).sort();
}

describe('the fill', () => {
    test('a house gets its essentials (guaranteed minimums) plus a bounded weighted variety', () => {
        const { inventory, created } = fill('4-4', HOUSE_TAGS, 'house');
        const archetypes = inventory.instancesAtLocation('building:4-4').map(instance => instance.archetypeId);
        for (const essential of ['oven', 'stove', 'refrigerator', 'bed', 'toilet', 'couch', 'television']) {
            expect(archetypes).toContain(essential);
        }
        expect(created).toBeLessThanOrEqual(40); // the per-building cap
        expect(created).toBeGreaterThan(20);
    });

    test('candidates come only from the tag intersection', () => {
        const { inventory } = fill('7-7', BAKERY_TAGS, 'business');
        const manifest = inventory.getArchetypes() as Record<string, ObjectArchetype>;
        for (const instance of inventory.instancesAtLocation('building:7-7')) {
            const placement = manifest[instance.archetypeId]!.placement ?? [];
            expect(placement.some(tag => BAKERY_TAGS.includes(tag))).toBe(true);
        }
    });

    test('ownership resolves by host: business stock vs house fixtures vs free-to-take loose items', () => {
        const { inventory } = fill('7-7', BAKERY_TAGS, 'business');
        const manifest = inventory.getArchetypes() as Record<string, ObjectArchetype>;
        for (const instance of inventory.instancesAtLocation('building:7-7')) {
            const spec = manifest[instance.archetypeId]!.generation!;
            if ((spec.ownershipDefault ?? 'building') === 'none') {
                expect(instance.owner).toEqual({ kind: 'none' });
            } else {
                expect(instance.owner).toEqual({ kind: 'business', key: '7-7' });
            }
        }
        const house = fill('4-4', HOUSE_TAGS, 'house');
        const owned = house.inventory.instancesAtLocation('building:4-4').find(instance => instance.owner.kind === 'building');
        expect(owned?.owner).toEqual({ kind: 'building', key: '4-4' });
    });

    test('uniqueness and per-archetype maximums hold across many seeds', () => {
        const manifestProbe = new Inventory().getArchetypes() as Record<string, ObjectArchetype>;
        for (let seed = 1; seed <= 5; seed++) {
            const { inventory } = fill('4-4', HOUSE_TAGS, 'house', seed);
            const counts = new Map<string, number>();
            for (const instance of inventory.instancesAtLocation('building:4-4')) {
                counts.set(instance.archetypeId, (counts.get(instance.archetypeId) ?? 0) + instance.quantity);
            }
            for (const [archetypeId, count] of counts) {
                const spec = manifestProbe[archetypeId]!.generation!;
                const max = spec.uniquePerBuilding ? 1 : Math.max(spec.maxPerBuilding ?? 1, spec.minPerBuilding ?? 0);
                expect(count).toBeLessThanOrEqual(max);
            }
        }
    });
});

describe('determinism & re-occupancy', () => {
    test('same seed + anchor ⇒ identical fills; different anchors/generations differ', () => {
        const a = fill('4-4', HOUSE_TAGS, 'house', 42);
        const b = fill('4-4', HOUSE_TAGS, 'house', 42);
        expect(idsAt(a.inventory, '4-4')).toEqual(idsAt(b.inventory, '4-4'));

        const otherAnchor = fill('9-9', HOUSE_TAGS, 'house', 42);
        expect(idsAt(otherAnchor.inventory, '9-9')).not.toEqual(idsAt(a.inventory, '4-4'));

        const gen0 = fill('7-7', BAKERY_TAGS, 'business', 42, 0);
        const gen1 = fill('7-7', BAKERY_TAGS, 'business', 42, 1);
        expect(idsAt(gen0.inventory, '7-7')).not.toEqual(idsAt(gen1.inventory, '7-7'));
    });
});

describe('teardown symmetry (Inventory helpers)', () => {
    test('clearLocation removes location objects (recursively) but never carried ones', () => {
        const inventory = new Inventory();
        generateBuildingObjects({ anchorKey: '7-7', tags: BAKERY_TAGS, host: 'business', worldSeed: 42, tick: 10 }, inventory);
        // A person carries one of the loose items away before the closure.
        const loose = inventory.instancesAtLocation('building:7-7').find(instance => instance.owner.kind === 'none');
        expect(loose).toBeDefined();
        inventory.moveInstance(loose!.id, { kind: 'possessions', personId: 'p' });

        const removed = inventory.clearLocation('building:7-7');
        expect(removed).toBeGreaterThan(0);
        expect(inventory.instancesAtLocation('building:7-7')).toHaveLength(0);
        expect(inventory.possessionsOf('p').map(instance => instance.id)).toEqual([loose!.id]); // carried survives

        // Business-owned stock elsewhere becomes world property.
        inventory.reassignOwnedBy({ kind: 'business', key: '7-7' }, { kind: 'world' });
        expect(inventory.instancesOwnedBy({ kind: 'business', key: '7-7' })).toHaveLength(0);
    });
});

describe('consumption proof (the 071 seam)', () => {
    test('a freshly generated house satisfies the oven-at-location OAR context out of the box', () => {
        const { inventory } = fill('4-4', HOUSE_TAGS, 'house');
        const hasOven = inventory.instancesAtLocation('building:4-4').some(instance => instance.archetypeId === 'oven');
        expect(hasOven).toBe(true); // the bake chain's context requirement is satisfiable in any generated kitchen
    });
});

// Object reachability (task 076/M2): every object archetype must be able to enter the world — generatable
// into some building (placement tag ∩ building tags), created as an OAR output, or referenced by an
// action/OAR/event. Before this task ~581 objects sat behind deferred venues and 11 seed objects had no
// placement at all, so they could never spawn.
describe('object reachability (task 076/M2)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const objects = require('json/objects.json') as Record<string, { placement?: string[] }>;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const actions = require('json/actions.json');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const oar = require('json/object-action-relationships.json');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const events = require('json/events.json');

    test('every object archetype can enter the world', () => {
        const buildingTags = new Set<string>(HOUSE_TAGS);
        for (const blueprint of Object.values(businessesConfig as Record<string, { tags?: string[] }>)) {
            for (const tag of blueprint.tags ?? []) buildingTags.add(tag);
        }
        const ids = new Set(Object.keys(objects));
        const referenced = new Set<string>();
        const scan = (value: unknown): void => {
            if (value == null) return;
            if (typeof value === 'string') { if (ids.has(value)) referenced.add(value); return; }
            if (typeof value === 'object') for (const v of Object.values(value as Record<string, unknown>)) scan(v);
        };
        scan(actions); scan(oar); scan(events);

        const unreachable = Object.keys(objects).filter(id => {
            const placement = objects[id]!.placement ?? [];
            const generatable = placement.some(tag => buildingTags.has(tag));
            return !generatable && !referenced.has(id);
        }).sort();
        expect(unreachable).toEqual([]);
    });
});
