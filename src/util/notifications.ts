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
        default:
            return null;
    }
}
