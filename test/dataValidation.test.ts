import { SchemaRegistration, ValidationIssue, assertValid, formatIssues, validateRegistrations, IssueCollector } from '../src/app/game/data/registry';
import { validateCurve, validatePredicate } from '../src/app/game/data/substrate';
import { validateEventsSemantics, validateEventsStructure } from '../src/app/game/data/validators/events';
import {
    validateBusinessesSemantics,
    validateBusinessesStructure,
    validateDemandSemantics,
    validateJobsSemantics,
    validateJobsStructure,
    validateSkillsSemantics,
    validateSkillsStructure,
} from '../src/app/game/data/validators/economyContent';
import { validateBootstrapStructure, validateHouseholdDrawStructure, validatePopulationStructure } from '../src/app/game/data/validators/params';
import { validateObjectsStructure } from '../src/app/game/data/validators/objects';
import { validateActionsSemantics, validateActionsStructure } from '../src/app/game/data/validators/actions';
import { validateAssetsStructure, validateInputStructure, validateToolAssetsSemantics, validateToolAssetsStructure } from '../src/app/game/data/validators/ui';
import { allRegistrations, validateAllData } from '../src/app/game/data/schemas';

import businessesConfig from '../src/json/businesses.json';
import demandConfig from '../src/json/demand.json';
import jobsConfig from '../src/json/jobs.json';
import populationConfig from '../src/json/population.json';
import skillsConfig from '../src/json/skills.json';

// ---------- harness ----------

// Runs one structural validator against a fixture and returns its issues.
function structure(validate: SchemaRegistration['validateStructure'], data: unknown): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    validate(data, new IssueCollector('fixture', issues));
    return issues;
}

// Runs one semantic validator with raw peer data (bypassing peers' own structural validation on purpose,
// so each fixture only exercises the validator under test).
function semantics(validate: NonNullable<SchemaRegistration['validateSemantics']>, data: unknown, peers: Record<string, unknown>): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    validate(data, peers, new IssueCollector('fixture', issues));
    return issues;
}

function messagesOf(issues: ValidationIssue[]): string {
    return issues.map(issue => `${issue.path}: ${issue.message}`).join('\n');
}

const aliveSubject = { where: { attr: 'alive', op: '==', value: true } };

// A structurally minimal, semantically clean event manifest to mutate per fixture.
function manifestWith(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
        base_event: { roles: { subject: aliveSubject }, triggers: { probabilistic: { perYear: 1 } }, effects: [] },
        ...overrides,
    };
}

const SKILLS_PEER = { skills: skillsConfig };

// ---------- the CI gate ----------

describe('data validation (task 039)', () => {
    test('every shipped data file passes the full registry', () => {
        const issues = validateAllData();
        expect(messagesOf(issues)).toBe('');
        expect(issues).toEqual([]);
    });

    test('all schemas are registered exactly once, with the expected roster', () => {
        const names = allRegistrations().map(registration => registration.name).sort();
        expect(names).toEqual([
            'actions', 'assets', 'bootstrap', 'businesses', 'config', 'demand', 'economy',
            'events', 'householdDraw', 'input', 'jobs', 'lifeSimulation', 'materials',
            'objects', 'population', 'skills', 'toolAssets',
        ]);
    });

    // Content-scale sanity floors carried over from test/contentConsistency.test.ts (tasks 034 + 033b).
    test('content sanity floors', () => {
        expect(Object.keys(businessesConfig).length).toBeGreaterThanOrEqual(15);
        expect(Object.keys(jobsConfig).length).toBeGreaterThanOrEqual(25);
        expect(Object.keys(demandConfig).length).toBeGreaterThanOrEqual(9);
    });
});

// ---------- registry mechanics ----------

