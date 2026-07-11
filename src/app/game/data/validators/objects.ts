// Validator for the object-archetype manifest (src/json/objects.json, task 041). Archetypes only — runtime
// instances are engine state, validated by the Inventory's invariants, not here.

import { checkArray, checkBoolean, checkEnum, checkNumber, checkRecord, checkString, checkUnknownKeys } from 'game/data/checks';
import { IssueCollector } from 'game/data/registry';

// The category vocabulary, aligned with the content-planning master list (docs/planning/objects-master-list.md)
// so the 050 backfill drops in without a remap. Extending it is a deliberate one-line change here.
export const OBJECT_CATEGORIES = [
    'food', 'drink', 'stationery', 'tool', 'toy', 'clothing', 'electronics', 'furniture', 'appliance',
    'kitchenware', 'book/media', 'medical', 'sports/outdoors', 'hygiene/cleaning', 'garden/farm',
    'vehicle/vehicle-part', 'decoration', 'document', 'container', 'instrument', 'misc',
];

const ARCHETYPE_KEYS = ['label', 'category', 'size', 'weightGrams', 'flags', 'container', 'tags', 'placement', 'generation'];
const FLAG_KEYS = ['carryable', 'pocketable', 'stackable', 'consumable', 'equippable', 'placeable'];

// Physical sanity rails (grams / cm). Deliberately generous — they exist to catch data-entry mistakes
// (a pocketable couch), not to model physics.
const MAX_POCKETABLE_GRAMS = 2_500;
const MAX_POCKETABLE_DIMENSION_CM = 40;
const MAX_CARRYABLE_GRAMS = 40_000;

