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

import objectsConfig from 'json/objects.json';
import { PersonId } from 'types/Genealogy';
import {
    ObjectArchetype,
    ObjectArchetypeTable,
    ObjectContainerRef,
    ObjectInstance,
    ObjectInstanceId,
    ObjectOwner,
    InventoryState,
} from 'types/Objects';
import { ObjectQuery, Value } from 'types/Simulation';
import { count } from 'util/perfMeter';

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
    // Read caches (task 079 pass 2): `contentsOf` re-did [...set].sort()+map per call, and it is the primitive
    // under every hot query (objectsAt, carriedInstances, requirement predicates) — the V8 profile put it at
    // ~5% of a generator run. Containment membership only changes through indexInstance/unindexInstance, so
    // both caches are cleared there (and on load); reads between mutations return the same array instance.
    // CONTRACT: callers must not mutate the returned arrays (all shipped call sites are read-only — they map/
    // filter/find into new arrays). Instance objects inside are live references, exactly as before.
    private contentsCache = new Map<string, ObjectInstance[]>();
    private carriedCache = new Map<PersonId, ObjectInstance[]>();
    // Monotonic containment-mutation counter (task 079 pass 2): lets external caches (the ActionEngine's
    // object-query cache) key their validity on "has the inventory changed since I computed this".
    private mutationEpoch = 0;
    // Per-containerKey mutation epochs (task 079 pass 2): a grab at one house must not invalidate every other
    // location's cached query answers — with ~hundreds of people resolving actions each tick, a global epoch
    // churns so often the external query cache never survives. Bumped alongside the global epoch for exactly
    // the containerKey whose membership (or member archetype) changed.
    private containerEpochs = new Map<string, number>();

    constructor(archetypes: ObjectArchetypeTable = DEFAULT_OBJECT_ARCHETYPES) {
        this.archetypes = archetypes;
        this.state = { instances: {}, nextInstanceSeq: 0 };
        this.byContainer = new Map();
    }

    getArchetypes(): Record<string, ObjectArchetype> {
        return this.archetypes;
    }

    // Teardown (task 070): remove every instance physically at a location key, recursively including the
    // contents of containers standing there. Carried instances are unaffected (their container is a person).
    clearLocation(key: string): number {
        let removed = 0;
        const atLocation = this.instancesAtLocation(key).map(instance => instance.id);
        const removeDeep = (instanceId: string): void => {
            for (const child of this.contentsOf({ kind: 'object', instanceId })) {
                removeDeep(child.id);
            }
            this.removeInstance(instanceId);
            removed++;
        };
        for (const instanceId of atLocation) {
            removeDeep(instanceId);
        }
        return removed;
    }

    // Teardown (task 070): reassign everything an owner holds (e.g. a closed business's stock carried by
    // employees) to a new owner — physical containment untouched.
    reassignOwnedBy(owner: ObjectOwner, newOwner: ObjectOwner): number {
        let reassigned = 0;
        for (const instance of this.instancesOwnedBy(owner)) {
            this.transferOwnership(instance.id, newOwner);
            reassigned++;
        }
        return reassigned;
    }

    getState(): InventoryState {
        return this.state;
    }

    loadState(state: InventoryState): void {
        this.state = state ?? { instances: {}, nextInstanceSeq: 0 };
        this.byContainer = new Map();
        this.contentsCache.clear();
        this.carriedCache.clear();
        this.mutationEpoch++;
        for (const instance of Object.values(this.state.instances)) {
            this.indexInstance(instance);
        }
    }

    // Containment of `key` changed — drop the affected read caches (see the field docs). The contents cache
    // and container epoch are per-key; the carried cache clears globally (mapping a nested container back to
    // its carrier is not worth the bookkeeping — carried sets are tiny to rebuild).
    private invalidateReadCaches(key: string): void {
        this.contentsCache.delete(key);
        this.carriedCache.clear();
        this.mutationEpoch++;
        this.containerEpochs.set(key, (this.containerEpochs.get(key) ?? 0) + 1);
    }

    getMutationEpoch(): number {
        return this.mutationEpoch;
    }

    getContainerEpoch(key: string): number {
        return this.containerEpochs.get(key) ?? 0;
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
        this.invalidateReadCaches(key);
    }

    private unindexInstance(instance: ObjectInstance): void {
        const key = containerKey(instance.container);
        this.byContainer.get(key)?.delete(instance.id);
        this.invalidateReadCaches(key);
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

    // Spoilage sweep (task 089 / F3): removes every instance whose archetype declares `expiresAfterTicks`
    // and whose age exceeds it. Deterministic (no RNG), called on the day cadence (live: City.handleNewDay;
    // offline: the generator's runDaily). Bread rots; the shelf drains; production resumes below the ceiling.
    sweepExpired(tick: number): number {
        let removed = 0;
        for (const [id, instance] of Object.entries(this.state.instances)) {
            const expires = this.archetypes[instance.archetypeId]?.expiresAfterTicks;
            if (expires !== undefined && tick - instance.createdAtTick >= expires) {
                this.removeInstance(id);
                removed++;
            }
        }
        return removed;
    }

    // Whether an instance matches an object query (archetype id / archetype tag / archetype flag). The one
    // matching rule shared by predicate evaluation (carries/objectAtLocation) and consequence ObjectRefs.
    instanceMatches(instanceId: ObjectInstanceId, query: ObjectQuery): boolean {
        const instance = this.state.instances[instanceId];
        const archetype = instance ? this.archetypes[instance.archetypeId] : null;
        if (!instance || !archetype) {
            return false;
        }
        if (query.archetype !== undefined && instance.archetypeId !== query.archetype) {
            return false;
        }
        if (query.tag !== undefined && !(archetype.tags ?? []).includes(query.tag)) {
            return false;
        }
        if (query.flag !== undefined && !(archetype.flags as unknown as Record<string, boolean>)[query.flag]) {
            return false;
        }
        return true;
    }

    // Crafting withdrawal (task 044): removes `quantity` (default: all) from an instance regardless of the
    // consumable flag — consuming flour into dough is not eating it. Removes the instance at zero.
    withdraw(instanceId: ObjectInstanceId, quantity?: number): void {
        const instance = this.requireInstance(instanceId);
        const amount = quantity ?? instance.quantity;
        if (amount < 1 || amount > instance.quantity) {
            throw new Error(`[Inventory] Invalid withdraw amount ${amount} (have ${instance.quantity})`);
        }
        instance.quantity -= amount;
        if (instance.quantity === 0) {
            this.removeInstance(instanceId);
        }
    }

    // Crafting transformation (task 044): the instance BECOMES another archetype (raw dough → baked dough),
    // preserving identity, owner, and container. Transforming part of a stack splits it: the transformed
    // portion becomes a new instance. Returns the transformed instance.
    transformInstance(instanceId: ObjectInstanceId, archetypeId: string, state?: Record<string, Value>, quantity?: number): ObjectInstance {
        const instance = this.requireInstance(instanceId);
        if (!this.archetypes[archetypeId]) {
            throw new Error(`[Inventory] Unknown object archetype "${archetypeId}"`);
        }
        const amount = quantity ?? instance.quantity;
        if (amount < 1 || amount > instance.quantity) {
            throw new Error(`[Inventory] Invalid transform amount ${amount} (have ${instance.quantity})`);
        }
        if (amount < instance.quantity) {
            instance.quantity -= amount;
            return this.createInstance({
                archetypeId,
                owner: instance.owner,
                container: instance.container,
                tick: instance.createdAtTick,
                quantity: this.archetypes[archetypeId]!.flags.stackable ? amount : 1,
                provenance: instance.provenance,
                ...(state ? { state } : {}),
            });
        }
        instance.archetypeId = archetypeId;
        if (state) {
            instance.state = { ...state };
        } else {
            delete instance.state;
        }
        // No containment change, but the in-place archetype swap changes what archetype/tag/flag queries see —
        // external epoch-keyed query caches must observe it (task 079 pass 2).
        this.invalidateReadCaches(containerKey(instance.container));
        return instance;
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
        const key = containerKey(container);
        const cached = this.contentsCache.get(key);
        if (cached) {
            return cached;
        }
        count('inv.contentsBuild'); // perf: contentsOf cache misses — per-container-epoch invalidation health (task 079)
        const ids = [...(this.byContainer.get(key) ?? [])].sort();
        const result = ids.map(id => this.state.instances[id]!).filter(Boolean);
        this.contentsCache.set(key, result);
        return result;
    }

    // A person's Possessions: what they actively carry (top level only; look inside containers explicitly).
    possessionsOf(personId: PersonId): ObjectInstance[] {
        return this.contentsOf({ kind: 'possessions', personId });
    }

    instancesAtLocation(key: string): ObjectInstance[] {
        return this.contentsOf({ kind: 'location', key });
    }

    // Every instance a given owner holds title to, wherever it physically sits (task 047: the business
    // inventory view — employer-owned work outputs land here via 044's consequence ownership).
    instancesOwnedBy(owner: ObjectOwner): ObjectInstance[] {
        const ownerKey = JSON.stringify(owner);
        return Object.values(this.state.instances)
            .filter(instance => JSON.stringify(instance.owner) === ownerKey)
            .sort((a, b) => a.id.localeCompare(b.id));
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
        const cached = this.carriedCache.get(personId);
        if (cached) {
            return cached;
        }
        count('inv.carriedBuild'); // perf: carriedInstances cache misses (task 079)
        const result: ObjectInstance[] = [];
        const walk = (container: ObjectContainerRef): void => {
            for (const instance of this.contentsOf(container)) {
                result.push(instance);
                walk({ kind: 'object', instanceId: instance.id });
            }
        };
        walk({ kind: 'possessions', personId });
        this.carriedCache.set(personId, result);
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
