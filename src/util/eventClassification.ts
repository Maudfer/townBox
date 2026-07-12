// The event-classification generator (task 068): derives, from the shipped manifests, what every event in
// events.json IS — the sweep's reviewable artifact. Regenerate docs/generated/event-classification.md with
// `npm run docs:events`; a checked-diff test fails when the manifests change without regenerating.
//
// Dispositions (mutually exclusive, in precedence order):
//  - vital     — carries real effects: the simulation state changes when it commits.
//  - wired     — effect-free but INVOKED by a real caller: an action lifecycle link, an automated rule, or a
//                named system caller (enrollment sweeps, promotion evaluation, …).
//  - texture   — effect-free, probabilistic-only narrative flavor (052's story layer). Kept deliberately:
//                the person log's richness IS the product; generalizing away rate-tuned flavor for purity
//                would be a loss (068 decision).
//  - reserved  — manual-only and invoked by NOTHING yet: a capability placeholder awaiting a caller
//                (072/074 social wiring is the main consumer). Documented here so none of them is silent
//                dead data; retire or wire deliberately, never by accident.

import { ActionManifest, EventLink } from 'types/Action';
import { EventManifest } from 'types/LifeEvent';

export type EventDisposition = 'vital' | 'wired' | 'texture' | 'reserved';

// Events invoked directly by engine/system code (kept in sync by the classification test).
export const SYSTEM_INVOKED_EVENTS: Record<string, string> = {
    started_school: 'City.runSchoolSweeps (enrollment, task 058)',
    graduated_school: 'City.runSchoolSweeps (age-out, task 058)',
    got_promoted: 'SkillProgression promotion evaluation (task 065)',
    // Computable life milestones wired to the transitions the sim already performs (task 076/M4).
    was_born: 'City.handleTick (birth, task 076)',
    gave_birth: 'City.handleTick (birth, task 076)',
    became_parent: 'City.handleTick (birth, task 076)',
    became_widowed: 'City.handleTick (death → surviving spouse, task 076)',
    lost_parent: 'City.handleTick (death → children, task 076)',
    lost_child: 'City.handleTick (death → parents, task 076)',
    taken_in_by_relatives: 'City.displaceHousehold (eviction rehousing, task 076)',
    became_homeless: 'City.displaceHousehold (eviction, task 076)',
    got_back_on_feet: 'City.runRecovery (homeless recovery, task 076)',
    left_home_first_time: 'City.resolveMoveOut (move-out, task 076)',
};

function linkEvent(link: EventLink | undefined): string | null {
    if (!link) {
        return null;
    }
    return typeof link === 'string' ? link : link.event;
}

export function actionInvokers(actions: ActionManifest): Map<string, string[]> {
    const invokers = new Map<string, string[]>();
    for (const [actionId, def] of Object.entries(actions)) {
        for (const hook of ['onStart', 'onComplete', 'onInterrupt', 'onDecline', 'onCompleteTarget', 'onDeclineTarget'] as const) {
            const eventId = linkEvent(def.events?.[hook]);
            if (eventId) {
                const list = invokers.get(eventId) ?? [];
                list.push(`${actionId}.${hook}`);
                invokers.set(eventId, list);
            }
        }
    }
    return invokers;
}

export function classifyEvent(
    eventId: string,
    events: EventManifest,
    invokers: Map<string, string[]>
): { disposition: EventDisposition; invokedBy: string[] } {
    const event = events[eventId]!;
    const invokedBy = [
        ...(invokers.get(eventId) ?? []),
        ...(SYSTEM_INVOKED_EVENTS[eventId] ? [SYSTEM_INVOKED_EVENTS[eventId]!] : []),
    ];
    // Automated rules count as callers (the schedule invokes them).
    const automated = (event.triggers?.automated?.rules ?? []).length > 0;
    if ((event.effects ?? []).length > 0) {
        return { disposition: 'vital', invokedBy };
    }
    if (invokedBy.length > 0 || automated) {
        return { disposition: 'wired', invokedBy: automated ? [...invokedBy, 'automated schedule'] : invokedBy };
    }
    if (event.triggers?.probabilistic) {
        return { disposition: 'texture', invokedBy };
    }
    return { disposition: 'reserved', invokedBy };
}

export function generateEventClassification(events: EventManifest, actions: ActionManifest): string {
    const invokers = actionInvokers(actions);
    const rows: { id: string; category: string; triggers: string; disposition: EventDisposition; invokedBy: string }[] = [];
    for (const eventId of Object.keys(events).sort()) {
        const event = events[eventId]!;
        const kinds = [
            event.triggers?.probabilistic ? 'probabilistic' : null,
            event.triggers?.manual ? 'manual' : null,
            (event.triggers?.automated?.rules ?? []).length > 0 ? 'automated' : null,
        ].filter((kind): kind is string => kind !== null);
        const { disposition, invokedBy } = classifyEvent(eventId, events, invokers);
        rows.push({
            id: eventId,
            category: event.category ?? '—',
            triggers: kinds.join('+'),
            disposition,
            invokedBy: invokedBy.join(', ') || '—',
        });
    }
    const counts = rows.reduce<Record<string, number>>((acc, row) => {
        acc[row.disposition] = (acc[row.disposition] ?? 0) + 1;
        return acc;
    }, {});

    const lines: string[] = [];
    lines.push('# Event classification (task 068)');
    lines.push('');
    lines.push('**GENERATED — do not edit.** Regenerate with `npm run docs:events` whenever `events.json` or');
    lines.push("`actions.json` change (a checked-diff test enforces this). See `util/eventClassification.ts`");
    lines.push('for what each disposition means and why texture/reserved events are kept.');
    lines.push('');
    lines.push(`Totals: ${rows.length} events — ` + (['vital', 'wired', 'texture', 'reserved'] as const)
        .map(kind => `**${counts[kind] ?? 0} ${kind}**`).join(', ') + '.');
    lines.push('');
    lines.push('| Event | Category | Triggers | Disposition | Invoked by |');
    lines.push('|---|---|---|---|---|');
    for (const row of rows) {
        lines.push(`| ${row.id} | ${row.category} | ${row.triggers} | ${row.disposition} | ${row.invokedBy} |`);
    }
    lines.push('');
    return lines.join('\n');
}
