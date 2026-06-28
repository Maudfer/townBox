import { Predicate, evaluatePredicate } from '../src/util/predicate';
import { SimulationContext, Value, HasEventQuery } from '../src/types/Simulation';

// A minimal fixture Context: a bag of attributes, a set of past events, and optional bound roles. Stands in
// for the materialized-person Context that phase 013d will implement.
interface FixtureSpec {
    attrs?: Record<string, Value | Value[]>;
    events?: Record<string, { count: number; lastTick: number }>;
    nowTick?: number;
    roles?: Record<string, FixtureSpec>;
}

function makeContext(spec: FixtureSpec): SimulationContext {
    const now = spec.nowTick ?? 0;
    return {
        getAttr(name: string): Value | Value[] | undefined {
            return spec.attrs?.[name];
        },
        hasEvent(eventId: string, query?: HasEventQuery): boolean {
            const record = spec.events?.[eventId];
            if (!record) {
                return false;
            }
            if (query?.minCount !== undefined && record.count < query.minCount) {
                return false;
            }
            if (query?.withinDays !== undefined && now - record.lastTick > query.withinDays) {
                return false;
            }
            return true;
        },
        role(name: string): SimulationContext | null {
            const sub = spec.roles?.[name];
            return sub ? makeContext(sub) : null;
        },
    };
}

describe('evaluatePredicate — comparisons', () => {
    const ctx = makeContext({ attrs: { alive: true, age: 30, gender: 'female', marital: 'single' } });

    test('equality and inequality', () => {
        expect(evaluatePredicate({ attr: 'alive', op: '==', value: true }, ctx)).toBe(true);
        expect(evaluatePredicate({ attr: 'gender', op: '==', value: 'male' }, ctx)).toBe(false);
        expect(evaluatePredicate({ attr: 'marital', op: '!=', value: 'married' }, ctx)).toBe(true);
    });

    test('ordered comparisons require two numbers', () => {
        expect(evaluatePredicate({ attr: 'age', op: '>=', value: 16 }, ctx)).toBe(true);
        expect(evaluatePredicate({ attr: 'age', op: '<', value: 18 }, ctx)).toBe(false);
        // Non-numeric operand -> false rather than coercion.
        expect(evaluatePredicate({ attr: 'gender', op: '<', value: 'z' }, ctx)).toBe(false);
        // Missing attribute -> false for ordered ops.
        expect(evaluatePredicate({ attr: 'missing', op: '>', value: 0 }, ctx)).toBe(false);
    });

    test('in checks membership in an operand list', () => {
        expect(evaluatePredicate({ attr: 'marital', op: 'in', value: ['single', 'divorced'] }, ctx)).toBe(true);
        expect(evaluatePredicate({ attr: 'marital', op: 'in', value: ['married', 'widowed'] }, ctx)).toBe(false);
    });
});

describe('evaluatePredicate — combinators', () => {
    const ctx = makeContext({ attrs: { age: 30, alive: true } });

    test('all / any / not', () => {
        expect(evaluatePredicate({ all: [{ attr: 'alive', op: '==', value: true }, { attr: 'age', op: '>=', value: 18 }] }, ctx)).toBe(true);
        expect(evaluatePredicate({ all: [{ attr: 'alive', op: '==', value: true }, { attr: 'age', op: '>=', value: 50 }] }, ctx)).toBe(false);
        expect(evaluatePredicate({ any: [{ attr: 'age', op: '>=', value: 50 }, { attr: 'alive', op: '==', value: true }] }, ctx)).toBe(true);
        expect(evaluatePredicate({ not: { attr: 'age', op: '<', value: 18 } }, ctx)).toBe(true);
    });
});

describe('evaluatePredicate — hasEvent (history + cooldowns)', () => {
    const ctx = makeContext({
        attrs: {},
        nowTick: 1000,
        events: { had_sex: { count: 3, lastTick: 800 }, pregnancy: { count: 1, lastTick: 750 } },
    });

    test('presence, recency, and minCount', () => {
        expect(evaluatePredicate({ hasEvent: 'had_sex' }, ctx)).toBe(true);
        expect(evaluatePredicate({ hasEvent: 'never' }, ctx)).toBe(false);
        expect(evaluatePredicate({ hasEvent: 'had_sex', withinDays: 280 }, ctx)).toBe(true); // 1000-800=200 <= 280
        expect(evaluatePredicate({ hasEvent: 'had_sex', withinDays: 100 }, ctx)).toBe(false); // 200 > 100
        expect(evaluatePredicate({ hasEvent: 'had_sex', minCount: 5 }, ctx)).toBe(false);
    });

    test('cooldown expressed as a negated recency requirement', () => {
        // pregnancy fired 250 days ago; a 300-day cooldown blocks it, a 200-day one would not.
        expect(evaluatePredicate({ not: { hasEvent: 'pregnancy', withinDays: 300 } }, ctx)).toBe(false);
        expect(evaluatePredicate({ not: { hasEvent: 'pregnancy', withinDays: 200 } }, ctx)).toBe(true);
    });
});

describe('evaluatePredicate — roles', () => {
    const ctx = makeContext({
        attrs: { gender: 'female', alive: true },
        roles: { father: { attrs: { alive: true, gender: 'male' }, events: { married: { count: 1, lastTick: 0 } }, nowTick: 100 } },
    });

    test('where conditions on a bound co-participant', () => {
        expect(evaluatePredicate({ role: 'father', where: { attr: 'alive', op: '==', value: true } }, ctx)).toBe(true);
        expect(evaluatePredicate({ role: 'father', where: { attr: 'gender', op: '==', value: 'female' } }, ctx)).toBe(false);
        // Unbound role -> false.
        expect(evaluatePredicate({ role: 'mother', where: { attr: 'alive', op: '==', value: true } }, ctx)).toBe(false);
    });

    test('hasEvent can target a bound role', () => {
        expect(evaluatePredicate({ hasEvent: 'married', role: 'father' }, ctx)).toBe(true);
        expect(evaluatePredicate({ hasEvent: 'married', role: 'mother' }, ctx)).toBe(false);
    });

    test('the pregnancy eligibility shape composes', () => {
        const eligible: Predicate = {
            all: [
                { attr: 'gender', op: '==', value: 'female' },
                { attr: 'alive', op: '==', value: true },
                { role: 'father', where: { attr: 'alive', op: '==', value: true } },
            ],
        };
        expect(evaluatePredicate(eligible, ctx)).toBe(true);
    });
});
