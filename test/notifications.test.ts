import { notificationForSignal } from '../src/util/notifications';

describe('notificationForSignal (city feed mapping, task 029)', () => {
    test('maps player-facing signals to a kind + worded message', () => {
        expect(notificationForSignal('partnershipFormed', 'Ana')).toEqual({ kind: 'marriage', message: 'Ana got married' });
        expect(notificationForSignal('hired', 'Bob')).toEqual({ kind: 'hired', message: 'Bob started a new job' });
        expect(notificationForSignal('laidOff', 'Cleo')).toEqual({ kind: 'laidOff', message: 'Cleo was laid off' });
        expect(notificationForSignal('fellIll', 'Dan')).toEqual({ kind: 'illness', message: 'Dan fell ill' });
    });

    test('returns null for internal signals that should not surface', () => {
        expect(notificationForSignal('rehousingNeeded', 'Eve')).toBeNull();
        expect(notificationForSignal('unknownSignal', 'Eve')).toBeNull();
    });
});
