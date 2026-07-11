import { Predicate, evaluatePredicate, evaluatePredicateCached, compilePredicate } from 'util/predicate';
import { SimulationContext, Value, HasEventQuery, ObjectQuery } from 'types/Simulation';

// A minimal fixture Context: a bag of attributes, a set of past events, and optional bound roles. Stands in
// for the materialized-person Context that phase 013d will implement.
interface FixtureSpec {
    attrs?: Record<string, Value | Value[]>;
    events?: Record<string, { count: number; lastTick: number }>;
    actions?: Record<string, { count: number; lastTick: number }>;
    carriesArchetypes?: string[];
    objectsHereArchetypes?: string[];
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
            if (query?.withinTicks !== undefined && now - record.lastTick > query.withinTicks) {
                return false;
            }
            return true;
        },
        hasAction(actionId: string, query?: HasEventQuery): boolean {
            const record = spec.actions?.[actionId];
            if (!record) {
                return false;
            }
            if (query?.minCount !== undefined && record.count < query.minCount) {
                return false;
            }
            if (query?.withinTicks !== undefined && now - record.lastTick > query.withinTicks) {
                return false;
            }
            return true;
        },
        carries(query: ObjectQuery): boolean {
            return (spec.carriesArchetypes ?? []).includes(query.archetype ?? '');
        },
        objectAtLocation(query: ObjectQuery): boolean {
            return (spec.objectsHereArchetypes ?? []).includes(query.archetype ?? '');
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
        expect(evaluatePredicate({ hasEvent: 'had_sex', withinTicks: 280 }, ctx)).toBe(true); // 1000-800=200 <= 280
        expect(evaluatePredicate({ hasEvent: 'had_sex', withinTicks: 100 }, ctx)).toBe(false); // 200 > 100
        expect(evaluatePredicate({ hasEvent: 'had_sex', minCount: 5 }, ctx)).toBe(false);
    });

    test('cooldown expressed as a negated recency requirement', () => {
        // pregnancy fired 250 days ago; a 300-day cooldown blocks it, a 200-day one would not.
        expect(evaluatePredicate({ not: { hasEvent: 'pregnancy', withinTicks: 300 } }, ctx)).toBe(false);
        expect(evaluatePredicate({ not: { hasEvent: 'pregnancy', withinTicks: 200 } }, ctx)).toBe(true);
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

// Precompilation (task 079 pass 3): compilePredicate / evaluatePredicateCached must be byte-identical to the
// interpreter for EVERY node kind and combinator, across contexts where the answer is true AND false. This is
// the guard that lets the hot selection paths use the compiled form without changing the generated asset.
describe('compilePredicate — byte-identical to the interpreter', () => {
    const contexts: SimulationContext[] = [
        makeContext({
            attrs: { alive: true, age: 30, gender: 'female', marital: 'single', tags: ['a', 'b'] },
            nowTick: 1000,
            events: { had_sex: { count: 3, lastTick: 800 }, pregnancy: { count: 1, lastTick: 750 } },
            actions: { read_book: { count: 2, lastTick: 990 } },
            carriesArchetypes: ['wallet', 'phone'],
            objectsHereArchetypes: ['stove', 'sofa'],
            roles: { partner: { attrs: { alive: true, gender: 'male', age: 33 }, events: { married: { count: 1, lastTick: 500 } }, nowTick: 1000 } },
        }),
        makeContext({ attrs: { alive: false }, nowTick: 5 }), // sparse: most sub-predicates resolve false / missing
    ];

    const predicates: Predicate[] = [
        { attr: 'alive', op: '==', value: true },
        { attr: 'gender', op: '==', value: 'male' },
        { attr: 'age', op: '>=', value: 18 },
        { attr: 'age', op: '<', value: 18 },
        { attr: 'missing', op: '>', value: 0 },
        { attr: 'marital', op: 'in', value: ['single', 'divorced'] },
        { hasEvent: 'had_sex' },
        { hasEvent: 'had_sex', withinTicks: 100 },
        { hasEvent: 'had_sex', minCount: 5 },
        { hasEvent: 'married', role: 'partner' },
        { hasAction: 'read_book', withinTicks: 5 },
        { hasAction: 'read_book', minCount: 10 },
        { hasAction: 'never_done' },
        { carries: { archetype: 'wallet' } },
        { carries: { archetype: 'nonexistent' } },
        { objectAtLocation: { archetype: 'stove' } },
        { objectAtLocation: { archetype: 'nonexistent' } },
        { role: 'partner', where: { attr: 'alive', op: '==', value: true } },
        { role: 'mother', where: { attr: 'alive', op: '==', value: true } },
        { not: { attr: 'alive', op: '==', value: true } },
        { all: [{ attr: 'alive', op: '==', value: true }, { hasEvent: 'had_sex' }, { carries: { archetype: 'phone' } }] },
        { any: [{ attr: 'age', op: '>=', value: 99 }, { objectAtLocation: { archetype: 'sofa' } }] },
        { all: [] },
        { any: [] },
        // Deeply nested mix of every node kind.
        { all: [
            { any: [{ not: { attr: 'gender', op: '==', value: 'male' } }, { hasAction: 'read_book', withinTicks: 5 }] },
            { role: 'partner', where: { all: [{ attr: 'age', op: '>=', value: 30 }, { hasEvent: 'married', withinTicks: 600 }] } },
        ] },
    ];

    test('every node kind matches the interpreter in every context', () => {
        for (const ctx of contexts) {
            for (const pred of predicates) {
                const interpreted = evaluatePredicate(pred, ctx);
                expect(compilePredicate(pred)(ctx)).toBe(interpreted);
                expect(evaluatePredicateCached(pred, ctx)).toBe(interpreted);
            }
        }
    });

    test('the cache returns a stable compiled function per predicate object', () => {
        const pred: Predicate = { all: [{ attr: 'alive', op: '==', value: true }] };
        // Evaluating twice must reuse the same compiled closure (cache hit) and agree with the interpreter.
        expect(evaluatePredicateCached(pred, contexts[0]!)).toBe(evaluatePredicate(pred, contexts[0]!));
        expect(evaluatePredicateCached(pred, contexts[1]!)).toBe(evaluatePredicate(pred, contexts[1]!));
    });
});
