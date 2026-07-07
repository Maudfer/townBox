// The object-instance system (task 041; docs/tasks/038 §5). One scene-free registry owns every Object
// Instance in the world — what it is (archetype), how many (stackables), whose it is (owner), and where it
// physically sits (container: a person's Possessions, inside another instance, or at a logical location).
// Person "Possessions" are deliberately NOT a field on Person: they are the `possessions` container keyed by
// the genealogy PersonId, so inventory serializes once, survives de/re-materialization, and works identically
// in both execution modes (the bootstrap has no Person objects at all).
//
// Determinism: instance ids come from a serialized counter (`o<n>`); no RNG, no wall clock. Mutations go
// through the methods below — they maintain the container index and enforce the containment invariants
// (containers must be container archetypes; containment cycles are rejected).

import {
    ObjectArchetype,
    ObjectArchetypeTable,
    ObjectContainerRef,
    ObjectInstance,
    ObjectInstanceId,
    ObjectOwner,
    InventoryState,
} from 'types/Objects';
import { PersonId } from 'types/Genealogy';
import { Value } from 'types/Simulation';

import objectsConfig from 'json/objects.json';

export const DEFAULT_OBJECT_ARCHETYPES: ObjectArchetypeTable = objectsConfig as unknown as ObjectArchetypeTable;

// Canonical string for a container ref, used as the container-index key.
export function containerKey(container: ObjectContainerRef): string {
    switch (container.kind) {
        case 'possessions':
            return `possessions:${container.personId}`;
        case 'object':
            return `object:${container.instanceId}`;
        case 'location':
            return `location:${container.key}`;
    }
}

export interface CreateSpec {
    archetypeId: string;
    owner: ObjectOwner;
    container: ObjectContainerRef;
    tick: number;
    quantity?: number;
    state?: Record<string, Value>;
    provenance?: number | null;
}

export default class Inventory {
    private archetypes: ObjectArchetypeTable;
    private state: InventoryState;
    // Derived index: containerKey -> instance ids, rebuilt on load, maintained on mutation.
    private byContainer: Map<string, Set<ObjectInstanceId>>;

    constructor(archetypes: ObjectArchetypeTable = DEFAULT_OBJECT_ARCHETYPES) {
        this.archetypes = archetypes;
        this.state = { instances: {}, nextInstanceSeq: 0 };
        this.byContainer = new Map();
    }

    getState(): InventoryState {
        return this.state;
    }

    loadState(state: InventoryState): void {
        this.state = state ?? { instances: {}, nextInstanceSeq: 0 };
        this.byContainer = new Map();
        for (const instance of Object.values(this.state.instances)) {
            this.indexInstance(instance);
        }
    }

    getArchetype(archetypeId: string): ObjectArchetype | null {
        return this.archetypes[archetypeId] ?? null;
    }

    getInstance(instanceId: ObjectInstanceId): ObjectInstance | null {
        return this.state.instances[instanceId] ?? null;
    }

    private indexInstance(instance: ObjectInstance): void {
        const key = containerKey(instance.container);
        const set = this.byContainer.get(key) ?? new Set<ObjectInstanceId>();
        set.add(instance.id);
        this.byContainer.set(key, set);
    }

    private unindexInstance(instance: ObjectInstance): void {
        this.byContainer.get(containerKey(instance.container))?.delete(instance.id);
    }

    // --- Creation & stacking ------------------------------------------------

    // Creates an instance (or merges into an existing stack: same archetype + owner + container + identical
    // state). Returns the resulting instance. Throws on unknown archetypes or invalid containers — creation
    // is consequence-driven (044) and a bad reference is an authoring error, not a runtime condition.
    createInstance(spec: CreateSpec): ObjectInstance {
        const archetype = this.archetypes[spec.archetypeId];
        if (!archetype) {
            throw new Error(`[Inventory] Unknown object archetype "${spec.archetypeId}"`);
        }
        const quantity = spec.quantity ?? 1;
        if (quantity < 1 || (!archetype.flags.stackable && quantity !== 1)) {
            throw new Error(`[Inventory] Invalid quantity ${quantity} for "${spec.archetypeId}"`);
        }
        this.assertValidContainer(spec.container, null);

        if (archetype.flags.stackable) {
            const existing = this.findStack(spec);
            if (existing) {
                existing.quantity += quantity;
                return existing;
            }
        }

        const instance: ObjectInstance = {
            id: `o${this.state.nextInstanceSeq++}`,
            archetypeId: spec.archetypeId,
            quantity,
            owner: spec.owner,
            container: spec.container,
            createdAtTick: spec.tick,
            provenance: spec.provenance ?? null,
        };
        if (spec.state && Object.keys(spec.state).length > 0) {
            instance.state = { ...spec.state };
        }
        this.state.instances[instance.id] = instance;
        this.indexInstance(instance);
        return instance;
    }

    private findStack(spec: CreateSpec): ObjectInstance | null {
        for (const id of this.byContainer.get(containerKey(spec.container)) ?? []) {
            const candidate = this.state.instances[id];
            if (!candidate || candidate.archetypeId !== spec.archetypeId) {
                continue;
            }
            if (JSON.stringify(candidate.owner) !== JSON.stringify(spec.owner)) {
                continue;
            }
            if (JSON.stringify(candidate.state ?? {}) !== JSON.stringify(spec.state ?? {})) {
                continue;
            }
            return candidate;
        }
        return null;
    }

    // --- Movement, ownership, consumption ------------------------------------

