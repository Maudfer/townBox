import { compileEvents } from 'game/events/EventCompiler';
import eventsConfig from 'json/events.json';
import { EventManifest } from 'types/LifeEvent';


const REAL_EVENTS = eventsConfig as unknown as EventManifest;

describe('compileEvents — seeded manifest', () => {
    const graph = compileEvents(REAL_EVENTS);

    test('compiles with no warnings (no unmet requirements or cycles)', () => {
        expect(graph.warnings).toEqual([]);
    });

    test('pregnancy depends on had_sex; had_sex has no dependencies', () => {
        expect(graph.dependsOn['pregnancy']).toContain('had_sex');
        expect(graph.dependsOn['had_sex']).toEqual([]);
    });

    test('topological order places had_sex before pregnancy', () => {
        expect(graph.topoOrder.indexOf('had_sex')).toBeLessThan(graph.topoOrder.indexOf('pregnancy'));
        expect(graph.topoOrder).toHaveLength(graph.ids.length);
    });

    test('death excludes every event that requires being alive (derived, not authored)', () => {
        expect(graph.excludes['death']).toEqual(
            expect.arrayContaining(['had_sex', 'pregnancy', 'marriage', 'divorce', 'get_job', 'layoff', 'fell_ill'])
        );
    });

    test('a windowed cooldown is not a hard exclusion', () => {
        // pregnancy's "not hasEvent pregnancy withinTicks 300" is a runtime cooldown, not a static self-exclude.
        expect(graph.excludes['pregnancy']).not.toContain('pregnancy');
    });

    test('eligibility discriminants are extracted for the index', () => {
        expect(graph.indexKeys['pregnancy']).toEqual(expect.arrayContaining(['alive', 'gender', 'age']));
    });

    test('subject gates carry the value-bearing discriminant comparisons', () => {
        expect(graph.subjectGates['pregnancy']).toEqual(expect.arrayContaining([
            { attr: 'alive', op: '==', value: true },
            { attr: 'gender', op: '==', value: 'female' },
            { attr: 'age', op: '>=', value: 16 },
        ]));
    });
});

describe('compileEvents — subject gates (the eligibility index)', () => {
    // Gates must be NECESSARY conditions of the subject predicate: hard conjunctive discriminant
    // comparisons only. Anything soft (any-branch), negated, non-subject, or non-discriminant must stay
    // out — an over-extracted gate would silently suppress eligible events at runtime.
    test('soft, negated, role-scoped, and non-discriminant comparisons are not gates', () => {
        const manifest: EventManifest = {
            picky: {
                roles: {
                    subject: {
                        where: {
                            all: [
                                { attr: 'alive', op: '==', value: true },
                                { attr: 'marital', op: 'in', value: ['single', 'divorced'] },
                                { attr: 'age', op: '<', value: 65 },
                                { attr: 'health', op: '>=', value: 0.5 }, // not a discriminant
                                { any: [{ attr: 'gender', op: '==', value: 'female' }, { attr: 'age', op: '>=', value: 30 }] }, // soft
                                { not: { attr: 'marital', op: '==', value: 'widowed' } }, // negated
                            ],
                        },
                    },
                    friend: { where: { attr: 'gender', op: '==', value: 'male' } }, // role-scoped
                },
                triggers: { probabilistic: { perYear: 1 } },
                effects: [],
            },
        };
        const graph = compileEvents(manifest);
        expect(graph.subjectGates['picky']).toEqual([
            { attr: 'alive', op: '==', value: true },
            { attr: 'marital', op: 'in', value: ['single', 'divorced'] },
            { attr: 'age', op: '<', value: 65 },
        ]);
    });
});

describe('compileEvents — derived exclusivity', () => {
    test('an event whose effect sets a state to a different value excludes events requiring the other value', () => {
        const manifest: EventManifest = {
            become_married: {
                roles: { subject: { where: { attr: 'alive', op: '==', value: true } }, partner: { bind: 'partnerOf:subject' } },
                triggers: { probabilistic: { perYear: 0.1 } },
                effects: [{ type: 'marry', role: 'partner' }],
            },
            single_club: {
                roles: { subject: { where: { attr: 'marital', op: '==', value: 'single' } } },
                triggers: { probabilistic: { perYear: 1 } },
                effects: [],
            },
        };
        const graph = compileEvents(manifest);
        // marry sets marital=married; single_club requires marital=single ⇒ become_married excludes single_club.
        expect(graph.excludes['become_married']).toContain('single_club');
        expect(graph.excludes['single_club']).toEqual([]);
        expect(graph.warnings).toEqual([]);
    });

    test('a permanent negated prerequisite makes the provider exclude the requirer', () => {
        const manifest: EventManifest = {
            first_kiss: {
                roles: { subject: { where: { attr: 'alive', op: '==', value: true } } },
                triggers: { probabilistic: { perYear: 1 } },
                effects: [],
            },
            never_kissed_award: {
                roles: { subject: { where: { not: { hasEvent: 'first_kiss' } } } }, // no withinTicks ⇒ permanent
                triggers: { probabilistic: { perYear: 1 } },
                effects: [],
            },
        };
        const graph = compileEvents(manifest);
        expect(graph.excludes['first_kiss']).toContain('never_kissed_award');
    });
});

