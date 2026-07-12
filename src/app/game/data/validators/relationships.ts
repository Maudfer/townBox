// Validators for json/relationships.json (task 083): the elective social graph's decay/ladder/consent/
// targeting policy. Structure = shape + closed vocabularies; semantics = the ladder's authored transition
// events must exist in the event manifest and be manually invokable (the consequence path fires them).

import { checkNumber, checkRecord, checkUnknownKeys } from 'game/data/checks';
import { IssueCollector } from 'game/data/registry';
import { EventManifest } from 'types/LifeEvent';

const EDGE_KINDS = ['acquaintance', 'friend', 'close_friend', 'rival', 'dating', 'engaged', 'ex_partner'];
const STANDINGS = [...EDGE_KINDS, 'spouse', 'family', 'none'];

export function validateRelationshipsStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, 'relationships', data)) {
        return;
    }
    const config = data as Record<string, unknown>;
    checkUnknownKeys(issues, 'relationships', config, ['halfLifeDays', 'ladder', 'hostility', 'reconciliation', 'consent', 'socialTargeting', 'pruneBelow']);

    if (checkRecord(issues, 'halfLifeDays', config['halfLifeDays'])) {
        const halfLives = config['halfLifeDays'] as Record<string, unknown>;
        for (const kind of EDGE_KINDS) {
            checkNumber(issues, `halfLifeDays.${kind}`, halfLives[kind], { min: 1 });
        }
        checkUnknownKeys(issues, 'halfLifeDays', halfLives, EDGE_KINDS);
    }

    if (Array.isArray(config['ladder'])) {
        (config['ladder'] as unknown[]).forEach((rung, index) => {
            const path = `ladder[${index}]`;
            if (!checkRecord(issues, path, rung)) {
                return;
            }
            const r = rung as Record<string, unknown>;
            checkUnknownKeys(issues, path, r, ['kind', 'promoteAt', 'next', 'onPromote', 'demoteBelow', 'downTo']);
            if (typeof r['kind'] !== 'string' || !EDGE_KINDS.includes(r['kind'])) {
                issues.add(`${path}.kind`, `expected one of [${EDGE_KINDS.join(', ')}]`);
            }
            if ('promoteAt' in r) {
                checkNumber(issues, `${path}.promoteAt`, r['promoteAt'], { min: 1 });
                if (typeof r['next'] !== 'string' || !EDGE_KINDS.includes(r['next'] as string)) {
                    issues.add(`${path}.next`, 'promoteAt requires a valid next kind');
                }
            }
            if ('demoteBelow' in r) {
                checkNumber(issues, `${path}.demoteBelow`, r['demoteBelow'], { min: 0 });
                if (typeof r['downTo'] !== 'string' || !EDGE_KINDS.includes(r['downTo'] as string)) {
                    issues.add(`${path}.downTo`, 'demoteBelow requires a valid downTo kind');
                }
            }
        });
    } else {
        issues.add('ladder', 'expected an array of rungs');
    }

    for (const flip of ['hostility', 'reconciliation'] as const) {
        if (checkRecord(issues, flip, config[flip])) {
            const record = config[flip] as Record<string, unknown>;
            checkUnknownKeys(issues, flip, record, ['to', 'strength']);
            if (typeof record['to'] !== 'string' || !EDGE_KINDS.includes(record['to'] as string)) {
                issues.add(`${flip}.to`, `expected one of [${EDGE_KINDS.join(', ')}]`);
            }
            checkNumber(issues, `${flip}.strength`, record['strength'], { min: 1 });
        }
    }

    if (checkRecord(issues, 'consent', config['consent'])) {
        const consent = config['consent'] as Record<string, unknown>;
        checkUnknownKeys(issues, 'consent', consent, ['base', 'strengthWeight']);
        if (checkRecord(issues, 'consent.base', consent['base'])) {
            const base = consent['base'] as Record<string, unknown>;
            for (const standing of STANDINGS) {
                const value = base[standing];
                if (typeof value !== 'number' || value < 0 || value > 1) {
                    issues.add(`consent.base.${standing}`, 'every standing needs a base accept probability in [0, 1]');
                }
            }
            checkUnknownKeys(issues, 'consent.base', base, STANDINGS);
        }
        checkNumber(issues, 'consent.strengthWeight', consent['strengthWeight'], { min: 0 });
    }

    if (checkRecord(issues, 'socialTargeting', config['socialTargeting'])) {
        const targeting = config['socialTargeting'] as Record<string, unknown>;
        checkUnknownKeys(issues, 'socialTargeting', targeting, ['kindWeight', 'strengthWeight']);
        if (checkRecord(issues, 'socialTargeting.kindWeight', targeting['kindWeight'])) {
            const weights = targeting['kindWeight'] as Record<string, unknown>;
            for (const standing of STANDINGS) {
                checkNumber(issues, `socialTargeting.kindWeight.${standing}`, weights[standing], { min: 0 });
            }
            checkUnknownKeys(issues, 'socialTargeting.kindWeight', weights, STANDINGS);
        }
        checkNumber(issues, 'socialTargeting.strengthWeight', targeting['strengthWeight'], { min: 0 });
    }

    checkNumber(issues, 'pruneBelow', config['pruneBelow'], { min: 0 });
}

export function validateRelationshipsSemantics(data: unknown, peers: Record<string, unknown>, issues: IssueCollector): void {
    if (!checkRecord(issues, 'relationships', data)) {
        return;
    }
    const config = data as { ladder?: { onPromote?: string }[] };
    const events = (peers['events'] ?? {}) as EventManifest;
    (config.ladder ?? []).forEach((rung, index) => {
        if (!rung.onPromote) {
            return;
        }
        const event = events[rung.onPromote];
        if (!event) {
            issues.add(`ladder[${index}].onPromote`, `references unknown event "${rung.onPromote}"`);
        } else if (!event.triggers?.manual) {
            issues.add(`ladder[${index}].onPromote`, `event "${rung.onPromote}" declares no manual trigger (transitions fire through EventEngine.invoke)`);
        }
    });
}