    // Moves an instance into a new container. Enforces: object containers must exist and be container
    // archetypes; no containment cycles (a backpack can't end up inside itself, however indirectly).
    moveInstance(instanceId: ObjectInstanceId, container: ObjectContainerRef): void {
        const instance = this.requireInstance(instanceId);
        this.assertValidContainer(container, instanceId);
        this.unindexInstance(instance);
        instance.container = container;
        this.indexInstance(instance);
    }

    transferOwnership(instanceId: ObjectInstanceId, owner: ObjectOwner): void {
        this.requireInstance(instanceId).owner = owner;
    }

    setInstanceState(instanceId: ObjectInstanceId, key: string, value: Value): void {
        const instance = this.requireInstance(instanceId);
        instance.state = { ...(instance.state ?? {}), [key]: value };
    }

    // Consumes `quantity` (default: all) of a consumable instance; removes it when depleted. Contained
    // instances of a removed container are NOT auto-destroyed — consuming a container is rejected while full.
    consume(instanceId: ObjectInstanceId, quantity?: number): void {
        const instance = this.requireInstance(instanceId);
        const archetype = this.archetypes[instance.archetypeId];
        if (!archetype?.flags.consumable) {
            throw new Error(`[Inventory] "${instance.archetypeId}" is not consumable`);
        }
        const amount = quantity ?? instance.quantity;
        if (amount < 1 || amount > instance.quantity) {
            throw new Error(`[Inventory] Invalid consume amount ${amount} (have ${instance.quantity})`);
        }
        instance.quantity -= amount;
        if (instance.quantity === 0) {
            this.removeInstance(instanceId);
        }
    }

    // Removes an instance outright (destruction/teardown). Rejected while it still contains other instances.
    removeInstance(instanceId: ObjectInstanceId): void {
        const instance = this.requireInstance(instanceId);
        if ((this.byContainer.get(`object:${instanceId}`)?.size ?? 0) > 0) {
            throw new Error(`[Inventory] Cannot remove "${instanceId}" while it contains other instances`);
        }
        this.unindexInstance(instance);
        delete this.state.instances[instanceId];
    }

    // --- Queries --------------------------------------------------------------

    contentsOf(container: ObjectContainerRef): ObjectInstance[] {
        const ids = [...(this.byContainer.get(containerKey(container)) ?? [])].sort();
        return ids.map(id => this.state.instances[id]!).filter(Boolean);
    }

    // A person's Possessions: what they actively carry (top level only; look inside containers explicitly).
    possessionsOf(personId: PersonId): ObjectInstance[] {
        return this.contentsOf({ kind: 'possessions', personId });
    }

    instancesAtLocation(key: string): ObjectInstance[] {
        return this.contentsOf({ kind: 'location', key });
    }

    // Whether the person carries an instance of the archetype (directly or nested in carried containers).
    carriesArchetype(personId: PersonId, archetypeId: string): boolean {
        return this.carriedInstances(personId).some(instance => instance.archetypeId === archetypeId);
    }

    carriesTag(personId: PersonId, tag: string): boolean {
        return this.carriedInstances(personId).some(instance => (this.archetypes[instance.archetypeId]?.tags ?? []).includes(tag));
    }

    // Everything a person carries, including instances nested inside carried containers.
    carriedInstances(personId: PersonId): ObjectInstance[] {
        const result: ObjectInstance[] = [];
        const walk = (container: ObjectContainerRef): void => {
            for (const instance of this.contentsOf(container)) {
                result.push(instance);
                walk({ kind: 'object', instanceId: instance.id });
            }
        };
        walk({ kind: 'possessions', personId });
        return result;
    }

    // Total carried weight in grams (nested containers included) — the capacity query "Pocketed a small
    // object" style requirements need. Enforcement stays lenient in v1 (038 §5); the number must exist.
    carriedWeightGrams(personId: PersonId): number {
        let total = 0;
        for (const instance of this.carriedInstances(personId)) {
            const archetype = this.archetypes[instance.archetypeId];
            total += (archetype?.weightGrams ?? 0) * instance.quantity;
        }
        return total;
    }

    // --- Invariants -----------------------------------------------------------

    private requireInstance(instanceId: ObjectInstanceId): ObjectInstance {
        const instance = this.state.instances[instanceId];
        if (!instance) {
            throw new Error(`[Inventory] Unknown instance "${instanceId}"`);
        }
        return instance;
    }

    // Container must be resolvable; object containers must be container archetypes; and placing `moving`
    // inside `container` must not create a cycle through the object-container chain.
    private assertValidContainer(container: ObjectContainerRef, moving: ObjectInstanceId | null): void {
        if (container.kind !== 'object') {
            return;
        }
        const host = this.state.instances[container.instanceId];
        if (!host) {
            throw new Error(`[Inventory] Container instance "${container.instanceId}" does not exist`);
        }
        const hostArchetype = this.archetypes[host.archetypeId];
        if (!hostArchetype?.container) {
            throw new Error(`[Inventory] "${host.archetypeId}" is not a container`);
        }
        if (moving) {
            // Walk up the chain from the host; hitting `moving` means we'd contain our own ancestor.
            let cursor: ObjectInstance | null = host;
            while (cursor) {
                if (cursor.id === moving) {
                    throw new Error(`[Inventory] Containment cycle: "${moving}" cannot contain itself`);
                }
                cursor = cursor.container.kind === 'object' ? this.state.instances[cursor.container.instanceId] ?? null : null;
            }
        }
    }
}
