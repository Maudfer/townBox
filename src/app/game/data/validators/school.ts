// Validators for json/schools.json (task 058): the school-day schedule + enrollment parameters. The
// semantic pass pins the cross-file contracts — the attend_school action must exist with a completeWhen
// that closes the day at exactly dayEndMinutes, and the school-day lifecycle events must exist with the
// right triggers/limits — so the schedule and the action manifest can never drift apart silently.

import { IssueCollector } from 'game/data/registry';
import { checkArray, checkEnum, checkNumber, checkRecord, checkUnknownKeys, isRecord } from 'game/data/checks';
import { validateCurve } from 'game/data/substrate';
import { WEEKDAY_NAMES, MINUTES_PER_DAY, isWeekendDay } from 'util/time';

const SCHOOL_KEYS = ['dayStartMinutes', 'dayEndMinutes', 'daysOfWeek', 'minAgeYears', 'maxAgeYears', 'capacity'];

export const ATTEND_SCHOOL_ID = 'attend_school';
export const SCHOOL_DAY_STARTED_EVENT = 'school_day_started';
export const COMPLETED_SCHOOL_DAY_EVENT = 'completed_school_day';

export function validateSchoolsStructure(data: unknown, issues: IssueCollector): void {
    if (!checkRecord(issues, '', data)) {
        return;
    }
    checkUnknownKeys(issues, '', data, SCHOOL_KEYS);

    const start = data['dayStartMinutes'];
    const end = data['dayEndMinutes'];
    const startOk = checkNumber(issues, 'dayStartMinutes', start, { min: 0, max: MINUTES_PER_DAY - 1, integer: true });
    const endOk = checkNumber(issues, 'dayEndMinutes', end, { min: 1, max: MINUTES_PER_DAY - 1, integer: true });
    if (startOk && endOk) {
        if ((end as number) <= (start as number)) {
            issues.add('dayEndMinutes', 'the school day must end after it starts (no cross-midnight school)');
        }
        if ((end as number) % 60 !== 0) {
            // The attend_school completeWhen closes the day on an hour boundary (hourOfDay >= end/60);
            // a non-hour-aligned end would silently complete early.
            issues.add('dayEndMinutes', 'must fall on an hour boundary (a multiple of 60)');
        }
    }

    if (checkArray(issues, 'daysOfWeek', data['daysOfWeek'])) {
        const days = data['daysOfWeek'] as unknown[];
        if (days.length === 0) {
            issues.add('daysOfWeek', 'must not be empty');
        }
        const seen = new Set<string>();
        days.forEach((day, index) => {
            if (!checkEnum(issues, `daysOfWeek[${index}]`, day, WEEKDAY_NAMES)) {
                return;
            }
            if (seen.has(day)) {
                issues.add(`daysOfWeek[${index}]`, `duplicate day '${day}'`);
            }
            seen.add(day);
            // Weekends gate school (task 057/058): the v1 contract is weekday-only school.
            if (isWeekendDay(WEEKDAY_NAMES.indexOf(day as typeof WEEKDAY_NAMES[number]))) {
                issues.add(`daysOfWeek[${index}]`, `school does not run on weekend days ('${day}')`);
            }
        });
    }

    const minOk = checkNumber(issues, 'minAgeYears', data['minAgeYears'], { min: 1, integer: true });
    const maxOk = checkNumber(issues, 'maxAgeYears', data['maxAgeYears'], { min: 1, integer: true });
    if (minOk && maxOk && (data['maxAgeYears'] as number) < (data['minAgeYears'] as number)) {
        issues.add('maxAgeYears', 'must be >= minAgeYears');
    }

    validateCurve(issues, 'capacity', data['capacity']);
}

export function validateSchoolsSemantics(data: unknown, peers: Record<string, unknown>, issues: IssueCollector): void {
    if (!isRecord(data)) {
        return;
    }
    const actions = peers['actions'];
    const events = peers['events'];

    // The attend_school action: exists, continuous obligation, and its completeWhen closes the day at
    // exactly the configured end hour.
    if (isRecord(actions)) {
        const attend = actions[ATTEND_SCHOOL_ID];
        if (!isRecord(attend)) {
            issues.add(ATTEND_SCHOOL_ID, `actions.json must declare the '${ATTEND_SCHOOL_ID}' action`);
        } else {
            if (attend['type'] !== 'continuous' || attend['category'] !== 'obligation') {
                issues.add(ATTEND_SCHOOL_ID, `must be a continuous 'obligation' action`);
            }
            const endMinutes = data['dayEndMinutes'];
            const completeWhen = attend['completeWhen'];
            const expectedHour = typeof endMinutes === 'number' ? Math.floor(endMinutes / 60) : null;
            const matches = isRecord(completeWhen)
                && completeWhen['attr'] === 'hourOfDay'
                && completeWhen['op'] === '>='
                && completeWhen['value'] === expectedHour;
            if (expectedHour !== null && !matches) {
                issues.add(`${ATTEND_SCHOOL_ID}.completeWhen`, `must be { attr: 'hourOfDay', op: '>=', value: ${expectedHour} } to match dayEndMinutes (${String(endMinutes)})`);
            }
        }
    }

    // The school-day lifecycle events: both exist, manual-triggered, once-per-day; the completion event
    // carries the automated fallback chained to the start event (the stopped_working pattern, 042/048).
    if (isRecord(events)) {
        for (const eventId of [SCHOOL_DAY_STARTED_EVENT, COMPLETED_SCHOOL_DAY_EVENT]) {
            const event = events[eventId];
            if (!isRecord(event)) {
                issues.add(eventId, `events.json must declare the '${eventId}' event`);
                continue;
            }
            const triggers = event['triggers'];
            if (!isRecord(triggers) || !('manual' in triggers)) {
                issues.add(`${eventId}.triggers`, 'must declare a manual trigger (fired by the attend_school lifecycle)');
            }
            const limit = event['limit'];
            if (!isRecord(limit) || limit['once'] !== 'perDay') {
                issues.add(`${eventId}.limit`, `must be { once: 'perDay' } (one school-day credit per calendar day, task 063)`);
            }
            if (eventId === COMPLETED_SCHOOL_DAY_EVENT && isRecord(triggers)) {
                const automated = triggers['automated'];
                const rules = isRecord(automated) && Array.isArray(automated['rules']) ? automated['rules'] as unknown[] : [];
                const hasFallback = rules.some(rule => isRecord(rule) && rule['afterEvent'] === SCHOOL_DAY_STARTED_EVENT);
                if (!hasFallback) {
                    issues.add(`${eventId}.triggers.automated`, `must carry an afterEvent '${SCHOOL_DAY_STARTED_EVENT}' fallback rule so unresolved school days still close`);
                }
            }
        }
    }
}
