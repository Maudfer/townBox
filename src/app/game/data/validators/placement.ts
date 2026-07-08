// Validators for the placement-tag system (task 069): the controlled vocabulary (json/placement.json), the
// residence tag sets (json/residences.json), and the cross-file CLOSED-LOOP rules — every tag is carried by
// at least one object (no dead tags), every building-scoped tag appears on at least one building context (a
// building-scope tag no building carries should be `deferred` instead), and blueprints/residences may only
// carry building-scoped vocabulary tags. Objects' `placement`/`generation` fields are validated by the
// objects validator (shape) plus the semantic vocabulary check here-adjacent (validators/objects.ts).

import { IssueCollector } from 'game/data/registry';
import { checkArray, checkEnum, checkRecord, checkString, checkUnknownKeys, isRecord } from 'game/data/checks';

const TAG_PATTERN = /^[a-z][a-z0-9-]*$/;

export function validatePlacementStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, '', data)) {
        return;
    }
    checkUnknownKeys(issues, '', data, ['tags']);
    if (!checkRecord(issues, 'tags', data['tags'])) {
        return;
    }
    for (const [tag, spec] of Object.entries(data['tags'] as Record<string, unknown>)) {
        if (!TAG_PATTERN.test(tag)) {
            issues.add(`tags.${tag}`, 'placement tags must be kebab-case');
        }
        if (!checkRecord(issues, `tags.${tag}`, spec)) {
            continue;
        }
        checkUnknownKeys(issues, `tags.${tag}`, spec, ['label', 'scope']);
        checkString(issues, `tags.${tag}.label`, spec['label']);
        checkEnum(issues, `tags.${tag}.scope`, spec['scope'], ['building', 'deferred']);
    }
}

export function validatePlacementSemantics(data: unknown, peers: Record<string, unknown>, issues: IssueCollector): void {
    if (!isRecord(data) || !isRecord(data['tags'])) {
        return;
    }
    const vocab = data['tags'] as Record<string, { scope?: string }>;

    // Objects carrying each tag (closed loop part 1: no dead tags).
    const carried = new Set<string>();
    const objects = (peers['objects'] ?? {}) as Record<string, { placement?: string[] }>;
    for (const definition of Object.values(objects)) {
        for (const tag of definition.placement ?? []) {
            carried.add(tag);
        }
    }
    for (const tag of Object.keys(vocab)) {
        if (!carried.has(tag)) {
            issues.add(`tags.${tag}`, 'dead tag: no object archetype carries it (closed-loop rule, task 069)');
        }
    }

    // Building contexts carrying each building-scoped tag (closed loop part 2).
    const buildingTags = new Set<string>();
    const businesses = (peers['businesses'] ?? {}) as Record<string, { tags?: string[] }>;
    for (const [key, blueprint] of Object.entries(businesses)) {
        for (const tag of blueprint.tags ?? []) {
            buildingTags.add(tag);
            if (!(tag in vocab)) {
                issues.add(`businesses.${key}`, `unknown placement tag "${tag}"`);
            } else if (vocab[tag]!.scope !== 'building') {
                issues.add(`businesses.${key}`, `tag "${tag}" is deferred (no building may carry it yet)`);
            }
        }
    }
    const residences = (peers['residences'] ?? {}) as Record<string, { tags?: string[] }>;
    for (const [key, residence] of Object.entries(residences)) {
        for (const tag of residence.tags ?? []) {
            buildingTags.add(tag);
            if (!(tag in vocab)) {
                issues.add(`residences.${key}`, `unknown placement tag "${tag}"`);
            } else if (vocab[tag]!.scope !== 'building') {
                issues.add(`residences.${key}`, `tag "${tag}" is deferred (no building may carry it yet)`);
            }
        }
    }
    for (const [tag, spec] of Object.entries(vocab)) {
        if (spec.scope === 'building' && !buildingTags.has(tag)) {
            issues.add(`tags.${tag}`, 'building-scoped tag appears on no blueprint/residence — scope it deferred or attach it (task 069)');
        }
    }
}

export function validateResidencesStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, '', data)) {
        return;
    }
    for (const [key, residence] of Object.entries(data)) {
        if (!checkRecord(issues, key, residence)) {
            continue;
        }
        checkUnknownKeys(issues, key, residence, ['tags']);
        if (checkArray(issues, `${key}.tags`, residence['tags'])) {
            const tags = residence['tags'] as unknown[];
            if (tags.length === 0) {
                issues.add(`${key}.tags`, 'a residence type needs at least one context tag');
            }
            tags.forEach((tag, index) => checkString(issues, `${key}.tags[${index}]`, tag));
        }
    }
}
