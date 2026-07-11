import { SchemaRegistration, ValidationIssue, assertValid, formatIssues, validateRegistrations, IssueCollector } from 'game/data/registry';
import { validateCurve, validatePredicate } from 'game/data/substrate';
import { validateEventsSemantics, validateEventsStructure } from 'game/data/validators/events';
import {
    validateBusinessesSemantics,
    validateBusinessesStructure,
    validateDemandSemantics,
    validateJobsSemantics,
    validateJobsStructure,
} from 'game/data/validators/economyContent';
import {
    validateSkillInitStructure,
    validateSkillsSemantics,
    validateSkillsStructure,
} from 'game/data/validators/skills';
import { validateHistoryGeneratorStructure, validateHouseholdDrawStructure, validatePopulationStructure } from 'game/data/validators/params';
import { validateObjectsSemantics, validateObjectsStructure } from 'game/data/validators/objects';
import { validatePlacementSemantics } from 'game/data/validators/placement';
import { validateActionsSemantics, validateActionsStructure } from 'game/data/validators/actions';
import { validateOarSemantics, validateOarStructure } from 'game/data/validators/oar';
import { validateAssetsStructure, validateInputStructure, validateToolAssetsSemantics, validateToolAssetsStructure } from 'game/data/validators/ui';
import { validateSchoolsSemantics, validateSchoolsStructure } from 'game/data/validators/school';
import { allRegistrations, validateAllData } from 'game/data/schemas';

import businessesConfig from 'json/businesses.json';
import schoolsConfig from 'json/schools.json';
import residencesConfig from 'json/residences.json';
import objectsConfig from 'json/objects.json';
import demandConfig from 'json/demand.json';
import jobsConfig from 'json/jobs.json';
import populationConfig from 'json/population.json';
import skillsConfig from 'json/skills.json';
import skillInitConfig from 'json/skillInit.json';

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
            'actions', 'assets', 'businesses', 'config', 'demand', 'economy',
            'events', 'historyGenerator', 'householdDraw', 'input', 'jobs', 'lifeSimulation', 'materials',
            'objectActionRelationships', 'objectGeneration', 'objects', 'placement', 'population', 'residences', 'schools', 'skillInit', 'skills', 'toolAssets',
        ]);
    });

    // Content-scale sanity floors carried over from test/contentConsistency.test.ts (tasks 034 + 033b).
    test('content sanity floors', () => {
        expect(Object.keys(businessesConfig).length).toBeGreaterThanOrEqual(15);
        expect(Object.keys(jobsConfig).length).toBeGreaterThanOrEqual(25);
        expect(Object.keys(demandConfig).length).toBeGreaterThanOrEqual(9);
    });

    // Objects backfill distribution guards (task 050): the archetype roster must stay big and varied enough
    // that wandering/pocketing/gifting actions always have material to work with.
    test('object archetype distribution', () => {
        const archetypes = Object.values(objectsConfig) as { category: string; flags: Record<string, boolean> }[];
        expect(archetypes.length).toBeGreaterThanOrEqual(1200);
        const categories = new Map<string, number>();
        let pocketable = 0;
        let carryable = 0;
        for (const archetype of archetypes) {
            categories.set(archetype.category, (categories.get(archetype.category) ?? 0) + 1);
            if (archetype.flags['pocketable']) pocketable += 1;
            if (archetype.flags['carryable']) carryable += 1;
        }
        expect(categories.size).toBeGreaterThanOrEqual(19); // every planning category populated
        for (const [category, count] of categories) {
            expect({ category, populated: count >= 10 }).toEqual({ category, populated: true });
        }
        expect(pocketable / archetypes.length).toBeGreaterThan(0.3); // pocketing material
        expect(carryable / archetypes.length).toBeGreaterThan(0.6); // possessions material
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

    test('an acquireSkill effect referencing a skill missing from the manifest is rejected', () => {
        const fixture = manifestWith({ bad: { roles: { subject: aliveSubject }, triggers: { probabilistic: { perYear: 1 } }, effects: [{ type: 'acquireSkill', value: 'ghost_skillname' }] } });
        expect(messagesOf(semantics(validateEventsSemantics, fixture, { skills: {} }))).toMatch(/unknown skill "ghost_skillname"/);
    });
});

