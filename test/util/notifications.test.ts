import { notificationForSignal, KNOWN_SIGNALS } from 'util/notifications';

describe('notificationForSignal (city feed mapping, task 029)', () => {
    test('maps player-facing signals to a kind + worded message', () => {
        expect(notificationForSignal('partnershipFormed', 'Ana')).toEqual({ kind: 'marriage', message: 'Ana got married' });
        expect(notificationForSignal('hired', 'Bob')).toEqual({ kind: 'hired', message: 'Bob started a new job' });
        expect(notificationForSignal('laidOff', 'Cleo')).toEqual({ kind: 'laidOff', message: 'Cleo was laid off' });
        expect(notificationForSignal('fellIll', 'Dan')).toEqual({ kind: 'illness', message: 'Dan fell ill' });
    });

    test('maps the remaining player-facing signals', () => {
        expect(notificationForSignal('injured', 'Fay')).toEqual({ kind: 'illness', message: 'Fay was injured in an accident' });
        expect(notificationForSignal('recovered', 'Gil')).toEqual({ kind: 'health', message: 'Gil recovered their health' });
        expect(notificationForSignal('retired', 'Hal')).toEqual({ kind: 'career', message: 'Hal retired' });
        expect(notificationForSignal('promoted', 'Ivy')).toEqual({ kind: 'career', message: 'Ivy was promoted' });
        expect(notificationForSignal('graduated', 'Jax')).toEqual({ kind: 'education', message: 'Jax earned a new qualification' });
        expect(notificationForSignal('madeFriend', 'Kay')).toEqual({ kind: 'social', message: 'Kay made a new friend' });
        expect(notificationForSignal('hadArgument', 'Lee')).toEqual({ kind: 'social', message: 'Lee had a falling-out' });
    });

    test('returns null for internal signals that should not surface', () => {
        expect(notificationForSignal('rehousingNeeded', 'Eve')).toBeNull();
        expect(notificationForSignal('unknownSignal', 'Eve')).toBeNull();
    });

    test('KNOWN_SIGNALS is the closed union of feed-mapped and internal signals', () => {
        expect(KNOWN_SIGNALS).toEqual(expect.arrayContaining(['hired', 'laidOff', 'rehousingNeeded', 'movedOut']));
    });
});