describe('registry mechanics', () => {
    const noop = () => {};

    test('assertValid throws a formatted report listing every issue', () => {
        const bad: SchemaRegistration = {
            name: 'broken',
            data: {},
            validateStructure: (_, issues) => {
                issues.add('some.path', 'first problem');
                issues.add('other.path', 'second problem');
            },
        };
        expect(() => assertValid([bad])).toThrow(/2 issue\(s\)/);
        expect(() => assertValid([bad])).toThrow(/\[broken\] some\.path: first problem/);
    });

    test('semantic validators are skipped while any schema is structurally broken', () => {
        const semanticsSpy = jest.fn();
        const broken: SchemaRegistration = { name: 'broken', data: {}, validateStructure: (_, issues) => issues.add('', 'nope') };
        const dependent: SchemaRegistration = { name: 'dependent', data: {}, validateStructure: noop, validateSemantics: semanticsSpy };
        const issues = validateRegistrations([broken, dependent]);
        expect(issues).toHaveLength(1);
        expect(semanticsSpy).not.toHaveBeenCalled();
    });

    test('duplicate registrations are rejected', () => {
        const a: SchemaRegistration = { name: 'twice', data: {}, validateStructure: noop };
        const issues = validateRegistrations([a, { ...a }]);
        expect(messagesOf(issues)).toContain('duplicate schema registration');
    });

    test('formatIssues renders schema and path', () => {
        expect(formatIssues([{ schema: 's', path: 'p', message: 'm' }])).toContain('[s] p: m');
    });
});

// ---------- substrate: curves & predicates ----------

describe('curve validation', () => {
    test('accepts every shipped mode shape', () => {
        expect(structure((d, i) => validateCurve(i, 'c', d), { mode: 'logistic', floor: 1, ceiling: 24, midpoint: 5, steepness: 0.6 })).toEqual([]);
        expect(structure((d, i) => validateCurve(i, 'c', d), { mode: 'step', points: [{ at: 1, value: 1 }] })).toEqual([]);
    });

    test.each([
        ['unknown mode', { mode: 'cubic', value: 1 }, /expected one of/],
        ['missing required field', { mode: 'linear', base: 1 }, /perUnit/],
        ['unknown key (typo)', { mode: 'const', value: 1, vlaue: 2 }, /unknown key/],
        ['min above max', { mode: 'linear', base: 0, perUnit: 1, min: 5, max: 2 }, /min \(5\) must be <= max \(2\)/],
        ['empty step points', { mode: 'step', points: [] }, /at least one point/],
        ['non-numeric point', { mode: 'step', points: [{ at: 'young', value: 1 }] }, /expected a number/],
    ])('rejects %s', (_label, fixture, pattern) => {
        expect(messagesOf(structure((d, i) => validateCurve(i, 'c', d), fixture))).toMatch(pattern);
    });
});

describe('predicate validation', () => {
    const run = (fixture: unknown) => messagesOf(structure((d, i) => validatePredicate(i, 'p', d), fixture));

    test('accepts the shipped grammar', () => {
        expect(run({ all: [{ attr: 'age', op: '>=', value: 16 }, { not: { hasEvent: 'pregnancy', withinTicks: 300 } }] })).toBe('');
        expect(run({ attr: 'marital', op: 'in', value: ['single', 'divorced'] })).toBe('');
        expect(run({ role: 'partner', where: { attr: 'alive', op: '==', value: true } })).toBe('');
    });

    test.each([
        ['unknown op', { attr: 'age', op: '=>', value: 16 }, /expected one of/],
        ['ordered op with non-number', { attr: 'age', op: '>=', value: 'old' }, /requires a number/],
        ['"in" without an array', { attr: 'marital', op: 'in', value: 'single' }, /non-empty array/],
        ['equality with non-scalar', { attr: 'marital', op: '==', value: ['married'] }, /requires a scalar/],
        ['unrecognized shape', { has_event: 'death' }, /unrecognized predicate shape/],
        ['typo key on hasEvent', { hasEvent: 'death', withinDay: 3 }, /unknown key/],
        ['bad withinTicks', { hasEvent: 'death', withinTicks: 0 }, /expected >= 1/],
    ])('rejects %s', (_label, fixture, pattern) => {
        expect(run(fixture)).toMatch(pattern);
    });
});

// ---------- events ----------