export function validateObjectsStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, '', data)) {
        return;
    }
    for (const [id, archetype] of Object.entries(data)) {
        if (!checkRecord(issues, id, archetype)) {
            continue;
        }
        checkUnknownKeys(issues, id, archetype, ARCHETYPE_KEYS);
        checkString(issues, `${id}.label`, archetype['label']);
        if (checkString(issues, `${id}.category`, archetype['category']) && !OBJECT_CATEGORIES.includes(archetype['category'] as string)) {
            issues.add(`${id}.category`, `unknown category "${archetype['category']}" (allowed: ${OBJECT_CATEGORIES.join(', ')})`);
        }

        let maxDimension = 0;
        if (checkRecord(issues, `${id}.size`, archetype['size'])) {
            const size = archetype['size'] as Record<string, unknown>;
            checkUnknownKeys(issues, `${id}.size`, size, ['w', 'd', 'h']);
            for (const axis of ['w', 'd', 'h']) {
                if (checkNumber(issues, `${id}.size.${axis}`, size[axis], { min: 0.05 })) {
                    maxDimension = Math.max(maxDimension, size[axis] as number);
                }
            }
        }
        const weightOk = checkNumber(issues, `${id}.weightGrams`, archetype['weightGrams'], { min: 0.1 });

        let flags: Record<string, unknown> | null = null;
        if (checkRecord(issues, `${id}.flags`, archetype['flags'])) {
            flags = archetype['flags'] as Record<string, unknown>;
            checkUnknownKeys(issues, `${id}.flags`, flags, FLAG_KEYS);
            for (const flag of FLAG_KEYS) {
                checkBoolean(issues, `${id}.flags.${flag}`, flags[flag]);
            }
            if (flags['pocketable'] === true && flags['carryable'] !== true) {
                issues.add(`${id}.flags`, 'pocketable implies carryable');
            }
            if (weightOk && flags['pocketable'] === true) {
                if ((archetype['weightGrams'] as number) > MAX_POCKETABLE_GRAMS) {
                    issues.add(`${id}.weightGrams`, `pocketable items must weigh <= ${MAX_POCKETABLE_GRAMS}g`);
                }
                if (maxDimension > MAX_POCKETABLE_DIMENSION_CM) {
                    issues.add(`${id}.size`, `pocketable items must fit ${MAX_POCKETABLE_DIMENSION_CM}cm in every dimension`);
                }
            }
            if (weightOk && flags['carryable'] === true && (archetype['weightGrams'] as number) > MAX_CARRYABLE_GRAMS) {
                issues.add(`${id}.weightGrams`, `carryable items must weigh <= ${MAX_CARRYABLE_GRAMS}g`);
            }
            if (flags['carryable'] === false && flags['placeable'] !== true) {
                issues.add(`${id}.flags`, 'a non-carryable object must at least be placeable (else it can never exist anywhere)');
            }
        }

        if ('container' in archetype && checkRecord(issues, `${id}.container`, archetype['container'])) {
            const container = archetype['container'] as Record<string, unknown>;
            checkUnknownKeys(issues, `${id}.container`, container, ['capacityLiters', 'maxItems']);
            if ('capacityLiters' in container) {
                checkNumber(issues, `${id}.container.capacityLiters`, container['capacityLiters'], { min: 0.01 });
            }
            if ('maxItems' in container) {
                checkNumber(issues, `${id}.container.maxItems`, container['maxItems'], { min: 1, integer: true });
            }
        }

        if ('tags' in archetype && checkArray(issues, `${id}.tags`, archetype['tags'])) {
            (archetype['tags'] as unknown[]).forEach((tag, index) => checkString(issues, `${id}.tags[${index}]`, tag));
        }
        if ('placement' in archetype && checkArray(issues, `${id}.placement`, archetype['placement'])) {
            (archetype['placement'] as unknown[]).forEach((tag, index) => checkString(issues, `${id}.placement[${index}]`, tag));
        }
        if ('generation' in archetype && checkRecord(issues, `${id}.generation`, archetype['generation'])) {
            const generation = archetype['generation'] as Record<string, unknown>;
            checkUnknownKeys(issues, `${id}.generation`, generation, ['kind', 'weight', 'minPerBuilding', 'maxPerBuilding', 'uniquePerBuilding', 'ownershipDefault', 'accessibility']);
            checkEnum(issues, `${id}.generation.kind`, generation['kind'], ['fixture', 'consumable', 'reusable', 'loose']);
            if ('weight' in generation) {
                checkNumber(issues, `${id}.generation.weight`, generation['weight'], { min: 0.000001 });
            }
            const minOk = !('minPerBuilding' in generation) || checkNumber(issues, `${id}.generation.minPerBuilding`, generation['minPerBuilding'], { min: 0, integer: true });
            const maxOk = !('maxPerBuilding' in generation) || checkNumber(issues, `${id}.generation.maxPerBuilding`, generation['maxPerBuilding'], { min: 1, integer: true });
            if (minOk && maxOk && 'minPerBuilding' in generation && 'maxPerBuilding' in generation
                && (generation['maxPerBuilding'] as number) < (generation['minPerBuilding'] as number)) {
                issues.add(`${id}.generation.maxPerBuilding`, 'must be >= minPerBuilding');
            }
            if (generation['uniquePerBuilding'] === true && 'maxPerBuilding' in generation && (generation['maxPerBuilding'] as number) > 1) {
                issues.add(`${id}.generation.maxPerBuilding`, 'uniquePerBuilding implies maxPerBuilding 1');
            }
            if ('ownershipDefault' in generation) {
                checkEnum(issues, `${id}.generation.ownershipDefault`, generation['ownershipDefault'], ['building', 'none']);
            }
            if ('accessibility' in generation) {
                checkEnum(issues, `${id}.generation.accessibility`, generation['accessibility'], ['public', 'staff', 'private']);
            }
        }
    }
}


// Semantic pass (task 069): placement tags must exist in the vocabulary; placement and generation come
// together (a placed object without generation metadata can never be generated — and vice versa is noise).
export function validateObjectsSemantics(data: unknown, peers: Record<string, unknown>, issues: IssueCollector): void {
    const vocab = ((peers['placement'] ?? {}) as { tags?: Record<string, unknown> }).tags ?? {};
    for (const [id, archetype] of Object.entries((data ?? {}) as Record<string, { placement?: string[]; generation?: unknown }>)) {
        for (const tag of archetype.placement ?? []) {
            if (!(tag in vocab)) {
                issues.add(`${id}.placement`, `unknown placement tag "${tag}" (not in placement.json)`);
            }
        }
        if ((archetype.placement?.length ?? 0) > 0 !== (archetype.generation !== undefined)) {
            issues.add(`${id}`, 'placement and generation metadata must come together (task 069)');
        }
    }
}
