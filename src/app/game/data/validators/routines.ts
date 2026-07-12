// Validators for json/routines.json (task 085): the planner's habit templates. Structure = shape/windows/
// adoption bounds; semantics = every routine's action must exist in the action manifest (a routine planning
// a ghost action would enqueue permanently-failing intents).

import { checkNumber, checkRecord, checkUnknownKeys, checkString } from 'game/data/checks';
import { IssueCollector } from 'game/data/registry';
import { validatePredicate } from 'game/data/substrate';
import { ActionManifest } from 'types/Action';

export function validateRoutinesStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, 'routines', data)) {
        return;
    }
    for (const [id, routine] of Object.entries(data)) {
        if (!checkRecord(issues, id, routine)) {
            continue;
        }
        const record = routine as Record<string, unknown>;
        checkUnknownKeys(issues, id, record, ['action', 'cadenceDays', 'window', 'adoption', 'requires']);
        checkString(issues, `${id}.action`, record['action']);
        checkNumber(issues, `${id}.cadenceDays`, record['cadenceDays'], { min: 1 });
        const window = record['window'];
        if (!Array.isArray(window) || window.length !== 2
            || typeof window[0] !== 'number' || typeof window[1] !== 'number'
            || window[0] < 0 || window[1] > 23 || window[0] > window[1]) {
            issues.add(`${id}.window`, 'expected [startHour, endHour] with 0 ≤ start ≤ end ≤ 23');
        }
        const adoption = record['adoption'];
        if (typeof adoption !== 'number' || adoption <= 0 || adoption > 1) {
            issues.add(`${id}.adoption`, 'expected a fraction in (0, 1]');
        }
        if ('requires' in record) {
            validatePredicate(issues, `${id}.requires`, record['requires']);
        }
    }
}

export function validateRoutinesSemantics(data: unknown, peers: Record<string, unknown>, issues: IssueCollector): void {
    if (!checkRecord(issues, 'routines', data)) {
        return;
    }
    const actions = (peers['actions'] ?? {}) as ActionManifest;
    for (const [id, routine] of Object.entries(data as Record<string, { action?: string }>)) {
        if (routine.action !== undefined && !actions[routine.action]) {
            issues.add(`${id}.action`, `references unknown action "${routine.action}"`);
        }
    }
}