// ---------- economy content family ----------

describe('jobs validation', () => {
    const jobBase = {
        title: 'X', salary: 1, requiredSkills: [], shiftStart: 540, shiftEnd: 1020,
        daysOfWeek: ['mon'], workActions: { continuous: [{ action: 'c' }], discrete: [{ action: 'd', chancePerTick: 0.2 }] },
    };

    test.each([
        ['a non-positive salary', { j: { ...jobBase, salary: 0 } }, /expected >= 1/],
        ['a shift outside the day', { j: { ...jobBase, shiftStart: 1500 } }, /expected <= 1439/],
        ['a missing shift (no more silent defaults)', { j: { ...jobBase, shiftEnd: undefined } }, /expected a number/],
        ['an unknown weekday', { j: { ...jobBase, daysOfWeek: ['monday'] } }, /expected one of \[mon, tue/],
        ['an empty weekday list', { j: { ...jobBase, daysOfWeek: [] } }, /at least one working day/],
        ['an empty work-action pool', { j: { ...jobBase, workActions: { continuous: [], discrete: [{ action: 'd' }] } } }, /at least one continuous work action/],
        ['an unknown key (typo)', { j: { ...jobBase, shfitEnd: 900 } }, /unknown key/],
    ])('structure rejects %s', (_label, fixture, pattern) => {
        expect(messagesOf(structure(validateJobsStructure, fixture))).toMatch(pattern);
    });

    test('semantics rejects unknown skills and dangling/mismatched work actions', () => {
        const fixture = {
            a: { ...jobBase, requiredSkills: ['NinjaSkill'] },
            b: { ...jobBase, requiredSkills: ['suture_wounds'], workActions: { continuous: [{ action: 'ghost' }], discrete: [{ action: 'a_cont' }] } },
        };
        const output = messagesOf(semantics(validateJobsSemantics, fixture, { skills: { suture_wounds: { label: 'Suture Wounds' } }, actions: { c: { type: 'continuous' }, d: { type: 'discrete' }, a_cont: { type: 'continuous' } } }));
        expect(output).toMatch(/unknown skill "NinjaSkill"/);
        expect(output).toMatch(/references unknown action "ghost"/);
        expect(output).toMatch(/"a_cont" is not a discrete action/);
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
    test('skills structure rejects legacy Skill-suffix names and field-of-study non-basics', () => {
        const legacy = { MedicalSkill: { label: 'Medical' } };
        expect(messagesOf(structure(validateSkillsStructure, legacy))).toMatch(/must not end in "Skill"/);
        const broad = { medicine: { label: 'Medicine' } };
        expect(messagesOf(structure(validateSkillsStructure, broad))).toMatch(/specific abilities/);
        const basicWithDeps = { biology: { label: 'Biology', basic: true, dependencies: [{ skill: 'math', minProficiency: 10 }] } };
        expect(messagesOf(structure(validateSkillsStructure, basicWithDeps))).toMatch(/no dependencies/);
    });

    test('skills semantics rejects cycles, missing dependencies, and orphan skills', () => {
        const cyclic = {
            weld_metal: { label: 'Weld Metal', dependencies: [{ skill: 'braze_joints', minProficiency: 10 }], tags: ['flavor'] },
            braze_joints: { label: 'Braze Joints', dependencies: [{ skill: 'weld_metal', minProficiency: 10 }], tags: ['flavor'] },
        };
        expect(messagesOf(semantics(validateSkillsSemantics, cyclic, {}))).toMatch(/cycle/);
        const missing = { weld_metal: { label: 'Weld Metal', dependencies: [{ skill: 'nonexistent', minProficiency: 10 }], tags: ['flavor'] } };
        expect(messagesOf(semantics(validateSkillsSemantics, missing, {}))).toMatch(/unknown dependency/);
        const orphan = { polish_doorknobs: { label: 'Polish Doorknobs' } };
        expect(messagesOf(semantics(validateSkillsSemantics, orphan, { jobs: {}, events: {} }))).toMatch(/orphan skill/);
    });

    test('skillInit structure and semantics reject bad milestones', () => {
        const badBand = JSON.parse(JSON.stringify(skillInitConfig)) as Record<string, unknown>;
        (badBand['assortment'] as { bands: { minSkills: number; maxSkills: number }[] }).bands[0]!.maxSkills = -1;
        expect(structure(validateSkillInitStructure, badBand).length).toBeGreaterThan(0);
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

    test('historyGenerator rejects a mismatched ticksPerYear', () => {
        const fixture = {
            seed: 1, founderCount: 100, recordThreshold: 1000, recordYears: 500, ticksPerYear: 100,
            daysPerStep: 1, warmMarginYears: 40, maxWarmupYears: 400, keepActionLog: false, skillSnapshotYears: 1, flushIntervalYears: 5,
            populationControl: { enabled: true, target: 2000, band: 0.05, suppressLevel: 0.1, allowLevel: 1 },
            logicalWorld: { enabled: true, homes: true, schools: true, jobs: true, objects: true },
            safety: { maxRuntimeMs: 0, maxPeople: 0 },
        };
        expect(messagesOf(structure(validateHistoryGeneratorStructure, fixture))).toMatch(/must equal the clock's TICKS_PER_YEAR/);
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

// ---------- object-action relationships ----------

describe('param-aware queries & event payloads validation (task 067)', () => {
    test('archetypeParam requirement refs must name a declared objectArchetype parameter', () => {
        const undeclared = { grab: { label: 'G', type: 'discrete', category: 'maintenance', requirements: { objectAtLocation: { archetypeParam: 'object' } } } };
        expect(messagesOf(semantics(validateActionsSemantics, undeclared, { events: {}, objects: {} }))).toMatch(/undeclared parameter/);
        const wrongType = { grab: { label: 'G', type: 'discrete', category: 'maintenance', parameters: { object: { type: 'person', required: true } }, requirements: { carries: { archetypeParam: 'object' } } } };
        expect(messagesOf(semantics(validateActionsSemantics, wrongType, { events: {}, objects: {} }))).toMatch(/must reference an objectArchetype parameter/);
    });

    test('archetype and archetypeParam are mutually exclusive in a query', () => {
        const both = { grab: { label: 'G', type: 'discrete', category: 'maintenance', parameters: { object: { type: 'objectArchetype' } }, requirements: { carries: { archetype: 'pencil', archetypeParam: 'object' } } } };
        expect(messagesOf(structure(validateActionsStructure, both))).toMatch(/mutually exclusive/);
    });

    test('a REQUIRED event parameter cannot coexist with a probabilistic trigger', () => {
        const fixture = manifestWith({ bad: { roles: { subject: aliveSubject }, triggers: { probabilistic: { perYear: 1 }, manual: {} }, parameters: { object: { type: 'string', required: true } }, effects: [] } });
        expect(messagesOf(structure(validateEventsStructure, fixture))).toMatch(/REQUIRED parameter cannot coexist/);
    });

    test('lifecycle payload mappings validate against both sides', () => {
        const fixture = { act: { label: 'A', type: 'discrete', category: 'maintenance', parameters: { object: { type: 'objectArchetype' } }, events: { onComplete: { event: 'evt', params: { object: '$params.ghost', rogue: 1 } } } } };
        const peers = { events: { evt: { triggers: { manual: {} }, parameters: { object: { type: 'string' } } } }, objects: {} };
        const output = messagesOf(semantics(validateActionsSemantics, fixture, peers));
        expect(output).toMatch(/undeclared action parameter "ghost"/);
        expect(output).toMatch(/declares no parameter "rogue"/);
    });
});

describe('object-action-relationships validation (task 044)', () => {
    const entry = {
        action: 'mix',
        inputs: [{ archetype: 'flour_bag', quantity: 1, disposition: 'consumed' }],
        outputs: [{ archetype: 'raw_dough', bindAs: 'output' }],
    };

    test('a well-formed entry passes', () => {
        expect(messagesOf(structure(validateOarStructure, { e: entry }))).toBe('');
    });

    test.each([
        ['an unknown disposition', { e: { ...entry, inputs: [{ archetype: 'x', disposition: 'burned' }] } }, /expected one of \[consumed, retained, transformed, required\]/],
        ['a transformed input without transformTo', { e: { ...entry, inputs: [{ archetype: 'x', disposition: 'transformed' }] } }, /transformTo/],
        ['transformTo on a non-transformed input', { e: { ...entry, inputs: [{ archetype: 'x', disposition: 'consumed', transformTo: { archetype: 'y' } }] } }, /only transformed inputs/],
        ['a zero quantity', { e: { ...entry, inputs: [{ archetype: 'x', quantity: 0, disposition: 'consumed' }] } }, /expected >= 1/],
        ['an empty entry', { e: { action: 'mix', inputs: [], outputs: [] } }, /at least one input or output/],
    ])('structure rejects %s', (_label, fixture, pattern) => {
        expect(messagesOf(structure(validateOarStructure, fixture))).toMatch(pattern);
    });

    test('semantics rejects dangling action/archetype refs and continuous actions', () => {
        const fixture = {
            bad: { action: 'ghost_action', inputs: [{ archetype: 'unobtainium', disposition: 'consumed' }], outputs: [{ archetype: 'phlebotinum' }] },
            alsoBad: { action: 'cont', inputs: [{ archetype: 'coin', disposition: 'required' }], outputs: [] },
        };
        const peers = {
            actions: { cont: { label: 'C', type: 'continuous', category: 'leisure' } },
            objects: { coin: {} },
        };
        const output = messagesOf(semantics(validateOarSemantics, fixture, peers));
        expect(output).toMatch(/references unknown action "ghost_action"/);
        expect(output).toMatch(/unknown object archetype "unobtainium"/);
        expect(output).toMatch(/unknown object archetype "phlebotinum"/);
        expect(output).toMatch(/"cont" is continuous/);
    });

    test('semantics rejects a targetPerson output on an action with no target parameter', () => {
        const fixture = { give: { action: 'craft', inputs: [], outputs: [{ archetype: 'coin', owner: 'targetPerson' }] } };
        const peers = { actions: { craft: { label: 'C', type: 'discrete', category: 'work' } }, objects: { coin: {} } };
        expect(messagesOf(semantics(validateOarSemantics, fixture, peers))).toMatch(/owner 'targetPerson' but action "craft" declares no "target" parameter/);
    });

    test('consequence ops in actions are validated (bad op kind, unknown event)', () => {
        const fixture = { a: { label: 'A', type: 'discrete', category: 'leisure', consequences: [{ op: 'summonObject', archetype: 'coin' }] } };
        expect(messagesOf(structure(validateActionsStructure, fixture))).toMatch(/expected one of \[createObject/);

        const semantic = { a: { label: 'A', type: 'discrete', category: 'leisure', consequences: [{ op: 'triggerEvent', event: 'ghost' }, { op: 'createObject', archetype: 'unreal' }] } };
        const output = messagesOf(semantics(validateActionsSemantics, semantic, { events: {}, objects: {} }));
        expect(output).toMatch(/references unknown event "ghost"/);
        expect(output).toMatch(/unknown object archetype "unreal"/);
    });

    test('moveObjectToPerson is validated structurally (only targetPerson; a real object ref)', () => {
        const bad = {
            a: { label: 'A', type: 'discrete', category: 'social', consequences: [
                { op: 'moveObjectToPerson', object: { carried: { tag: 'giftable' } }, target: 'employer' },
                { op: 'moveObjectToPerson', object: {}, target: 'targetPerson' },
                { op: 'moveObjectToPerson', object: { param: 'object' }, target: 'targetPerson', container: 'possessions' },
            ] },
        };
        const output = messagesOf(structure(validateActionsStructure, bad));
        expect(output).toMatch(/consequences\[0\]\.target: expected one of \[targetPerson\]/);
        expect(output).toMatch(/consequences\[1\]\.object: unrecognized object ref/);
        expect(output).toMatch(/consequences\[2\]\.container: unknown key/);
    });

    test('targetPerson ops require the action to declare a target parameter', () => {
        const semantic = {
            targetless: { label: 'T', type: 'discrete', category: 'social', consequences: [{ op: 'moveObjectToPerson', object: { carried: { tag: 'giftable' } }, target: 'targetPerson' }] },
            ok: { label: 'OK', type: 'discrete', category: 'social', parameters: { target: { type: 'person', required: true } }, consequences: [{ op: 'transferObject', object: { carried: { tag: 'giftable' } }, owner: 'targetPerson' }] },
        };
        const output = messagesOf(semantics(validateActionsSemantics, semantic, { events: {}, objects: {} }));
        expect(output).toMatch(/targetless\.consequences\[0\]: op references 'targetPerson' but the action declares no "target" parameter/);
        expect(output).not.toMatch(/^ok\./m);
    });

    test('pool children with required parameters are rejected (pools pass no params)', () => {
        const semantic = {
            hangout: { label: 'H', type: 'continuous', category: 'social', durationTicks: 2, children: { mode: 'pool', entries: [{ action: 'hand_over', chancePerTick: 0.5 }] } },
            hand_over: { label: 'HO', type: 'discrete', category: 'social', parameters: { target: { type: 'person', required: true } } },
        };
        const output = messagesOf(semantics(validateActionsSemantics, semantic, { events: {}, objects: {} }));
        expect(output).toMatch(/pool child "hand_over" declares required parameter\(s\) \[target\]/);

        // The same child bound through a SEQUENCE step is fine — steps bind params.
        const sequenced = {
            ...semantic,
            hangout: { label: 'H', type: 'continuous', category: 'social', durationTicks: 2, parameters: { target: { type: 'person', required: true } }, children: { mode: 'sequence', steps: [{ action: 'hand_over', params: { target: '$parent.target' } }] } },
        };
        expect(messagesOf(semantics(validateActionsSemantics, sequenced, { events: {}, objects: {} }))).toBe('');
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

describe('placement tags validation (task 069)', () => {
    test('dead tags and misplaced scopes are rejected', () => {
        const vocab = { tags: { kitchen: { label: 'Kitchen', scope: 'building' }, beach: { label: 'Beach', scope: 'deferred' } } };
        // kitchen carried by an object + a residence: clean. beach carried by an object only: clean (deferred).
        const objectsPeer = { pan: { placement: ['kitchen'], generation: { kind: 'reusable' } }, towel: { placement: ['beach'], generation: { kind: 'loose' } } };
        const clean = semantics(validatePlacementSemantics, vocab, { objects: objectsPeer, businesses: {}, residences: { house: { tags: ['kitchen'] } } });
        expect(clean).toEqual([]);

        // A tag no object carries is dead.
        const dead = semantics(validatePlacementSemantics, { tags: { attic: { label: 'A', scope: 'building' } } }, { objects: {}, businesses: {}, residences: { house: { tags: ['attic'] } } });
        expect(messagesOf(dead)).toMatch(/dead tag/);

        // A building carrying a deferred tag is rejected; a building-scoped tag on no building is rejected.
        const misplaced = semantics(validatePlacementSemantics, vocab, { objects: objectsPeer, businesses: { shack: { tags: ['beach'] } }, residences: {} });
        expect(messagesOf(misplaced)).toMatch(/deferred \(no building may carry it yet\)/);
        expect(messagesOf(misplaced)).toMatch(/appears on no blueprint\/residence/);
    });

    test('shipped coverage floors: nearly every archetype is placed, every blueprint and the house are tagged', () => {
        const objects = objectsConfig as Record<string, { placement?: string[] }>;
        const placed = Object.values(objects).filter(archetype => (archetype.placement?.length ?? 0) > 0).length;
        expect(placed / Object.keys(objects).length).toBeGreaterThan(0.9);
        const businesses = businessesConfig as Record<string, { tags?: string[] }>;
        for (const blueprint of Object.values(businesses)) {
            expect(blueprint.tags?.length ?? 0).toBeGreaterThan(0);
        }
        expect((residencesConfig as { house: { tags: string[] } }).house.tags.length).toBeGreaterThan(3);
    });

    test('objects semantics rejects unknown placement tags and placement/generation mismatches', () => {
        const vocabPeer = { placement: { tags: { kitchen: { label: 'K', scope: 'building' } } } };
        const unknown = { pan: { placement: ['ghost-room'], generation: { kind: 'reusable' } } };
        expect(messagesOf(semantics(validateObjectsSemantics, unknown, vocabPeer))).toMatch(/unknown placement tag/);
        const mismatch = { pan: { placement: ['kitchen'] } };
        expect(messagesOf(semantics(validateObjectsSemantics, mismatch, vocabPeer))).toMatch(/must come together/);
    });

    test('generation metadata bounds are enforced', () => {
        const bad = { pan: { label: 'Pan', category: 'kitchenware', size: { w: 10, d: 10, h: 5 }, weightGrams: 500,
            flags: { carryable: true, pocketable: false, stackable: false, consumable: false, equippable: false, placeable: true },
            placement: ['kitchen'], generation: { kind: 'reusable', minPerBuilding: 3, maxPerBuilding: 1 } } };
        expect(messagesOf(structure(validateObjectsStructure, bad))).toMatch(/must be >= minPerBuilding/);
        const uniqueBad = { pan: { ...bad.pan, generation: { kind: 'fixture', uniquePerBuilding: true, maxPerBuilding: 3 } } };
        expect(messagesOf(structure(validateObjectsStructure, uniqueBad))).toMatch(/uniquePerBuilding implies/);
    });
});

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

describe('schools validation (task 058)', () => {
    const valid = () => JSON.parse(JSON.stringify(schoolsConfig)) as Record<string, unknown>;
    // Minimal peers satisfying the semantic contract, so each fixture flips exactly one thing.
    const peers = () => ({
        actions: {
            attend_school: {
                type: 'continuous', category: 'obligation',
                completeWhen: { attr: 'hourOfDay', op: '>=', value: 14 },
                events: { onStart: 'school_day_started', onComplete: 'completed_school_day' },
            },
        },
        events: {
            school_day_started: { triggers: { manual: {} }, limit: { once: 'perDay' } },
            completed_school_day: {
                triggers: { manual: {}, automated: { rules: [{ afterEvent: 'school_day_started', delayTicks: 8 }] } },
                limit: { once: 'perDay' },
            },
        },
    });

    test('the shipped schools.json passes both validators', () => {
        expect(structure(validateSchoolsStructure, schoolsConfig)).toEqual([]);
        expect(semantics(validateSchoolsSemantics, schoolsConfig, peers())).toEqual([]);
    });

    test('weekend school days are rejected (v1 weekday-only contract)', () => {
        const data = valid();
        data['daysOfWeek'] = ['mon', 'sat'];
        expect(messagesOf(structure(validateSchoolsStructure, data))).toContain('weekend');
    });

    test('a school day must end after it starts, on an hour boundary', () => {
        const inverted = valid();
        inverted['dayStartMinutes'] = 900;
        expect(structure(validateSchoolsStructure, inverted).length).toBeGreaterThan(0);
        const ragged = valid();
        ragged['dayEndMinutes'] = 850;
        expect(messagesOf(structure(validateSchoolsStructure, ragged))).toContain('hour boundary');
    });

    test('a broken capacity curve or inverted age band is rejected', () => {
        const badCurve = valid();
        badCurve['capacity'] = { mode: 'nope' };
        expect(structure(validateSchoolsStructure, badCurve).length).toBeGreaterThan(0);
        const badAges = valid();
        badAges['minAgeYears'] = 12;
        badAges['maxAgeYears'] = 7;
        expect(messagesOf(structure(validateSchoolsStructure, badAges))).toContain('minAgeYears');
    });

    test('semantics: a drifted attend_school completeWhen is caught', () => {
        const drifted = peers();
        (drifted.actions.attend_school.completeWhen as { value: number }).value = 15;
        expect(messagesOf(semantics(validateSchoolsSemantics, schoolsConfig, drifted))).toContain('completeWhen');
    });

    test('semantics: missing school-day events or a missing automated fallback are caught', () => {
        const missing = peers();
        delete (missing.events as Record<string, unknown>)['completed_school_day'];
        expect(messagesOf(semantics(validateSchoolsSemantics, schoolsConfig, missing))).toContain('completed_school_day');

        const noFallback = peers();
        (noFallback.events.completed_school_day.triggers as Record<string, unknown>)['automated'] = { rules: [] };
        expect(messagesOf(semantics(validateSchoolsSemantics, schoolsConfig, noFallback))).toContain('fallback');
    });
});
