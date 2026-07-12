import { ActionManifest } from 'types/Action';
import { EventManifest } from 'types/LifeEvent';
import {
    SYSTEM_INVOKED_EVENTS,
    actionInvokers,
    classifyEvent,
    generateEventClassification,
} from 'util/eventClassification';

// The event-classification generator (task 068): derives each event's disposition (vital/wired/texture/
// reserved) from the shipped manifests — a code-level mirror of `docs/generated/event-classification.md`'s
// precedence rules.

function action(overrides: Partial<ActionManifest[string]> = {}): ActionManifest[string] {
    return { label: 'x', type: 'discrete', category: 'leisure', ...overrides };
}

function event(overrides: Partial<EventManifest[string]> = {}): EventManifest[string] {
    return { roles: {}, triggers: {}, effects: [], ...overrides };
}

describe('actionInvokers', () => {
    test('maps event ids to the actionId.hook labels that invoke them', () => {
        const actions: ActionManifest = {
            sleep: action({ events: { onComplete: 'woke_up' } }),
            work: action({ events: { onStart: 'started_working', onInterrupt: 'stopped_working' } }),
        };
        const invokers = actionInvokers(actions);
        expect(invokers.get('woke_up')).toEqual(['sleep.onComplete']);
        expect(invokers.get('started_working')).toEqual(['work.onStart']);
        expect(invokers.get('stopped_working')).toEqual(['work.onInterrupt']);
    });

    test('handles the object EventLink form (payload-mapped) the same as the string form', () => {
        const actions: ActionManifest = {
            give: action({ events: { onComplete: { event: 'gave_gift', params: { object: '$params.object' } } } }),
        };
        const invokers = actionInvokers(actions);
        expect(invokers.get('gave_gift')).toEqual(['give.onComplete']);
    });

    test('an action with no lifecycle links contributes nothing', () => {
        const actions: ActionManifest = { wander: action() };
        expect(actionInvokers(actions).size).toBe(0);
    });

    test('multiple actions invoking the same event are all listed', () => {
        const actions: ActionManifest = {
            a: action({ events: { onComplete: 'shared_event' } }),
            b: action({ events: { onComplete: 'shared_event' } }),
        };
        expect(actionInvokers(actions).get('shared_event')).toEqual(['a.onComplete', 'b.onComplete']);
    });
});

describe('classifyEvent', () => {
    test('an event with effects is vital, regardless of triggers/invokers', () => {
        const events: EventManifest = { died: event({ effects: [{ type: 'setDeath' }] }) };
        const result = classifyEvent('died', events, new Map());
        expect(result.disposition).toBe('vital');
    });

    test('an effect-free event invoked by an action is wired', () => {
        const events: EventManifest = { completed_school_day: event({ triggers: { manual: {} } }) };
        const invokers = new Map([['completed_school_day', ['attend_school.onComplete']]]);
        const result = classifyEvent('completed_school_day', events, invokers);
        expect(result).toEqual({ disposition: 'wired', invokedBy: ['attend_school.onComplete'] });
    });

    test('an effect-free event invoked only by a named system caller is wired', () => {
        const events: EventManifest = { started_school: event({ triggers: { manual: {} } }) };
        const result = classifyEvent('started_school', events, new Map());
        expect(result.disposition).toBe('wired');
        expect(result.invokedBy).toEqual([SYSTEM_INVOKED_EVENTS['started_school']]);
    });

    test('an effect-free event with an automated rule is wired, tagging "automated schedule"', () => {
        const events: EventManifest = {
            daily_sweep: event({ triggers: { automated: { rules: [{ atHour: 8 }] } } }),
        };
        const result = classifyEvent('daily_sweep', events, new Map());
        expect(result.disposition).toBe('wired');
        expect(result.invokedBy).toEqual(['automated schedule']);
    });

    test('an effect-free, uninvoked, probabilistic-only event is texture', () => {
        const events: EventManifest = {
            made_friend: event({ triggers: { probabilistic: { perYear: 2 } } }),
        };
        const result = classifyEvent('made_friend', events, new Map());
        expect(result).toEqual({ disposition: 'texture', invokedBy: [] });
    });

    test('an effect-free, uninvoked, manual-only event is reserved', () => {
        const events: EventManifest = { future_hook: event({ triggers: { manual: {} } }) };
        const result = classifyEvent('future_hook', events, new Map());
        expect(result).toEqual({ disposition: 'reserved', invokedBy: [] });
    });

    test('effects take precedence even when the event is also invoked', () => {
        const events: EventManifest = {
            got_promoted: event({ effects: [{ type: 'setAttr', attr: 'rank', value: 2 }], triggers: { manual: {} } }),
        };
        const result = classifyEvent('got_promoted', events, new Map());
        expect(result.disposition).toBe('vital');
        // Still reports the system invoker even though the disposition is vital, not wired.
        expect(result.invokedBy).toEqual([SYSTEM_INVOKED_EVENTS['got_promoted']]);
    });
});

describe('generateEventClassification', () => {
    test('renders a markdown table with totals and per-event rows, sorted by id', () => {
        const events: EventManifest = {
            zeta_event: event({ effects: [{ type: 'setAttr', attr: 'x', value: 1 }], triggers: { manual: {} }, category: 'misc' }),
            alpha_event: event({ triggers: { probabilistic: { perYear: 1 } }, category: 'social' }),
        };
        const actions: ActionManifest = {};
        const markdown = generateEventClassification(events, actions);

        expect(markdown).toContain('# Event classification (task 068)');
        expect(markdown).toContain('Totals: 2 events');
        expect(markdown).toContain('**1 vital**');
        expect(markdown).toContain('**1 texture**');
        expect(markdown).toContain('| alpha_event | social | probabilistic | texture | — |');
        expect(markdown).toContain('| zeta_event | misc | manual | vital | — |');
        // Sorted alphabetically: alpha_event's row precedes zeta_event's.
        expect(markdown.indexOf('alpha_event')).toBeLessThan(markdown.indexOf('zeta_event'));
    });

    test('an event invoked by an action shows the invoker in its row', () => {
        const events: EventManifest = { woke_up: event({ triggers: { manual: {} } }) };
        const actions: ActionManifest = { sleep: action({ events: { onComplete: 'woke_up' } }) };
        const markdown = generateEventClassification(events, actions);
        expect(markdown).toContain('| woke_up | — | manual | wired | sleep.onComplete |');
    });
});
