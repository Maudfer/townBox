// Maps an Engine B event signal to a city-feed notification (task 029). Pure and unit-testable: the City
// glue resolves the subject's name and emits the cityEvent; this decides the kind + wording. Returns null for
// internal signals (e.g. rehousingNeeded) that shouldn't surface in the feed.

export interface CityNotification {
    kind: string;
    message: string;
}

export function notificationForSignal(signal: string, name: string): CityNotification | null {
    switch (signal) {
        case 'partnershipFormed':
            return { kind: 'marriage', message: `${name} got married` };
        case 'hired':
            return { kind: 'hired', message: `${name} started a new job` };
        case 'laidOff':
            return { kind: 'laidOff', message: `${name} was laid off` };
        case 'fellIll':
            return { kind: 'illness', message: `${name} fell ill` };
        case 'injured':
            return { kind: 'illness', message: `${name} was injured in an accident` };
        case 'recovered':
            return { kind: 'health', message: `${name} recovered their health` };
        case 'retired':
            return { kind: 'career', message: `${name} retired` };
        case 'graduated':
            return { kind: 'education', message: `${name} earned a new qualification` };
        case 'madeFriend':
            return { kind: 'social', message: `${name} made a new friend` };
        case 'hadArgument':
            return { kind: 'social', message: `${name} had a falling-out` };
        default:
            return null;
    }
}
