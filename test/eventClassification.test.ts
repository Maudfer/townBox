import * as fs from 'fs';
import * as path from 'path';

import { generateEventClassification, classifyEvent, actionInvokers } from '../src/util/eventClassification';

import { ActionManifest } from '../src/types/Action';
import { EventManifest } from '../src/types/LifeEvent';
import actionsConfig from '../src/json/actions.json';
import eventsConfig from '../src/json/events.json';

// The event-classification artifact (task 068): every event has a deliberate disposition, and the generated
// docs/event-classification.md matches the shipped manifests. Regenerate with `npm run docs:events`.

const ACTIONS = actionsConfig as unknown as ActionManifest;
const EVENTS = eventsConfig as unknown as EventManifest;

const DOC_PATH = path.join(__dirname, '..', 'docs', 'event-classification.md');

describe('classification rules', () => {
    const invokers = actionInvokers(ACTIONS);

    test('the generic parameterized object events are wired (invoked by the generic verbs)', () => {
        expect(classifyEvent('object_acquired', EVENTS, invokers)).toMatchObject({ disposition: 'wired' });
        expect(classifyEvent('object_lost', EVENTS, invokers)).toMatchObject({ disposition: 'wired' });
        // The give/receive pair awaits its 074 callers — reserved, on purpose, and documented.
        expect(classifyEvent('object_given', EVENTS, invokers).disposition).toBe('reserved');
    });

    test('vital, texture, and system-invoked events classify as expected', () => {
        expect(classifyEvent('get_job', EVENTS, invokers).disposition).toBe('vital');
        expect(classifyEvent('bought_new_couch', EVENTS, invokers).disposition).toBe('texture');
        expect(classifyEvent('got_promoted', EVENTS, invokers).disposition).toBe('vital'); // carries the promoted signal
        expect(classifyEvent('completed_school_day', EVENTS, invokers).disposition).toBe('wired');
    });

    test('every event lands in exactly one deliberate disposition (nothing is silently dead)', () => {
        const counts: Record<string, number> = {};
        for (const eventId of Object.keys(EVENTS)) {
            const { disposition } = classifyEvent(eventId, EVENTS, invokers);
            counts[disposition] = (counts[disposition] ?? 0) + 1;
        }
        // The reserved pool is the 052 manual-capability layer awaiting 072/074 wiring — tracked, not silent.
        expect(counts['vital']).toBeGreaterThanOrEqual(14);
        expect(counts['wired']).toBeGreaterThanOrEqual(5);
        expect(counts['texture']).toBeGreaterThanOrEqual(400);
        expect((counts['vital'] ?? 0) + (counts['wired'] ?? 0) + (counts['texture'] ?? 0) + (counts['reserved'] ?? 0)).toBe(Object.keys(EVENTS).length);
    });
});

describe('checked diff', () => {
    test('docs/event-classification.md matches the shipped manifests', () => {
        const generated = generateEventClassification(EVENTS, ACTIONS);
        if (process.env['UPDATE_EVENT_DOCS']) {
            fs.writeFileSync(DOC_PATH, generated);
        }
        const committed = fs.readFileSync(DOC_PATH, 'utf8');
        // A mismatch means a manifest changed without regenerating: run `npm run docs:events`.
        expect(committed).toBe(generated);
    });
});
