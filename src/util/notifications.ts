// Maps an Engine B event signal to a city-feed notification (task 029). Pure and unit-testable: the City
// glue resolves the subject's name and emits the cityEvent; this decides the kind + wording. Returns null for
// internal signals (e.g. rehousingNeeded) that shouldn't surface in the feed.

export interface CityNotification {
    kind: string;
    message: string;
}

const FEED_MESSAGES: Record<string, (name: string) => CityNotification> = {
    partnershipFormed: name => ({ kind: 'marriage', message: `${name} got married` }),
    hired: name => ({ kind: 'hired', message: `${name} started a new job` }),
    laidOff: name => ({ kind: 'laidOff', message: `${name} was laid off` }),
    fellIll: name => ({ kind: 'illness', message: `${name} fell ill` }),
    injured: name => ({ kind: 'illness', message: `${name} was injured in an accident` }),
    recovered: name => ({ kind: 'health', message: `${name} recovered their health` }),
    retired: name => ({ kind: 'career', message: `${name} retired` }),
    graduated: name => ({ kind: 'education', message: `${name} earned a new qualification` }),
    madeFriend: name => ({ kind: 'social', message: `${name} made a new friend` }),
    hadArgument: name => ({ kind: 'social', message: `${name} had a falling-out` }),
};

// Signals the City consumes directly (world reconciliation) without a feed mapping.
const INTERNAL_SIGNALS = ['rehousingNeeded', 'movedOut'];

// The closed vocabulary an event's `emit` effect may reference (validated by game/data, task 039). A signal
// nothing consumes is an authoring error — add its consumer (feed mapping above or a City handler) first.
export const KNOWN_SIGNALS: string[] = [...Object.keys(FEED_MESSAGES), ...INTERNAL_SIGNALS];

export function notificationForSignal(signal: string, name: string): CityNotification | null {
    const build = FEED_MESSAGES[signal];
    return build ? build(name) : null;
}
