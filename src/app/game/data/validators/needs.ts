// Validators for json/needs.json (task 084): the closed need set's decay/critical/urgency policy, plus the
// consumption rule (076 tradition): every need must be satisfiable by a healthy number of actions, so no
// meter can strand a person with nothing to do about it.

import { checkNumber, checkRecord, checkUnknownKeys } from 'game/data/checks';
import { IssueCollector } from 'game/data/registry';
import { validateCurve } from 'game/data/substrate';
import { ActionManifest } from 'types/Action';
import { NEED_IDS } from 'types/Needs';

const MIN_SATISFIERS = 3;

export function validateNeedsStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, 'needs', data)) {
        return;
    }
    const config = data as Record<string, unknown>;
    checkUnknownKeys(issues, 'needs', config, ['needs', 'urgencyCurve', 'initMin', 'initMax']);

    if (checkRecord(issues, 'needs.needs', config['needs'])) {
        const needs = config['needs'] as Record<string, unknown>;
        checkUnknownKeys(issues, 'needs.needs', needs, [...NEED_IDS]);
        for (const need of NEED_IDS) {
            if (!checkRecord(issues, `needs.${need}`, needs[need])) {
                continue;
            }
            const record = needs[need] as Record<string, unknown>;
            checkUnknownKeys(issues, `needs.${need}`, record, ['decayPerDay', 'critical']);
            checkNumber(issues, `needs.${need}.decayPerDay`, record['decayPerDay'], { min: 0 });
            checkNumber(issues, `needs.${need}.critical`, record['critical'], { min: 0 });
        }
    }
    validateCurve(issues, 'needs.urgencyCurve', config['urgencyCurve']);
    checkNumber(issues, 'needs.initMin', config['initMin'], { min: 0 });
    checkNumber(issues, 'needs.initMax', config['initMax'], { min: 1 });
    if (typeof config['initMin'] === 'number' && typeof config['initMax'] === 'number' && config['initMin'] > config['initMax']) {
        issues.add('needs.initMin', 'initMin must not exceed initMax');
    }
}

export function validateNeedsSemantics(_data: unknown, peers: Record<string, unknown>, issues: IssueCollector): void {
    const actions = (peers['actions'] ?? {}) as ActionManifest;
    const satisfierCounts = new Map<string, number>();
    for (const def of Object.values(actions)) {
        for (const [need, amount] of Object.entries(def.satisfies ?? {})) {
            if ((amount ?? 0) >= 5) {
                satisfierCounts.set(need, (satisfierCounts.get(need) ?? 0) + 1);
            }
        }
    }
    for (const need of NEED_IDS) {
        const count = satisfierCounts.get(need) ?? 0;
        if (count < MIN_SATISFIERS) {
            issues.add(`needs.${need}`, `only ${count} actions meaningfully satisfy "${need}" (< ${MIN_SATISFIERS}) — a starved meter with nothing to do about it`);
        }
    }
}