describe('compileEvents — validation', () => {
    test('flags a requirement on an event nothing provides', () => {
        const manifest: EventManifest = {
            haunting: {
                roles: { subject: { where: { hasEvent: 'ghost' } } },
                triggers: { probabilistic: { perYear: 1 } },
                effects: [],
            },
        };
        const graph = compileEvents(manifest);
        expect(graph.warnings.some(w => w.includes('ghost'))).toBe(true);
    });

    test('flags a dependency cycle but still returns every event in the order', () => {
        const manifest: EventManifest = {
            a: { roles: { subject: { where: { hasEvent: 'b' } } }, triggers: { probabilistic: { perYear: 1 } }, effects: [] },
            b: { roles: { subject: { where: { hasEvent: 'a' } } }, triggers: { probabilistic: { perYear: 1 } }, effects: [] },
        };
        const graph = compileEvents(manifest);
        expect(graph.warnings.some(w => w.toLowerCase().includes('cycle'))).toBe(true);
        expect(graph.topoOrder.sort()).toEqual(['a', 'b']);
    });

    test('is deterministic for the same manifest', () => {
        const a = compileEvents(REAL_EVENTS);
        const b = compileEvents(REAL_EVENTS);
        expect(a).toEqual(b);
    });
});

describe('compileEvents — requirement-walk node kinds not otherwise exercised above', () => {
    test('a soft (any-branch) hasEvent is not a hard dependency, but a hard positive hasEvent still depends', () => {
        const manifest: EventManifest = {
            base: { roles: { subject: { where: { attr: 'alive', op: '==', value: true } } }, triggers: { probabilistic: { perYear: 1 } }, effects: [] },
            maybe_related: {
                // The hasEvent lives inside an `any` — soft, so it must NOT create a dependsOn edge.
                roles: { subject: { where: { any: [{ hasEvent: 'base' }, { attr: 'alive', op: '==', value: true }] } } },
                triggers: { probabilistic: { perYear: 1 } },
                effects: [],
            },
        };
        const graph = compileEvents(manifest);
        expect(graph.dependsOn['maybe_related']).toEqual([]);
    });

    test('a nested {role, where} predicate node is walked without throwing and contributes no static requirement', () => {
        const manifest: EventManifest = {
            role_scoped: {
                roles: {
                    subject: { where: { role: 'partner', where: { attr: 'age', op: '>=', value: 18 } } },
                    partner: { where: { attr: 'alive', op: '==', value: true } },
                },
                triggers: { probabilistic: { perYear: 1 } },
                effects: [],
            },
        };
        expect(() => compileEvents(manifest)).not.toThrow();
        const graph = compileEvents(manifest);
        expect(graph.warnings).toEqual([]);
        expect(graph.subjectGates['role_scoped']).toEqual([]); // a role-scoped comparison is never a subject gate
    });

    test('hasAction/carries/objectAtLocation nodes are runtime-only and never enter the static graph', () => {
        const manifest: EventManifest = {
            action_gated: {
                roles: { subject: { where: { all: [
                    { attr: 'alive', op: '==', value: true },
                    { hasAction: 'some_action' },
                    { carries: { archetype: 'coin' } },
                    { objectAtLocation: { archetype: 'oven' } },
                ] } } },
                triggers: { probabilistic: { perYear: 1 } },
                effects: [],
            },
        };
        const graph = compileEvents(manifest);
        expect(graph.dependsOn['action_gated']).toEqual([]);
        expect(graph.subjectGates['action_gated']).toEqual([{ attr: 'alive', op: '==', value: true }]);
        expect(graph.warnings).toEqual([]);
    });

    test('a positive state requirement on an unknown, non-base attribute is flagged', () => {
        const manifest: EventManifest = {
            mystery: {
                roles: { subject: { where: { attr: 'favoriteColor', op: '==', value: 'blue' } } },
                triggers: { probabilistic: { perYear: 1 } },
                effects: [],
            },
        };
        const graph = compileEvents(manifest);
        expect(graph.warnings.some(w => w.includes('favoriteColor'))).toBe(true);
    });
});
