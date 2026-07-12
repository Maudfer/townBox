import * as fs from 'fs';
import * as path from 'path';


import actionsConfig from 'json/actions.json';
import businessesConfig from 'json/businesses.json';
import eventsConfig from 'json/events.json';
import jobsConfig from 'json/jobs.json';
import oarConfig from 'json/object-action-relationships.json';
import objectsConfig from 'json/objects.json';
import placementConfig from 'json/placement.json';
import residencesConfig from 'json/residences.json';
import skillsConfig from 'json/skills.json';
import { ActionManifest, OARTable } from 'types/Action';
import { EventManifest } from 'types/LifeEvent';
import {
    ArcManifests,
    extractLifecycleLinks,
    extractConsequenceEventLinks,
    triggerKindsOf,
    triggerMixCounts,
    generateRelationshipDocs,
    isContinuous,
} from 'util/simulationDocs';

// The Action <-> Event relationship documentation (task 054): the generator's extraction logic, and the
// checked-diff gate — docs/simulation-relationships.md must match what the shipped manifests derive.
// Regenerate with `npm run docs:sim` (UPDATE_SIM_DOCS=1).

const ACTIONS = actionsConfig as unknown as ActionManifest;
const EVENTS = eventsConfig as unknown as EventManifest;
const OAR = oarConfig as unknown as OARTable;
// The arc manifests (task 075): the generated artifact now covers skills/ranks/placement/contracts too.
const EXTRAS: ArcManifests = {
    skills: skillsConfig as ArcManifests['skills'],
    jobs: jobsConfig as unknown as ArcManifests['jobs'],
    placement: (placementConfig as { tags: ArcManifests['placement'] }).tags,
    businesses: businessesConfig as unknown as ArcManifests['businesses'],
    residences: residencesConfig as ArcManifests['residences'],
    objects: objectsConfig as unknown as ArcManifests['objects'],
};

const DOC_PATH = path.join(__dirname, '..', '..', 'docs', 'generated', 'simulation-relationships.md');

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

describe('isContinuous', () => {
    test('true for continuous actions, false for discrete', () => {
        expect(isContinuous({ label: 'x', type: 'continuous', category: 'work' } as unknown as ActionManifest[string])).toBe(true);
        expect(isContinuous({ label: 'x', type: 'discrete', category: 'leisure' } as unknown as ActionManifest[string])).toBe(false);
    });
});

// generateRelationshipDocs against small hand-built fixtures — exercises corners the real (already
// checked-diff-gated) manifests don't currently reach: a triggerEvent consequence op that targets a real
// event (the shipped data has none yet), an `atHour` automated schedule rule (the shipped data only uses
// `afterEvent`), and a skills manifest using the ArcManifests `dependsOn` shape.
describe('generateRelationshipDocs — fixture corners', () => {
    const actionsFixture = {
        ping_the_neighbor: {
            label: 'Ping', type: 'discrete', category: 'social',
            consequences: [{ op: 'triggerEvent', event: 'got_pinged' }],
        },
    } as unknown as ActionManifest;

    const eventsFixture = {
        got_pinged: { roles: {}, triggers: { manual: {} }, effects: [] },
        daily_roll_call: { roles: {}, triggers: { automated: { rules: [{ atHour: 6 }] } }, effects: [] },
    } as unknown as EventManifest;

    const oarFixture = {} as OARTable;

    const extrasFixture: ArcManifests = {
        skills: {
            biology: { basic: true },
            suture_wounds: { dependsOn: [{ skill: 'biology' }] },
        },
        jobs: {},
        placement: {},
        businesses: {},
        residences: {},
        objects: {},
    };

    test('a triggerEvent consequence op appears in the event-sources reverse map', () => {
        const doc = generateRelationshipDocs(actionsFixture, eventsFixture, oarFixture, extrasFixture);
        // The reverse map's "Invoked by" cell records it as "<actionId> <op>" (plain space, task 054).
        expect(doc).toContain('`ping_the_neighbor` triggerEvent');
        // The consequence-ops table records the same link as a full row.
        expect(doc).toContain('`ping_the_neighbor` | triggerEvent | `got_pinged`');
    });

    test('an atHour automated rule is described in the automated-rules section', () => {
        const doc = generateRelationshipDocs(actionsFixture, eventsFixture, oarFixture, extrasFixture);
        expect(doc).toContain('atHour 6');
    });

    test('a skills manifest using dependsOn counts dependents per basic skill', () => {
        const doc = generateRelationshipDocs(actionsFixture, eventsFixture, oarFixture, extrasFixture);
        // biology has one dependent (suture_wounds) via `dependsOn`.
        expect(doc).toContain('| `biology` | 1 |');
    });

    test('omitting extras skips the progression-arc sections entirely', () => {
        const doc = generateRelationshipDocs(actionsFixture, eventsFixture, oarFixture);
        expect(doc).not.toContain('## Skills (dependency DAG summary)');
        expect(doc).not.toContain('## Job rank ladders');
    });
});

describe('checked diff', () => {
    test('docs/simulation-relationships.md matches the shipped manifests', () => {
        const generated = generateRelationshipDocs(ACTIONS, EVENTS, OAR, EXTRAS);
        if (process.env['UPDATE_SIM_DOCS']) {
            fs.writeFileSync(DOC_PATH, generated);
        }
        const committed = fs.readFileSync(DOC_PATH, 'utf8');
        // A mismatch means a manifest changed without regenerating: run `npm run docs:sim`.
        expect(committed).toBe(generated);
    });
});