describe('events validation', () => {
    const runStructure = (manifest: unknown) => messagesOf(structure(validateEventsStructure, manifest));
    const runSemantics = (manifest: unknown) => messagesOf(semantics(validateEventsSemantics, manifest, SKILLS_PEER));

    test.each([
        ['a typo’d effect kind', manifestWith({ bad: { roles: { subject: aliveSubject }, triggers: { probabilistic: { perYear: 1 } }, effects: [{ type: 'acquireSkil', value: 'MedicalSkill' }] } }), /expected one of \[setDeath/],
        ['an unknown top-level key', manifestWith({ bad: { roles: { subject: aliveSubject }, triggers: { probabilistic: { perYear: 1 } }, effects: [], trigger: {} } }), /unknown key/],
        ['a missing required effect field', manifestWith({ bad: { roles: { subject: aliveSubject }, triggers: { probabilistic: { perYear: 1 } }, effects: [{ type: 'emit' }] } }), /requires "signal"/],
        ['a non-subject role with neither where nor bind', manifestWith({ bad: { roles: { subject: aliveSubject, partner: {} }, triggers: { probabilistic: { perYear: 1 } }, effects: [] } }), /must declare "where".*or "bind"/],
        ['an unknown bind relation', manifestWith({ bad: { roles: { subject: aliveSubject, partner: { bind: 'siblingOf:subject' } }, triggers: { probabilistic: { perYear: 1 } }, effects: [] } }), /relation one of \[partnerOf\]/],
        ['an effect referencing an undeclared role', manifestWith({ bad: { roles: { subject: aliveSubject }, triggers: { probabilistic: { perYear: 1 } }, effects: [{ type: 'marry', role: 'partner' }] } }), /undeclared role "partner"/],
        ['a factor driver on an undeclared role', manifestWith({ bad: { roles: { subject: aliveSubject }, triggers: { probabilistic: { perYear: 1, factors: [{ driver: 'mother.age', curve: { mode: 'const', value: 1 } }] } }, effects: [] } }), /undeclared role "mother"/],
        ['a negative perYear', manifestWith({ bad: { roles: { subject: aliveSubject }, triggers: { probabilistic: { perYear: -1 } }, effects: [] } }), /expected >= 0/],
        ['a slot resource other than "job"', manifestWith({ bad: { roles: { subject: aliveSubject }, triggers: { probabilistic: { perYear: 1 } }, effects: [{ type: 'acquireSlot', resource: 'desk' }] } }), /only slot resource is "job"/],
    ])('structure rejects %s', (_label, fixture, pattern) => {
        expect(runStructure(fixture)).toMatch(pattern);
    });

    test.each([
        ['no trigger at all', manifestWith({ bad: { roles: { subject: aliveSubject }, triggers: {}, effects: [] } }), /at least one trigger type/],
        ['an everyDayOfWeek rule (gated until 045)', manifestWith({ bad: { roles: { subject: aliveSubject }, triggers: { automated: { rules: [{ everyDayOfWeek: 'monday' }] } }, effects: [] } }), /not supported until the day-of-week calendar/],
        ['an afterEvent referencing an unknown event', manifestWith({ bad: { roles: { subject: aliveSubject }, triggers: { automated: { rules: [{ afterEvent: 'ghost', delayTicks: 5 }] } }, effects: [] } }), /references unknown event "ghost"/],
        ['an out-of-range atHour', manifestWith({ bad: { roles: { subject: aliveSubject }, triggers: { automated: { rules: [{ atHour: 24 }] } }, effects: [] } }), /expected <= 23/],
        ['a reserved perJob limit scope', manifestWith({ bad: { roles: { subject: aliveSubject }, triggers: { manual: {} }, limit: { once: 'perJob' }, effects: [] } }), /reserved until jobs\/relationships/],
        ['a malformed limit', manifestWith({ bad: { roles: { subject: aliveSubject }, triggers: { manual: {} }, limit: { every: 3 }, effects: [] } }), /expected \{ once: \.\.\. \} or \{ withinTicks: n \}/],
        ['a manual requiredBinding naming an undeclared role', manifestWith({ bad: { roles: { subject: aliveSubject }, triggers: { manual: { requiredBindings: ['recipient'] } }, effects: [] } }), /undeclared role "recipient"/],
    ])('trigger structure rejects %s', (_label, fixture, pattern) => {
        expect(runStructure(fixture)).toMatch(pattern);
    });

    test.each([
        ['an unknown skill', manifestWith({ bad: { roles: { subject: aliveSubject }, triggers: { probabilistic: { perYear: 1 } }, effects: [{ type: 'acquireSkill', value: 'WizardrySkill' }] } }), /unknown skill "WizardrySkill"/],
        ['an unknown signal (nothing consumes it)', manifestWith({ bad: { roles: { subject: aliveSubject }, triggers: { probabilistic: { perYear: 1 } }, effects: [{ type: 'emit', signal: 'nobodyListens' }] } }), /unknown signal "nobodyListens"/],
        ['setAttr on an unknown attribute', manifestWith({ bad: { roles: { subject: aliveSubject }, triggers: { probabilistic: { perYear: 1 } }, effects: [{ type: 'setAttr', attr: 'charisma', value: 1 }] } }), /unknown attribute "charisma"/],
        ['a hasEvent prerequisite nothing provides (compiler warning promoted)', manifestWith({ bad: { roles: { subject: { where: { hasEvent: 'ghost_event' } } }, triggers: { probabilistic: { perYear: 1 } }, effects: [] } }), /requires unknown event "ghost_event"/],
    ])('semantics rejects %s', (_label, fixture, pattern) => {
        expect(runSemantics(fixture)).toMatch(pattern);
    });

    test('an unweighted (unassignable) skill is rejected even when the enum value exists', () => {
        const fixture = manifestWith({ bad: { roles: { subject: aliveSubject }, triggers: { probabilistic: { perYear: 1 } }, effects: [{ type: 'acquireSkill', value: 'MedicalSkill' }] } });
        const zeroWeightPeer = { skills: { weights: { MedicalSkill: 0 } } };
        expect(messagesOf(semantics(validateEventsSemantics, fixture, zeroWeightPeer))).toMatch(/no positive weight/);
    });
});

// ---------- economy content family ----------

describe('jobs validation', () => {
    test.each([
        ['a non-positive salary', { j: { title: 'X', salary: 0, requiredSkills: [] } }, /expected >= 1/],
        ['a shift outside the day', { j: { title: 'X', salary: 1, requiredSkills: [], shiftStart: 1500 } }, /expected <= 1439/],
        ['an unknown key (typo)', { j: { title: 'X', salary: 1, requiredSkills: [], shfitEnd: 900 } }, /unknown key/],
    ])('structure rejects %s', (_label, fixture, pattern) => {
        expect(messagesOf(structure(validateJobsStructure, fixture))).toMatch(pattern);
    });

    test('semantics rejects unknown and unweighted skills', () => {
        const fixture = { a: { title: 'A', salary: 1, requiredSkills: ['NinjaSkill'] }, b: { title: 'B', salary: 1, requiredSkills: ['MedicalSkill'] } };
        const output = messagesOf(semantics(validateJobsSemantics, fixture, { skills: { weights: {} } }));
        expect(output).toMatch(/unknown skill "NinjaSkill"/);
        expect(output).toMatch(/no positive weight.*unfillable/);
    });
});

describe('businesses validation', () => {
    const validBlueprint = {
        friendlyName: 'Shop', category: 'retail', size: { min: 1, max: 3 },
        jobs: { clerk: { count: { mode: 'const', value: 1 } } },
    };

    test.each([
        ['size min above max', { b: { ...validBlueprint, size: { min: 5, max: 2 } } }, /min \(5\) must be <= max \(2\)/],
        ['an empty jobs table', { b: { ...validBlueprint, jobs: {} } }, /at least one job/],
        ['a malformed count curve', { b: { ...validBlueprint, jobs: { clerk: { count: { mode: 'wavy' } } } } }, /expected one of/],
    ])('structure rejects %s', (_label, fixture, pattern) => {
        expect(messagesOf(structure(validateBusinessesStructure, fixture))).toMatch(pattern);
    });

    test('semantics rejects dangling refs and orphan products', () => {
        const fixture = {
            shop: { ...validBlueprint, category: 'nonsense', materialsPerUnit: { unobtainium: 1 }, products: { widgets: 2 } },
        };
        const peers = { jobs: {}, demand: {}, materials: { widgets: { label: 'W', basePrice: 1 } } };
        const output = messagesOf(semantics(validateBusinessesSemantics, fixture, peers));
        expect(output).toMatch(/jobs\.clerk: references a job not defined/);
        expect(output).toMatch(/unknown demand category "nonsense"/);
        expect(output).toMatch(/materialsPerUnit\.unobtainium: references a material not defined/);
        expect(output).toMatch(/products\.widgets: produced material is consumed by no blueprint/);
    });
});

describe('skills & demand validation', () => {
    test('skills structure rejects an inverted band range', () => {
        const fixture = { workingAgeYears: 16, adult: { minSkills: 3, maxSkills: 1 }, minor: { minSkills: 0, maxSkills: 1 }, weights: {} };
        expect(messagesOf(structure(validateSkillsStructure, fixture))).toMatch(/minSkills \(3\) must be <= maxSkills \(1\)/);
    });

    test('skills semantics rejects stale weight keys', () => {
        const fixture = { workingAgeYears: 16, adult: { minSkills: 1, maxSkills: 3 }, minor: { minSkills: 0, maxSkills: 1 }, weights: { AlchemySkill: 1 } };
        expect(messagesOf(semantics(validateSkillsSemantics, fixture, {}))).toMatch(/stale weight/);
    });

    test('demand semantics rejects a category no blueprint serves', () => {
        const fixture = { groceries: { perCapita: 1, throughputPerEmployee: 1, pricePerUnit: 1 } };
        expect(messagesOf(semantics(validateDemandSemantics, fixture, { businesses: {} }))).toMatch(/served by no business blueprint/);
    });
});

// ---------- params ----------

describe('params validation', () => {
    test('population rejects a ticksPerYear that diverges from the clock calendar', () => {
        const fixture = { ...(populationConfig as Record<string, unknown>), ticksPerYear: 365 };
        expect(messagesOf(structure(validatePopulationStructure, fixture))).toMatch(/must equal the clock's TICKS_PER_YEAR \(8640\)/);
    });

    test('population rejects a childDistribution that does not sum to 1', () => {
        const fixture = { ...(populationConfig as Record<string, unknown>), childDistribution: [0.5, 0.2] };
        expect(messagesOf(structure(validatePopulationStructure, fixture))).toMatch(/sum to 1/);
    });

    test('householdDraw rejects a drawable Homeless arrangement and unknown arrangements', () => {
        const fixture = { adultAgeYears: 18, maxRoommates: 3, arrangementWeights: { homeless: 0.1, commune: 0.2 } };
        const output = messagesOf(structure(validateHouseholdDrawStructure, fixture));
        expect(output).toMatch(/homeless: not a drawable arrangement/);
        expect(output).toMatch(/commune: not a drawable arrangement/);
    });

    test('bootstrap rejects a mismatched ticksPerYear', () => {
        const fixture = { enabled: true, years: 8, ticksPerYear: 100, stepDays: 7 };
        expect(messagesOf(structure(validateBootstrapStructure, fixture))).toMatch(/must equal the clock's TICKS_PER_YEAR/);
    });
});

// ---------- actions ----------

describe('actions validation (task 043)', () => {
    const discrete = { label: 'X', type: 'discrete', category: 'leisure' };
    const continuous = { label: 'Y', type: 'continuous', category: 'leisure', durationTicks: 2 };

    test('the starter shapes pass', () => {
        expect(messagesOf(structure(validateActionsStructure, { a: discrete, b: continuous }))).toBe('');
    });

    test.each([
        ['a discrete action with continuous-only fields', { a: { ...discrete, durationTicks: 3 } }, /only continuous actions/],
        ['an unknown category', { a: { ...discrete, category: 'mischief' } }, /expected one of/],
        ['a malformed location key', { a: { ...continuous, location: 'the park' } }, /canonical location key/],
        ['a bad children mode', { a: { ...continuous, children: { mode: 'swarm', entries: [] } } }, /expected one of \[pool, sequence\]/],
        ['an out-of-range pool chance', { a: { ...continuous, children: { mode: 'pool', entries: [{ action: 'b', chancePerTick: 2 }] } } }, /expected <= 1/],
        ['an unknown binding', { a: { ...continuous, children: { mode: 'sequence', steps: [{ action: 'b', params: { x: '$sibling.output' } }] } } }, /unknown binding/],
        ['a binding to an undeclared parent parameter', { a: { ...continuous, children: { mode: 'sequence', steps: [{ action: 'b', params: { x: '$parent.ghost' } }] } } }, /undeclared parent parameter "ghost"/],
    ])('structure rejects %s', (_label, fixture, pattern) => {
        expect(messagesOf(structure(validateActionsStructure, fixture))).toMatch(pattern);
    });

    test('semantics rejects dangling/continuous children and non-manual event links', () => {
        const fixture = {
            child_c: { ...continuous },
            parent: { ...continuous, children: { mode: 'pool', entries: [
                { action: 'ghost', chancePerTick: 0.5 },
                { action: 'child_c', chancePerTick: 0.5 },
            ] }, events: { onStart: 'no_such_event', onComplete: 'rolls_only' } },
        };
        const eventsPeer = { events: { rolls_only: { roles: {}, triggers: { probabilistic: { perYear: 1 } }, effects: [] } } };
        const output = messagesOf(semantics(validateActionsSemantics, fixture, eventsPeer));
        expect(output).toMatch(/references unknown action "ghost"/);
        expect(output).toMatch(/child actions must be discrete \(v1\); "child_c" is continuous/);
        expect(output).toMatch(/references unknown event "no_such_event"/);
        expect(output).toMatch(/does not declare a manual trigger/);
    });
});

// ---------- objects ----------

describe('objects validation (task 041)', () => {
    const base = {
        label: 'Widget', category: 'tool',
        size: { w: 5, d: 5, h: 5 }, weightGrams: 100,
        flags: { carryable: true, pocketable: true, stackable: false, consumable: false, equippable: false, placeable: false },
    };

    test('a well-formed archetype passes', () => {
        expect(messagesOf(structure(validateObjectsStructure, { widget: base }))).toBe('');
    });

    test.each([
        ['an unknown category', { widget: { ...base, category: 'contraband' } }, /unknown category/],
        ['pocketable without carryable', { widget: { ...base, flags: { ...base.flags, carryable: false, placeable: true } } }, /pocketable implies carryable/],
        ['a pocketable anvil', { widget: { ...base, weightGrams: 40000 } }, /pocketable items must weigh/],
        ['zero dimensions', { widget: { ...base, size: { w: 0, d: 5, h: 5 } } }, /expected >= 0.05/],
        ['a non-carryable, non-placeable object', { widget: { ...base, flags: { ...base.flags, carryable: false, pocketable: false } } }, /must at least be placeable/],
        ['an unknown key (typo)', { widget: { ...base, wieghtGrams: 5 } }, /unknown key/],
        ['a bad container spec', { widget: { ...base, container: { maxItems: 0 } } }, /expected >= 1/],
    ])('rejects %s', (_label, fixture, pattern) => {
        expect(messagesOf(structure(validateObjectsStructure, fixture))).toMatch(pattern);
    });
});

// ---------- ui manifests ----------

describe('ui manifest validation', () => {
    test('input rejects unknown tools and double-bound keys', () => {
        const fixture = { inputMappings: [{ key: 'F1', tool: 'terraform' }, { key: 'F1', tool: 'road' }] };
        const output = messagesOf(structure(validateInputStructure, fixture));
        expect(output).toMatch(/expected one of \[soil, road/);
        expect(output).toMatch(/key "F1" is bound twice/);
    });

    test('assets rejects duplicate keys', () => {
        const fixture = { baseURL: './sprites/', assets: [{ type: 'image', key: 'grass' }, { type: 'image', key: 'grass' }] };
        expect(messagesOf(structure(validateAssetsStructure, fixture))).toMatch(/duplicate asset key "grass"/);
    });

    test('toolAssets rejects unknown tools structurally and dangling sprite keys semantically', () => {
        expect(messagesOf(structure(validateToolAssetsStructure, { paint: 'grass' }))).toMatch(/unknown tool/);
        const output = messagesOf(semantics(validateToolAssetsSemantics, { soil: 'ghost_sprite' }, { assets: { assets: [{ key: 'grass' }] } }));
        expect(output).toMatch(/sprite key "ghost_sprite" is not in assets\.json/);
    });
});
