import { compileEvents } from '../src/app/game/EventCompiler';
import { EventManifest } from '../src/types/LifeEvent';

import eventsConfig from '../src/json/events.json';

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
        // pregnancy's "not hasEvent pregnancy withinDays 300" is a runtime cooldown, not a static self-exclude.
        expect(graph.excludes['pregnancy']).not.toContain('pregnancy');
    });

    test('eligibility discriminants are extracted for the index', () => {
        expect(graph.indexKeys['pregnancy']).toEqual(expect.arrayContaining(['alive', 'gender', 'age']));
    });
});

describe('compileEvents — derived exclusivity', () => {
    test('an event whose effect sets a state to a different value excludes events requiring the other value', () => {
        const manifest: EventManifest = {
            become_married: {
                roles: { subject: { where: { attr: 'alive', op: '==', value: true } }, partner: { bind: 'partnerOf:subject' } },
                probability: { perYear: 0.1 },
                effects: [{ type: 'marry', role: 'partner' }],
            },
            single_club: {
                roles: { subject: { where: { attr: 'marital', op: '==', value: 'single' } } },
                probability: { perYear: 1 },
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
                probability: { perYear: 1 },
                effects: [],
            },
            never_kissed_award: {
                roles: { subject: { where: { not: { hasEvent: 'first_kiss' } } } }, // no withinDays ⇒ permanent
                probability: { perYear: 1 },
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
                probability: { perYear: 1 },
                effects: [],
            },
        };
        const graph = compileEvents(manifest);
        expect(graph.warnings.some(w => w.includes('ghost'))).toBe(true);
    });

    test('flags a dependency cycle but still returns every event in the order', () => {
        const manifest: EventManifest = {
            a: { roles: { subject: { where: { hasEvent: 'b' } } }, probability: { perYear: 1 }, effects: [] },
            b: { roles: { subject: { where: { hasEvent: 'a' } } }, probability: { perYear: 1 }, effects: [] },
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
