// Generator for docs/simulation-relationships.md (task 054): derives the Action ↔ Event relationship
// tables from the validated JSON manifests so the documentation cannot silently drift from the data.
// Pure string-in/string-out logic — the checked-diff test (test/simulationDocs.test.ts) regenerates the
// artifact and fails CI when the committed file no longer matches the shipped manifests.

import { ActionManifest, ActionDefinition, OARTable } from 'types/Action';
import { EventManifest } from 'types/LifeEvent';

export interface LifecycleLink {
    actionId: string;
    transition: string; // onStart | onComplete | onInterrupt
    eventId: string;
}

export interface ConsequenceEventLink {
    actionId: string;
    op: 'triggerEvent' | 'scheduleEvent';
    eventId: string;
    afterTicks?: number;
}

// --- Extraction ---------------------------------------------------------------------------------------

export function extractLifecycleLinks(actions: ActionManifest): LifecycleLink[] {
    const links: LifecycleLink[] = [];
    for (const [actionId, def] of Object.entries(actions)) {
        for (const [transition, eventId] of Object.entries(def.events ?? {})) {
            if (typeof eventId === 'string') {
                links.push({ actionId, transition, eventId });
            }
        }
    }
    return links;
}

export function extractConsequenceEventLinks(actions: ActionManifest): ConsequenceEventLink[] {
    const links: ConsequenceEventLink[] = [];
    for (const [actionId, def] of Object.entries(actions)) {
        for (const op of def.consequences ?? []) {
            if (op.op === 'triggerEvent') {
                links.push({ actionId, op: 'triggerEvent', eventId: op.event });
            } else if (op.op === 'scheduleEvent') {
                links.push({ actionId, op: 'scheduleEvent', eventId: op.event, afterTicks: op.afterTicks });
            }
        }
    }
    return links;
}

// Trigger kinds declared on an event. NOTE: `manual: {}` is a valid declaration — presence is what
// matters, so this checks keys, never truthiness.
export function triggerKindsOf(event: EventManifest[string]): string[] {
    const triggers = (event.triggers ?? {}) as Record<string, unknown>;
    return ['probabilistic', 'manual', 'automated'].filter(kind => kind in triggers);
}

export function triggerMixCounts(events: EventManifest): Map<string, number> {
    const counts = new Map<string, number>();
    for (const event of Object.values(events)) {
        const mix = triggerKindsOf(event).join(' + ') || '(none)';
        counts.set(mix, (counts.get(mix) ?? 0) + 1);
    }
    return counts;
}

// --- Markdown emission --------------------------------------------------------------------------------

