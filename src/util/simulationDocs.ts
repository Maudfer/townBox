// Generator for docs/generated/simulation-relationships.md (task 054): derives the Action ↔ Event relationship
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

// The arc manifests (task 075): optional inputs extending the generated artifact to the progression &
// context data — skills DAG, job rank ladders, placement tags, interaction contracts. Loosely typed on
// purpose: the generator summarizes; the validators own the schemas.
export interface ArcManifests {
    skills: Record<string, { basic?: boolean; dependsOn?: { skill: string }[] }>;
    jobs: Record<string, { title: string; ranks?: { rankId: string; label: string; entry?: boolean; requires?: { skill: string; minProficiency: number }[]; progresses?: { skill: string; multiplier: number }[]; promotion?: { evaluateEveryWorkDays?: number }; entryTrainingGrant?: { grants: unknown[] } }[] }>;
    placement: Record<string, { scope: string }>;
    businesses: Record<string, { tags?: string[] }>;
    residences: Record<string, { tags?: string[] }>;
    objects: Record<string, { placement?: string[] }>;
}

function interactionContractRows(actions: ActionManifest): string[][] {
    return Object.entries(actions)
        .filter(([, def]) => def.interaction)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([actionId, def]) => {
            const contract = def.interaction!;
            const declineLink = def.events?.onDecline;
            const declineEvent = declineLink === undefined ? '—' : code(typeof declineLink === 'string' ? declineLink : declineLink.event);
            const selection = def.selection;
            return [
                code(actionId),
                contract.askFirst ? 'ask first' : 'no consent',
                contract.onDecline ?? '—',
                declineEvent,
                selection ? `w ${selection.weight}${selection.cooldownTicks !== undefined ? `, cd ${selection.cooldownTicks}` : ''}` : '—',
            ];
        });
}

function jobRankRows(jobs: ArcManifests['jobs']): string[][] {
    return Object.entries(jobs)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([jobKey, job]) => {
            const ranks = job.ranks ?? [];
            const entry = ranks.find(rank => rank.entry);
            const ladder = ranks.map(rank => rank.label).join(' → ');
            const cadence = entry?.promotion?.evaluateEveryWorkDays;
            return [
                code(jobKey),
                ladder || '—',
                entry?.entryTrainingGrant ? `${entry.entryTrainingGrant.grants.length} skills` : '—',
                cadence !== undefined ? `every ${cadence} work days` : '—',
            ];
        });
}

function skillsSummaryRows(skills: ArcManifests['skills']): { rows: string[][]; basics: number; specifics: number } {
    const ids = Object.keys(skills);
    const basics = ids.filter(id => skills[id]!.basic);
    const dependents = new Map<string, number>();
    for (const definition of Object.values(skills)) {
        for (const dep of definition.dependsOn ?? []) {
            dependents.set(dep.skill, (dependents.get(dep.skill) ?? 0) + 1);
        }
    }
    const rows = basics.sort().map(basic => [code(basic), String(dependents.get(basic) ?? 0)]);
    return { rows, basics: basics.length, specifics: ids.length - basics.length };
}

function placementTagRows(extras: ArcManifests): string[][] {
    const archetypeCounts = new Map<string, number>();
    for (const archetype of Object.values(extras.objects)) {
        for (const tag of archetype.placement ?? []) {
            archetypeCounts.set(tag, (archetypeCounts.get(tag) ?? 0) + 1);
        }
    }
    const buildingCounts = new Map<string, number>();
    const countBuilding = (tags: string[] | undefined): void => {
        for (const tag of tags ?? []) {
            buildingCounts.set(tag, (buildingCounts.get(tag) ?? 0) + 1);
        }
    };
    Object.values(extras.businesses).forEach(blueprint => countBuilding(blueprint.tags));
    Object.values(extras.residences).forEach(residence => countBuilding(residence.tags));
    return Object.entries(extras.placement)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([tag, spec]) => [
            code(tag),
            spec.scope,
            String(archetypeCounts.get(tag) ?? 0),
            String(buildingCounts.get(tag) ?? 0),
        ]);
}

export function generateRelationshipDocs(actions: ActionManifest, events: EventManifest, oar: OARTable, extras?: ArcManifests): string {
    const lifecycle = extractLifecycleLinks(actions);
    const consequenceLinks = extractConsequenceEventLinks(actions);
    const mixes = triggerMixCounts(events);

    const sections: string[] = [];
    sections.push('# Simulation relationships (generated)');
    sections.push([
        '> **GENERATED — do not edit by hand.** Derived from `src/json/actions.json`, `src/json/events.json`',
        '> and `src/json/object-action-relationships.json` by `util/simulationDocs.ts`. The checked-diff test',
        '> (`test/util/simulationDocs.test.ts`) fails when this file no longer matches the shipped data; regenerate',
        '> with `npm run docs:sim`. The narrative companion is the "Simulation flows" section of [CLAUDE.md](../../CLAUDE.md) §4.13.',
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

    // --- The progression & context arc manifests (task 075) ---
    if (extras) {
        sections.push('## Interaction contracts (person-targeted actions)\n\n'
            + 'Every action with a `person` parameter carries a contract (072); `askFirst` routes consent through '
            + 'the target (073); decline events are curated, not universal (074). All require same-building '
            + 'co-location this iteration.\n\n'
            + table(['Action', 'Consent', 'onDecline', 'Decline event', 'Selection'], interactionContractRows(actions)));

        const skillSummary = skillsSummaryRows(extras.skills);
        sections.push('## Skills (dependency DAG summary)\n\n'
            + `${skillSummary.basics + skillSummary.specifics} skills — ${skillSummary.basics} basics, `
            + `${skillSummary.specifics} specific abilities gated by the dependency DAG (059–062). School lands `
            + 'every basic at 60 by 18 (perfect attendance); the band above 60 is career/talent territory.\n\n'
            + table(['Basic skill', 'Direct dependents'], skillSummary.rows));

        sections.push('## Job rank ladders\n\n'
            + 'Every job carries a full authored ladder (064/066) with an explicit entry-rank training grant (the '
            + 'temporary College shortcut, applied atomically ONLY inside a successful hire) and a deterministic '
            + 'promotion cadence; the self-climbing rule (CI-enforced) guarantees no ladder silently stalls.\n\n'
            + table(['Job', 'Ladder', 'Entry grant', 'Promotion cadence'], jobRankRows(extras.jobs)));

        sections.push('## Placement tags (context vocabulary)\n\n'
            + 'The controlled vocabulary (069): tags mean "this environmental context exists here" — rooms are '
            + 'never simulated. `building`-scoped tags drive object generation (070); `deferred` tags await the '
            + 'venue model.\n\n'
            + table(['Tag', 'Scope', 'Archetypes', 'Buildings'], placementTagRows(extras)));
    }

    return sections.join('\n\n') + '\n';
}

// Convenience for tests/regeneration against the shipped manifests.
export function isContinuous(def: ActionDefinition): boolean {
    return def.type === 'continuous';
}
