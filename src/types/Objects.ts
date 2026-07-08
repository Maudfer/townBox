import { Value } from 'types/Simulation';
import { PersonId } from 'types/Genealogy';
import { LogicalLocation } from 'types/Execution';

// The object system (task 041; docs/tasks/038 §5). `objects.json` defines ARCHETYPES — the platonic "ballpoint
// pen" — while runtime state consists of Object INSTANCES with identity, quantity, state, an owner, and a
// container. Ownership and containment are deliberately independent axes: a workplace tool is business-owned
// but person-carried; a gifted book changes owner but may sit in the same backpack.

export type ObjectArchetypeId = string;
export type ObjectInstanceId = string;

// Normalized units everywhere: dimensions in centimetres, weight in grams.
export interface ObjectDimensions {
    w: number;
    d: number;
    h: number;
}

export interface ObjectFlags {
    carryable: boolean; // can reasonably be picked up and carried
    pocketable: boolean; // fits in a pocket (implies carryable)
    stackable: boolean; // identical items merge into one instance with quantity
    consumable: boolean; // can be used up (eaten, spent, depleted)
    equippable: boolean; // can be worn/wielded (design-for; no equip system yet)
    placeable: boolean; // can be placed into the world/a building as furniture/equipment
}

// What an archetype can contain (`defaultContainerBehavior`). Absent = not a container. Both limits are
// optional; a container with neither is unbounded (used sparingly — e.g. a room-scale wardrobe).
export interface ContainerBehavior {
    capacityLiters?: number;
    maxItems?: number;
}

// How the contextual object generator (task 070) treats an archetype. `ownershipDefault: 'building'`
// resolves to business ownership inside a business and building ownership inside a house (the generator's
// rule); 'none' marks free-to-take loose items.
export interface ObjectGenerationSpec {
    kind: 'fixture' | 'consumable' | 'reusable' | 'loose';
    weight?: number;
    minPerBuilding?: number;
    maxPerBuilding?: number;
    uniquePerBuilding?: boolean;
    ownershipDefault?: 'building' | 'none';
    accessibility?: 'public' | 'staff' | 'private';
}

export interface ObjectArchetype {
    id: ObjectArchetypeId;
    label: string;
    category: string; // broad grouping (food, stationery, tool, …); the 039 validator pins the vocabulary
    size: ObjectDimensions;
    weightGrams: number;
    flags: ObjectFlags;
    container?: ContainerBehavior;
    tags?: string[];
    // Placement/context tags (task 069): WHERE this object plausibly occurs — a many-to-many link into the
    // controlled vocabulary (json/placement.json). A separate axis from the activity `tags` above; tags
    // represent environmental context inside a building (rooms are never simulated).
    placement?: string[];
    // Generation metadata (069; consumed by the deterministic building fill, 070).
    generation?: ObjectGenerationSpec; // free-form selection hooks for Actions/Brain (041+: "giftable", "toy", …)
}

export type ObjectArchetypeTable = Record<ObjectArchetypeId, ObjectArchetype>;

// Who an instance BELONGS to (legal/possessive), independent of where it physically is.
export type ObjectOwner =
    | { kind: 'person'; personId: PersonId }
    | { kind: 'business'; key: string } // workplace anchor key
    | { kind: 'building'; key: string } // e.g. house fixtures
    | { kind: 'world' }
    | { kind: 'none' };

// Where an instance physically IS. `possessions` is a person's carried inventory (the Possessions container);
// `object` nests instances (pencil in a backpack, dough in a bowl); `location` is a logical world location
// (a building's interior, a venue, the outdoors) addressed by its canonical key (locationKey()).
export type ObjectContainerRef =
    | { kind: 'possessions'; personId: PersonId }
    | { kind: 'object'; instanceId: ObjectInstanceId }
    | { kind: 'location'; key: string };

export interface ObjectInstance {
    id: ObjectInstanceId;
    archetypeId: ObjectArchetypeId;
    quantity: number; // 1 for non-stackables; >= 1 for stackables
    state?: Record<string, Value>; // instance attributes (condition, doneness, …), set by consequences (044)
    owner: ObjectOwner;
    container: ObjectContainerRef;
    createdAtTick: number;
    provenance: number | null; // causation seq of the record that created it (038 §3.2); null = seeded/unknown
}

// The serializable inventory state (save v8 family). Instance ids are `o<n>` from a deterministic counter.
export interface InventoryState {
    instances: Record<ObjectInstanceId, ObjectInstance>;
    nextInstanceSeq: number;
}

// Canonical string key for a logical location, used to address `location` containers. Stable and
// JSON-independent so container refs survive serialization and comparison.
export function locationKey(location: LogicalLocation): string {
    switch (location.kind) {
        case 'home':
            return 'home'; // note: relative locations resolve to a building key before storage where possible
        case 'building':
            return `building:${location.key}`;
        case 'venue':
            return `venue:${location.venue}`;
        case 'outside':
            return 'outside';
    }
}

// The inverse of locationKey(): parses a canonical key back into a LogicalLocation (task 043 — action
// definitions author locations as keys). Unknown shapes read as 'outside' rather than throwing; the data
// validators reject malformed keys before they reach the runtime.
export function parseLocationKey(key: string): LogicalLocation {
    if (key === 'home') {
        return { kind: 'home' };
    }
    if (key === 'outside') {
        return { kind: 'outside' };
    }
    if (key.startsWith('building:')) {
        return { kind: 'building', key: key.slice('building:'.length) };
    }
    if (key.startsWith('venue:')) {
        return { kind: 'venue', venue: key.slice('venue:'.length) };
    }
    return { kind: 'outside' };
}
