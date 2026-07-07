import * as fs from 'fs';
import * as path from 'path';

import {
    extractLifecycleLinks,
    extractConsequenceEventLinks,
    triggerKindsOf,
    triggerMixCounts,
    generateRelationshipDocs,
} from '../src/util/simulationDocs';

import { ActionManifest, OARTable } from '../src/types/Action';
import { EventManifest } from '../src/types/LifeEvent';
import actionsConfig from '../src/json/actions.json';
import eventsConfig from '../src/json/events.json';
import oarConfig from '../src/json/object-action-relationships.json';

// The Action <-> Event relationship documentation (task 054): the generator's extraction logic, and the
// checked-diff gate — docs/simulation-relationships.md must match what the shipped manifests derive.
// Regenerate with `npm run docs:sim` (UPDATE_SIM_DOCS=1).

const ACTIONS = actionsConfig as unknown as ActionManifest;
const EVENTS = eventsConfig as unknown as EventManifest;
const OAR = oarConfig as unknown as OARTable;

const DOC_PATH = path.join(__dirname, '..', 'docs', 'simulation-relationships.md');

describe('extraction', () => {
    test('lifecycle links include the known anchors', () => {
        const links = extractLifecycleLinks(ACTIONS);
        expect(links).toContainEqual({ actionId: 'sleep', transition: 'onComplete', eventId: 'woke_up' });
        expect(links).toContainEqual({ actionId: 'working_the_kitchen', transition: 'onStart', eventId: 'started_working' });
        expect(links).toContainEqual({ actionId: 'gave_object_to_person', transition: 'onComplete', eventId: 'gave_gift' });
        // Every linked event exists and declares a manual trigger (the 043/052 validator contract).
        for (const link of links) {
            const event = EVENTS[link.eventId];
            expect({ link, exists: event !== undefined }).toEqual({ link, exists: true });
            expect({ link, manual: triggerKindsOf(event!).includes('manual') }).toEqual({ link, manual: true });
        }
    });

    test('consequence-op extraction picks up triggerEvent and scheduleEvent', () => {
        const fixture = {
            snack: {
                label: 'x', type: 'discrete', category: 'leisure',
                consequences: [
                    { op: 'consumeObject', object: { carried: { archetype: 'apple' } } },
                    { op: 'triggerEvent', event: 'got_snack' },
                    { op: 'scheduleEvent', event: 'delayed_ping', afterTicks: 5 },
                ],
            },
        } as unknown as ActionManifest;
        expect(extractConsequenceEventLinks(fixture)).toEqual([
            { actionId: 'snack', op: 'triggerEvent', eventId: 'got_snack' },
            { actionId: 'snack', op: 'scheduleEvent', eventId: 'delayed_ping', afterTicks: 5 },
        ]);
    });

    test('trigger kinds check key presence, not truthiness (manual: {} counts)', () => {
        expect(triggerKindsOf({ triggers: { manual: {} } } as unknown as EventManifest[string])).toEqual(['manual']);
        expect(triggerKindsOf({ triggers: {} } as unknown as EventManifest[string])).toEqual([]);
        const mixes = triggerMixCounts(EVENTS);
        const total = [...mixes.values()].reduce((sum, n) => sum + n, 0);
        expect(total).toBe(Object.keys(EVENTS).length);
        // The 052 targets remain visible through the aggregation.
        const manualTotal = Object.values(EVENTS).filter(event => triggerKindsOf(event).includes('manual')).length;
        const probabilisticTotal = Object.values(EVENTS).filter(event => triggerKindsOf(event).includes('probabilistic')).length;
        expect(manualTotal).toBeGreaterThanOrEqual(500);
        expect(probabilisticTotal).toBeGreaterThanOrEqual(500);
    });
});

describe('checked diff', () => {
    test('docs/simulation-relationships.md matches the shipped manifests', () => {
        const generated = generateRelationshipDocs(ACTIONS, EVENTS, OAR);
        if (process.env['UPDATE_SIM_DOCS']) {
            fs.writeFileSync(DOC_PATH, generated);
        }
        const committed = fs.readFileSync(DOC_PATH, 'utf8');
        // A mismatch means a manifest changed without regenerating: run `npm run docs:sim`.
        expect(committed).toBe(generated);
    });
});
