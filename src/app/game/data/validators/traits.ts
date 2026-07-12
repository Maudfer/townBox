// Validators for json/traits.json (task 087): the temperament axes' heritability, affinity tag map, prose
// bands, and consent weights — plus the cross-check that every action `affinity` tag maps to a real axis.

import { checkNumber, checkRecord, checkUnknownKeys, checkString } from 'game/data/checks';
import { IssueCollector } from 'game/data/registry';
import { ActionManifest } from 'types/Action';
import { TRAIT_IDS } from 'types/Traits';

export function validateTraitsStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, 'traits', data)) {
        return;
    }
    const config = data as Record<string, unknown>;
    checkUnknownKeys(issues, 'traits', config, ['heritability', 'affinities', 'phrases', 'consent']);

    const heritability = config['heritability'];
    if (typeof heritability !== 'number' || heritability < 0 || heritability > 1) {
        issues.add('traits.heritability', 'expected a fraction in [0, 1]');
    }

    if (checkRecord(issues, 'traits.affinities', config['affinities'])) {
        for (const [tag, mapping] of Object.entries(config['affinities'] as Record<string, unknown>)) {
            if (!checkRecord(issues, `traits.affinities.${tag}`, mapping)) {
                continue;
            }
            const record = mapping as Record<string, unknown>;
            checkUnknownKeys(issues, `traits.affinities.${tag}`, record, ['axis', 'weight']);
            if (typeof record['axis'] !== 'string' || !(TRAIT_IDS as readonly string[]).includes(record['axis'] as string)) {
                issues.add(`traits.affinities.${tag}.axis`, `expected one of [${TRAIT_IDS.join(', ')}]`);
            }
            checkNumber(issues, `traits.affinities.${tag}.weight`, record['weight']);
        }
    }

    if (checkRecord(issues, 'traits.phrases', config['phrases'])) {
        const phrases = config['phrases'] as Record<string, unknown>;
        checkUnknownKeys(issues, 'traits.phrases', phrases, [...TRAIT_IDS]);
        for (const trait of TRAIT_IDS) {
            if (!checkRecord(issues, `traits.phrases.${trait}`, phrases[trait])) {
                continue;
            }
            const record = phrases[trait] as Record<string, unknown>;
            checkUnknownKeys(issues, `traits.phrases.${trait}`, record, ['low', 'high', 'band']);
            checkString(issues, `traits.phrases.${trait}.low`, record['low']);
            checkString(issues, `traits.phrases.${trait}.high`, record['high']);
            checkNumber(issues, `traits.phrases.${trait}.band`, record['band'], { min: 1 });
        }
    }

    if (checkRecord(issues, 'traits.consent', config['consent'])) {
        const consent = config['consent'] as Record<string, unknown>;
        checkUnknownKeys(issues, 'traits.consent', consent, ['sociabilityWeight', 'temperWeight']);
        checkNumber(issues, 'traits.consent.sociabilityWeight', consent['sociabilityWeight']);
        checkNumber(issues, 'traits.consent.temperWeight', consent['temperWeight']);
    }
}

// Every action `affinity` tag must map to a declared axis — an unmapped tag would be silently inert.
export function validateTraitsSemantics(data: unknown, peers: Record<string, unknown>, issues: IssueCollector): void {
    if (!checkRecord(issues, 'traits', data)) {
        return;
    }
    const declared = new Set(Object.keys((data as { affinities?: Record<string, unknown> }).affinities ?? {}));
    const actions = (peers['actions'] ?? {}) as ActionManifest;
    for (const [actionId, def] of Object.entries(actions)) {
        for (const tag of def.affinity ?? []) {
            if (!declared.has(tag)) {
                issues.add(`actions.${actionId}.affinity`, `tag "${tag}" is not declared in traits.json affinities`);
            }
        }
    }
}