function table(header: string[], rows: string[][]): string {
    const lines = [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`];
    for (const row of rows) {
        lines.push(`| ${row.join(' | ')} |`);
    }
    return lines.join('\n');
}

function code(value: string): string {
    return `\`${value}\``;
}

// Groups actions that declare the exact same lifecycle-link signature (e.g. the continuous work rotation:
// onStart → started_working, onComplete/onInterrupt → stopped_working) into one row.
function lifecycleSignatureRows(actions: ActionManifest): string[][] {
    const bySignature = new Map<string, { signature: [string, string][]; actionIds: string[] }>();
    for (const [actionId, def] of Object.entries(actions)) {
        const entries = Object.entries(def.events ?? {}).filter((pair): pair is [string, string] => typeof pair[1] === 'string');
        if (entries.length === 0) {
            continue;
        }
        const key = JSON.stringify(entries);
        const group = bySignature.get(key) ?? { signature: entries, actionIds: [] };
        group.actionIds.push(actionId);
        bySignature.set(key, group);
    }
    const groups = [...bySignature.values()].sort((a, b) => b.actionIds.length - a.actionIds.length || (a.actionIds[0] ?? '').localeCompare(b.actionIds[0] ?? ''));
    return groups.map(group => [
        group.actionIds.map(code).join(', '),
        group.signature.map(([transition, eventId]) => `${transition} → ${code(eventId)}`).join('<br>'),
    ]);
}

function typeOf(actions: ActionManifest, actionId: string): string {
    return actions[actionId]?.type ?? '?';
}

function describeAutomated(event: EventManifest[string]): string {
    const automated = event.triggers?.automated;
    if (!automated) {
        return '';
    }
    return (automated.rules ?? []).map(rule => {
        if ('afterEvent' in rule) {
            return `afterEvent ${code(rule.afterEvent)} +${rule.delayTicks} ticks`;
        }
        return `atHour ${(rule as { atHour: number }).atHour}`;
    }).join('; ');
}

function describeLimit(event: EventManifest[string]): string {
    const limit = event.limit as { once?: string; withinTicks?: number } | undefined;
    if (!limit) {
        return '—';
    }
    if (limit.once !== undefined) {
        return `once: ${limit.once}`;
    }
    return `cooldown ${limit.withinTicks} ticks`;
}

function oarInputCell(entry: OARTable[string]): string {
    if (entry.inputs.length === 0) {
        return '—';
    }
    return entry.inputs.map(input => {
        const qty = input.quantity ?? 1;
        const state = input.state ? `{${Object.entries(input.state).map(([k, v]) => `${k}: ${v}`).join(', ')}}` : '';
        const transform = input.disposition === 'transformed' && input.transformTo ? ` → ${code(input.transformTo.archetype)}` : '';
        return `${qty}× ${code(input.archetype)}${state} (${input.disposition})${transform}`;
    }).join('<br>');
}

function oarOutputCell(entry: OARTable[string]): string {
    if (entry.outputs.length === 0) {
        return '—';
    }
    return entry.outputs.map(output => {
        const qty = output.quantity ?? 1;
        const owner = output.owner && output.owner !== 'person' ? `, owner: ${output.owner}` : '';
        return `${qty}× ${code(output.archetype)}${owner}`;
    }).join('<br>');
}

export function generateRelationshipDocs(actions: ActionManifest, events: EventManifest, oar: OARTable): string {
    const lifecycle = extractLifecycleLinks(actions);
    const consequenceLinks = extractConsequenceEventLinks(actions);
    const mixes = triggerMixCounts(events);

    const sections: string[] = [];
    sections.push('# Simulation relationships (generated)');
    sections.push([
        '> **GENERATED — do not edit by hand.** Derived from `src/json/actions.json`, `src/json/events.json`',
        '> and `src/json/object-action-relationships.json` by `util/simulationDocs.ts`. The checked-diff test',
        '> (`test/simulationDocs.test.ts`) fails when this file no longer matches the shipped data; regenerate',
        '> with `npm run docs:sim`. The narrative companion is [simulation-flows.md](simulation-flows.md).',
    ].join('\n'));

    // --- Overview counts ---
    const actionCount = Object.keys(actions).length;
    const eventCount = Object.keys(events).length;
    const continuous = Object.values(actions).filter(def => def.type === 'continuous').length;
    sections.push('## Scale\n\n' + table(
        ['Manifest', 'Entries', 'Notes'],
        [
            ['`actions.json`', String(actionCount), `${continuous} continuous / ${actionCount - continuous} discrete`],
            ['`events.json`', String(eventCount), `${[...mixes.entries()].map(([mix, n]) => `${n} ${mix}`).join(', ')}`],
            ['`object-action-relationships.json`', String(Object.keys(oar).length), 'first-satisfiable entry per action commit'],
        ],
    ));

    // --- Action -> Event ---
    sections.push('## Action → Event (lifecycle links)\n\n'
        + 'Lifecycle transitions fire the declared manual Events through `EventEngine.invoke` '
        + '(`triggerSource: \'action\'`, causation = the lifecycle log entry). Actions sharing one signature are grouped.\n\n'
        + table(['Actions', 'Lifecycle → Event'], lifecycleSignatureRows(actions)));

    // --- Consequence-op links ---
    const consequenceRows = consequenceLinks.map(link => [
        code(link.actionId),
        link.op === 'scheduleEvent' ? `scheduleEvent (+${link.afterTicks} ticks)` : 'triggerEvent',
        code(link.eventId),
    ]);
    sections.push('## Action → Event (consequence ops)\n\n'
        + (consequenceRows.length > 0
            ? table(['Action', 'Op', 'Event'], consequenceRows)
            : '*No shipped action currently uses `triggerEvent`/`scheduleEvent` consequence ops (the DSL supports both; engine tests cover them).*'));

    // --- Event <- sources reverse map ---
    const sourcesByEvent = new Map<string, string[]>();
    for (const link of lifecycle) {
        const list = sourcesByEvent.get(link.eventId) ?? [];
        list.push(`${code(link.actionId)}.${link.transition} (${typeOf(actions, link.actionId)})`);
        sourcesByEvent.set(link.eventId, list);
    }
    for (const link of consequenceLinks) {
        const list = sourcesByEvent.get(link.eventId) ?? [];
        list.push(`${code(link.actionId)} ${link.op}`);
        sourcesByEvent.set(link.eventId, list);
    }
    const reverseRows = [...sourcesByEvent.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([eventId, sources]) => {
        const event = events[eventId];
        return [
            code(eventId),
            event ? triggerKindsOf(event).join(' + ') : '⚠ unknown event',
            event ? describeLimit(event) : '—',
            sources.length > 6 ? `${sources.slice(0, 3).join('<br>')}<br>… ${sources.length - 3} more` : sources.join('<br>'),
        ];
    });
    const manualEvents = Object.entries(events).filter(([, event]) => triggerKindsOf(event).includes('manual'));
    const unsourced = manualEvents.filter(([eventId]) => !sourcesByEvent.has(eventId));
    sections.push('## Event ← sources (reverse map)\n\n'
        + 'Every event referenced by an action, with its trigger mix and limit. All manual invocation today is '
        + 'data-driven — the only `EventEngine.invoke` call sites are the action lifecycle (`ActionEngine.fireEvent`) '
        + 'and the consequence executor (`Consequences`).\n\n'
        + table(['Event', 'Triggers', 'Limit', 'Invoked by'], reverseRows)
        + `\n\nOf the ${manualEvents.length} manual-triggered events, ${unsourced.length} have no action source yet — `
        + 'they are invokable texture (052) reserved for future action links and system callers; the rest of their '
        + 'trigger mix (probabilistic rolls) still runs them.');

    // --- Automated schedule rules ---
    const automatedRows = Object.entries(events)
        .filter(([, event]) => triggerKindsOf(event).includes('automated'))
        .map(([eventId, event]) => [code(eventId), describeAutomated(event), describeLimit(event)]);
    sections.push('## Automated schedule rules\n\n'
        + (automatedRows.length > 0
            ? table(['Event', 'Rules', 'Limit'], automatedRows)
            : '*None.*'));

    // --- Trigger/limit breakdown ---
    const limitCounts = new Map<string, number>();
    for (const event of Object.values(events)) {
        limitCounts.set(describeLimit(event).startsWith('cooldown') ? 'cooldown window' : describeLimit(event), (limitCounts.get(describeLimit(event).startsWith('cooldown') ? 'cooldown window' : describeLimit(event)) ?? 0) + 1);
    }
    sections.push('## Trigger & limit breakdown\n\n'
        + table(['Trigger mix', 'Events'], [...mixes.entries()].sort((a, b) => b[1] - a[1]).map(([mix, n]) => [mix, String(n)]))
        + '\n\n'
        + table(['Occurrence limit', 'Events'], [...limitCounts.entries()].sort((a, b) => b[1] - a[1]).map(([kind, n]) => [kind, String(n)])));

    // --- OAR table ---
    const oarRows = Object.entries(oar).map(([entryId, entry]) => [
        code(entryId),
        code(entry.action),
        oarInputCell(entry),
        oarOutputCell(entry),
        entry.context?.objectAtLocation ? `at location: ${code(JSON.stringify(entry.context.objectAtLocation))}` : '—',
    ]);
    sections.push('## Object-action transformations\n\n'
        + 'At commit, the FIRST satisfiable entry (declaration order) for the action applies; inputs match the '
        + 'person\'s carried instances. `required` inputs must be present but survive; `transformed` inputs '
        + 'preserve instance identity.\n\n'
        + table(['Entry', 'Action', 'Inputs', 'Outputs', 'Context'], oarRows));

    return sections.join('\n\n') + '\n';
}

// Convenience for tests/regeneration against the shipped manifests.
export function isContinuous(def: ActionDefinition): boolean {
    return def.type === 'continuous';
}
