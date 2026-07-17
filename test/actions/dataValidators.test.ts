// Structural + semantic coverage for the data-schema validators that guard the Action system's own manifests
// (task 043/044): src/json/actions.json (game/data/validators/actions.ts), src/json/object-action-
// relationships.json (game/data/validators/oar.ts), and the shared substrate both build on — Curve and
// Predicate (game/data/substrate.ts). These validators ARE part of the actions domain: they are what makes a
// bad actions.json / OAR entry fail loudly at boot instead of silently misbehaving at runtime (CLAUDE.md
// §5.5). Mirrors the harness conventions of test/data/dataValidation.test.ts, but targeted at this module's
// own test project (test/actions/) since per-module coverage is measured per Jest project.

import { IssueCollector, SchemaRegistration, ValidationIssue, assertValid, formatIssues, validateRegistrations } from 'game/data/registry';
import { validateCurve, validatePredicate } from 'game/data/substrate';
import { validateActionsSemantics, validateActionsStructure } from 'game/data/validators/actions';
import {
    validateConsequenceOps,
    validateConsequenceOpsSemantics,
    validateOarSemantics,
    validateOarStructure,
} from 'game/data/validators/oar';
import actionsConfig from 'json/actions.json';
import eventsConfig from 'json/events.json';
import objectsConfig from 'json/objects.json';
import oarConfig from 'json/object-action-relationships.json';
import { EventManifest } from 'types/LifeEvent';

function structure(validate: SchemaRegistration['validateStructure'], data: unknown): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    validate(data, new IssueCollector('fixture', issues));
    return issues;
}

function semantics(validate: NonNullable<SchemaRegistration['validateSemantics']>, data: unknown, peers: Record<string, unknown>): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    validate(data, peers, new IssueCollector('fixture', issues));
    return issues;
}

function messagesOf(issues: ValidationIssue[]): string {
    return issues.map(issue => `${issue.path}: ${issue.message}`).join('\n');
}

// ---------- registry mechanics (the plumbing every validator above runs through) ----------

describe('registry mechanics', () => {
    test('assertValid throws a formatted, multi-issue report', () => {
        const bad: SchemaRegistration = {
            name: 'actionsFixture',
            data: {},
            validateStructure: (_, issues) => {
                issues.add('some.path', 'first problem');
                issues.add('other.path', 'second problem');
            },
        };
        expect(() => assertValid([bad])).toThrow(/2 issue\(s\)/);
        expect(() => assertValid([bad])).toThrow(/\[actionsFixture\] some\.path: first problem/);
        expect(formatIssues(validateRegistrations([bad]))).toContain('[actionsFixture] other.path: second problem');
    });

    test('a structurally clean registry runs semantic passes; a broken one skips them', () => {
        const clean: SchemaRegistration = { name: 'a', data: {}, validateStructure: () => {} };
        const semanticsSpy = jest.fn();
        const withSemantics: SchemaRegistration = { name: 'b', data: {}, validateStructure: () => {}, validateSemantics: semanticsSpy };
        expect(validateRegistrations([clean, withSemantics])).toEqual([]);
        expect(semanticsSpy).toHaveBeenCalledWith({}, { a: {}, b: {} }, expect.any(IssueCollector));

        const broken: SchemaRegistration = { name: 'broken', data: {}, validateStructure: (_, issues) => issues.add('', 'nope') };
        semanticsSpy.mockClear();
        validateRegistrations([broken, withSemantics]);
        expect(semanticsSpy).not.toHaveBeenCalled();
    });

    test('duplicate registrations are flagged without aborting the rest of the pass', () => {
        const a: SchemaRegistration = { name: 'twice', data: {}, validateStructure: () => {} };
        const issues = validateRegistrations([a, { ...a }]);
        expect(messagesOf(issues)).toContain('duplicate schema registration');
    });
});

// ---------- the shipped actions.json + object-action-relationships.json pass cleanly ----------

describe('shipped actions/OAR data', () => {
    test('the real actions.json manifest passes structural validation', () => {
        expect(messagesOf(structure(validateActionsStructure, actionsConfig))).toBe('');
    });

    test('the real object-action-relationships.json passes structural validation', () => {
        expect(messagesOf(structure(validateOarStructure, oarConfig))).toBe('');
    });
});

// ---------- substrate: curves & predicates (the grammar actions.requirements/completeWhen build on) ----------

describe('curve validation (substrate)', () => {
    const curve = (fixture: unknown) => structure((d, i) => validateCurve(i, 'c', d), fixture);

    test('every shipped curve mode validates clean', () => {
        expect(curve({ mode: 'const', value: 5 })).toEqual([]);
        expect(curve({ mode: 'linear', base: 1, perUnit: 2, min: 0, max: 10 })).toEqual([]);
        expect(curve({ mode: 'sqrt', base: 1, coeff: 2 })).toEqual([]);
        expect(curve({ mode: 'log', base: 1, coeff: 2 })).toEqual([]);
        expect(curve({ mode: 'logistic', floor: 0, ceiling: 10, midpoint: 5, steepness: 1 })).toEqual([]);
        expect(curve({ mode: 'step', points: [{ at: 0, value: 1 }, { at: 5, value: 2 }] })).toEqual([]);
    });

    test.each([
        ['not a record', 'nope', /expected an object/],
        ['missing mode', {}, /expected one of/],
        ['unknown mode', { mode: 'exp' }, /expected one of/],
        ['unknown key on a valid mode', { mode: 'const', value: 1, extra: true }, /unknown key/],
        ['missing required field (sqrt)', { mode: 'sqrt', base: 1 }, /coeff/],
        ['non-numeric min/max', { mode: 'const', value: 1, min: 'low' }, /expected a number/],
        ['min above max', { mode: 'const', value: 1, min: 5, max: 1 }, /min \(5\) must be <= max \(1\)/],
        ['step with a non-array points', { mode: 'step', points: 'bad' }, /expected an array/],
        ['step with zero points', { mode: 'step', points: [] }, /at least one point/],
        ['step point not a record', { mode: 'step', points: ['bad'] }, /expected an object/],
        ['step point unknown key', { mode: 'step', points: [{ at: 1, value: 1, label: 'x' }] }, /unknown key/],
        ['step point non-numeric', { mode: 'step', points: [{ at: 'x', value: 1 }] }, /expected a number/],
    ])('rejects %s', (_label, fixture, pattern) => {
        expect(messagesOf(curve(fixture))).toMatch(pattern);
    });
});

describe('predicate validation (substrate)', () => {
    const predicate = (fixture: unknown) => structure((d, i) => validatePredicate(i, 'p', d), fixture);

    test('every shipped predicate shape validates clean, including role refs', () => {
        expect(predicate({ all: [{ attr: 'age', op: '>=', value: 16 }, { any: [{ attr: 'alive', op: '==', value: true }] }] })).toEqual([]);
        expect(predicate({ not: { attr: 'alive', op: '==', value: false } })).toEqual([]);
        expect(predicate({ hasEvent: 'pregnancy', role: 'subject', withinTicks: 300, minCount: 1 })).toEqual([]);
        expect(predicate({ hasAction: 'stretch', minCount: 2 })).toEqual([]);
        expect(predicate({ carries: { archetype: 'pencil' } })).toEqual([]);
        expect(predicate({ carries: { tag: 'giftable' } })).toEqual([]);
        expect(predicate({ objectAtLocation: { flag: 'pocketable' } })).toEqual([]);
        expect(predicate({ objectAtLocation: { archetypeParam: 'object' } })).toEqual([]);
        expect(predicate({ role: 'partner', where: { attr: 'alive', op: '==', value: true } })).toEqual([]);
        expect(predicate({ attr: 'marital', op: 'in', value: ['single', 'divorced'] })).toEqual([]);

        const roleRefs: { role: string; path: string }[] = [];
        structure((d, i) => validatePredicate(i, 'p', d, (role, path) => roleRefs.push({ role, path })),
            { role: 'partner', where: { hasEvent: 'married', role: 'subject' } });
        expect(roleRefs).toEqual([{ role: 'partner', path: 'p.role' }, { role: 'subject', path: 'p.where.role' }]);
    });

    test.each([
        ['not a record', 42, /expected an object/],
        ['unknown shape', { mystery: true }, /unrecognized predicate shape/],
        ['all/any unknown key', { all: [], extra: 1 }, /unknown key/],
        ['all with a non-array', { all: 'bad' }, /expected an array/],
        ['not with unknown key', { not: {}, extra: 1 }, /unknown key/],
        ['hasEvent unknown key (typo)', { hasEvent: 'death', withinDay: 3 }, /unknown key/],
        ['hasEvent non-string', { hasEvent: 5 }, /expected a string/],
        ['hasEvent bad withinTicks', { hasEvent: 'death', withinTicks: 0 }, /expected >= 1/],
        ['hasEvent bad minCount', { hasEvent: 'death', minCount: 0 }, /expected >= 1/],
        ['carries/objectAtLocation unknown key', { carries: { archetype: 'x' }, extra: 1 }, /unknown key/],
        ['object query not a record', { carries: 'bad' }, /expected an object/],
        ['object query unknown key', { carries: { archetype: 'x', color: 'red' } }, /unknown key/],
        ['object query with no discriminant', { carries: {} }, /at least one of archetype\/tag\/flag\/archetypeParam/],
        ['object query archetype + archetypeParam conflict', { carries: { archetype: 'x', archetypeParam: 'y' } }, /mutually exclusive/],
        ['object query non-string field', { carries: { archetype: 5 } }, /expected a string/],
        ['where unknown key', { role: 'p', where: { attr: 'alive', op: '==', value: true }, extra: 1 }, /unknown key/],
        ['where non-string role', { role: 5, where: { attr: 'alive', op: '==', value: true } }, /expected a string/],
        ['attr unknown key', { attr: 'age', op: '>=', value: 1, extra: 1 }, /unknown key/],
        ['attr non-string', { attr: 5, op: '==', value: 1 }, /expected a string/],
        ['attr unknown op', { attr: 'age', op: '=>', value: 1 }, /expected one of/],
        ['attr "in" without an array', { attr: 'marital', op: 'in', value: 'single' }, /non-empty array/],
        ['attr "in" with a non-scalar element', { attr: 'marital', op: 'in', value: [{}] }, /non-empty array/],
        ['attr equality with a non-scalar', { attr: 'marital', op: '==', value: ['married'] }, /requires a scalar/],
        ['attr ordered op with a non-number', { attr: 'age', op: '>=', value: 'old' }, /requires a number/],
    ])('rejects %s', (_label, fixture, pattern) => {
        expect(messagesOf(predicate(fixture))).toMatch(pattern);
    });
});

// ---------- actions.json structural validation ----------

describe('actions structural validation', () => {
    const discrete = { label: 'X', type: 'discrete', category: 'leisure' };
    const continuous = { label: 'Y', type: 'continuous', category: 'leisure', durationTicks: 2 };

    test('minimal discrete/continuous shapes pass', () => {
        expect(messagesOf(structure(validateActionsStructure, { a: discrete, b: continuous }))).toBe('');
    });

    test('an empty label and a null value are both described correctly', () => {
        expect(messagesOf(structure(validateActionsStructure, { a: { ...discrete, label: '' } }))).toMatch(/expected a non-empty string/);
        expect(messagesOf(structure(validateActionsStructure, { a: { ...discrete, label: null } }))).toMatch(/expected a string, got null/);
    });

    test.each([
        ['top-level data not a record', ['nope'], /expected an object/],
        ['an action entry not a record', { a: 'nope' }, /expected an object/],
        ['a discrete action with continuous-only fields', { a: { ...discrete, location: 'home' } }, /only continuous actions/],
        ['an unknown category', { a: { ...discrete, category: 'mischief' } }, /expected one of/],
        ['a bad requirements predicate', { a: { ...discrete, requirements: { bogus: true } } }, /unrecognized predicate shape/],
        ['a parameter spec not a record', { a: { ...discrete, parameters: { x: 'bad' } } }, /expected an object/],
        ['a parameter with an unknown key', { a: { ...discrete, parameters: { x: { type: 'string', label: 'X' } } } }, /unknown key/],
        ['a parameter with an unknown type', { a: { ...discrete, parameters: { x: { type: 'widget' } } } }, /expected one of/],
        ['a selection with an unknown key', { a: { ...continuous, selection: { priority: 1 } } }, /unknown key/],
        ['a negative selection weight', { a: { ...continuous, selection: { weight: -1 } } }, /expected >= 0/],
        ['a fractional cooldownTicks', { a: { ...continuous, selection: { cooldownTicks: 1.5 } } }, /expected an integer/],
        ['selection.modifiers not an array', { a: { ...continuous, selection: { modifiers: 'bad' } } }, /expected an array/],
        ['a modifier entry not a record', { a: { ...continuous, selection: { modifiers: ['bad'] } } }, /expected an object/],
        ['a modifier with an unknown key', { a: { ...continuous, selection: { modifiers: [{ when: { attr: 'age', op: '>=', value: 1 }, multiply: 2, weight: 1 }] } } }, /unknown key/],
        ['a modifier with a negative multiply', { a: { ...continuous, selection: { modifiers: [{ when: { attr: 'age', op: '>=', value: 1 }, multiply: -1 }] } } }, /expected >= 0/],
        ['a malformed location key', { a: { ...continuous, location: 'the park' } }, /canonical location key/],
        ['a fractional durationTicks', { a: { ...continuous, durationTicks: 1.5 } }, /expected an integer/],
        ['a bad completeWhen predicate', { a: { ...continuous, completeWhen: { bogus: true } } }, /unrecognized predicate shape/],
        ['children not a record', { a: { ...continuous, children: 'bad' } }, /expected an object/],
        ['a bad children mode', { a: { ...continuous, children: { mode: 'swarm', entries: [] } } }, /expected one of \[pool, sequence\]/],
        ['pool entries not an array', { a: { ...continuous, children: { mode: 'pool', entries: 'bad' } } }, /expected an array/],
        ['pool with zero entries', { a: { ...continuous, children: { mode: 'pool', entries: [] } } }, /at least one entry/],
        ['pool entry not a record', { a: { ...continuous, children: { mode: 'pool', entries: ['bad'] } } }, /expected an object/],
        ['pool entry unknown key', { a: { ...continuous, children: { mode: 'pool', entries: [{ action: 'b', chancePerTick: 0.5, weight: 1 }] } } }, /unknown key/],
        ['an out-of-range pool chance', { a: { ...continuous, children: { mode: 'pool', entries: [{ action: 'b', chancePerTick: 2 }] } } }, /expected <= 1/],
        ['pool entry fractional maxPerTick', { a: { ...continuous, children: { mode: 'pool', entries: [{ action: 'b', chancePerTick: 0.5, maxPerTick: 1.5 }] } } }, /expected an integer/],
        ['pool entry bad requirements', { a: { ...continuous, children: { mode: 'pool', entries: [{ action: 'b', chancePerTick: 0.5, requirements: { bogus: true } }] } } }, /unrecognized predicate shape/],
        ['sequence with a bad onStepFailure', { a: { ...continuous, children: { mode: 'sequence', onStepFailure: 'giveUp', steps: [{ action: 'b' }] } } }, /expected one of/],
        ['sequence steps not an array', { a: { ...continuous, children: { mode: 'sequence', steps: 'bad' } } }, /expected an array/],
        ['sequence with zero steps', { a: { ...continuous, children: { mode: 'sequence', steps: [] } } }, /at least one step/],
        ['sequence step not a record', { a: { ...continuous, children: { mode: 'sequence', steps: ['bad'] } } }, /expected an object/],
        ['sequence step unknown key', { a: { ...continuous, children: { mode: 'sequence', steps: [{ action: 'b', label: 'x' }] } } }, /unknown key/],
        ['sequence step params not a record', { a: { ...continuous, children: { mode: 'sequence', steps: [{ action: 'b', params: 'bad' }] } } }, /expected an object/],
        ['an unknown binding', { a: { ...continuous, children: { mode: 'sequence', steps: [{ action: 'b', params: { x: '$sibling.output' } }] } } }, /unknown binding/],
        ['a binding to an undeclared parent parameter', { a: { ...continuous, children: { mode: 'sequence', steps: [{ action: 'b', params: { x: '$parent.ghost' } }] } } }, /undeclared parent parameter "ghost"/],
        ['a non-scalar, non-binding step param', { a: { ...continuous, children: { mode: 'sequence', steps: [{ action: 'b', params: { x: {} } }] } } }, /scalars or bindings/],
        ['a $previous.output binding is accepted', { a: { ...continuous, children: { mode: 'sequence', steps: [{ action: 'b', params: { x: '$previous.output' } }] } } }, undefined],
        ['bad consequences (delegated to oar.ts)', { a: { ...discrete, consequences: [{ op: 'summonObject' }] } }, /expected one of \[createObject/],
        ['events with an unknown key', { a: { ...discrete, events: { onStart: 'e', trigger: {} } } }, /unknown key/],
        ['an event hook not a string or record', { a: { ...discrete, events: { onStart: 123 } } }, /expected an object/],
        ['an event object-form with an unknown key', { a: { ...discrete, events: { onStart: { event: 'e', delay: 1 } } } }, /unknown key/],
        ['an event object-form missing "event"', { a: { ...discrete, events: { onStart: {} } } }, /expected a string/],
        ['an event payload with a non-scalar mapping', { a: { ...discrete, events: { onStart: { event: 'e', params: { x: {} } } } } }, /scalars or \$params refs/],
    ])('rejects %s', (_label, fixture, pattern) => {
        const output = messagesOf(structure(validateActionsStructure, fixture));
        if (pattern) {
            expect(output).toMatch(pattern);
        } else {
            expect(output).toBe('');
        }
    });

    test('a person-typed parameter requires an interaction contract', () => {
        const fixture = { a: { ...discrete, parameters: { target: { type: 'person', required: true } } } };
        expect(messagesOf(structure(validateActionsStructure, fixture))).toMatch(/must declare its interaction contract/);
    });

    describe('interaction contract shapes', () => {
        const withTarget = (interaction: Record<string, unknown>) => ({
            a: { ...discrete, parameters: { target: { type: 'person', required: true } }, interaction },
        });

        test('a well-formed contract passes', () => {
            expect(messagesOf(structure(validateActionsStructure,
                withTarget({ targetParam: 'target', requiresSameBuilding: true, askFirst: true, allowSelf: false, onDecline: 'skipStep' })))).toBe('');
        });

        test.each([
            ['unknown key', { targetParam: 'target', requiresSameBuilding: true, askFirst: true, remote: true }, /unknown key/],
            ['targetParam not declared as a person param', { targetParam: 'ghost', requiresSameBuilding: true, askFirst: true }, /must name a declared person-typed parameter/],
            ['requiresSameBuilding false is rejected (no remote interaction yet)', { targetParam: 'target', requiresSameBuilding: false, askFirst: true }, /must be true/],
            ['requiresSameBuilding non-boolean', { targetParam: 'target', requiresSameBuilding: 'yes', askFirst: true }, /expected a boolean/],
            ['askFirst non-boolean', { targetParam: 'target', requiresSameBuilding: true, askFirst: 'yes' }, /expected a boolean/],
            ['allowSelf non-boolean', { targetParam: 'target', requiresSameBuilding: true, askFirst: true, allowSelf: 'yes' }, /expected a boolean/],
            ['onDecline unknown value', { targetParam: 'target', requiresSameBuilding: true, askFirst: true, onDecline: 'shrug' }, /expected one of/],
        ])('rejects %s', (_label, interaction, pattern) => {
            expect(messagesOf(structure(validateActionsStructure, withTarget(interaction)))).toMatch(pattern);
        });
    });
});

// ---------- actions.json semantic validation ----------

describe('actions semantic validation', () => {
    const continuous = { label: 'Y', type: 'continuous', category: 'leisure', durationTicks: 2 };

    test('semantics rejects dangling/continuous children and non-manual event links', () => {
        const fixture = {
            child_c: { ...continuous },
            parent: {
                ...continuous,
                children: { mode: 'pool', entries: [{ action: 'ghost', chancePerTick: 0.5 }, { action: 'child_c', chancePerTick: 0.5 }] },
                events: { onStart: 'no_such_event', onComplete: 'rolls_only' },
            },
        };
        const eventsPeer = { events: { rolls_only: { roles: {}, triggers: { probabilistic: { perYear: 1 } }, effects: [] } } };
        const output = messagesOf(semantics(validateActionsSemantics, fixture, eventsPeer));
        expect(output).toMatch(/references unknown action "ghost"/);
        expect(output).toMatch(/child actions must be discrete \(v1\); "child_c" is continuous/);
        expect(output).toMatch(/references unknown event "no_such_event"/);
        expect(output).toMatch(/does not declare a manual trigger/);
    });

    test('sequence child refs are validated the same way as pool child refs', () => {
        const fixture = {
            parent: { ...continuous, children: { mode: 'sequence', steps: [{ action: 'ghost' }] } },
        };
        expect(messagesOf(semantics(validateActionsSemantics, fixture, { events: {} }))).toMatch(/references unknown action "ghost"/);
    });

    test('archetypeParam requirement refs must name a declared objectArchetype parameter', () => {
        const undeclared = { grab: { label: 'G', type: 'discrete', category: 'maintenance', requirements: { objectAtLocation: { archetypeParam: 'object' } } } };
        expect(messagesOf(semantics(validateActionsSemantics, undeclared, { events: {}, objects: {} }))).toMatch(/undeclared parameter/);
        const wrongType = { grab: { label: 'G', type: 'discrete', category: 'maintenance', parameters: { object: { type: 'person', required: true } }, requirements: { carries: { archetypeParam: 'object' } } } };
        expect(messagesOf(semantics(validateActionsSemantics, wrongType, { events: {}, objects: {} }))).toMatch(/must reference an objectArchetype parameter/);
        const declared = { grab: { label: 'G', type: 'discrete', category: 'maintenance', parameters: { object: { type: 'objectArchetype' } }, requirements: { objectAtLocation: { archetypeParam: 'object' } } } };
        expect(messagesOf(semantics(validateActionsSemantics, declared, { events: {}, objects: {} }))).toBe('');
    });

    test('an onDecline event link requires the action to actually ask first', () => {
        const fixture = {
            a: {
                label: 'A', type: 'discrete', category: 'social',
                parameters: { target: { type: 'person', required: true } },
                interaction: { targetParam: 'target', requiresSameBuilding: true, askFirst: false },
                events: { onDecline: 'nope_event' },
            },
        };
        expect(messagesOf(semantics(validateActionsSemantics, fixture, { events: { nope_event: { triggers: { manual: {} } } } })))
            .toMatch(/declares a decline event but the action is not askFirst/);
    });

    test('pool children with required parameters are rejected (pools pass no params); sequence steps are fine', () => {
        const semantic = {
            hangout: { label: 'H', type: 'continuous', category: 'social', durationTicks: 2, children: { mode: 'pool', entries: [{ action: 'hand_over', chancePerTick: 0.5 }] } },
            hand_over: { label: 'HO', type: 'discrete', category: 'social', parameters: { target: { type: 'person', required: true } } },
        };
        expect(messagesOf(semantics(validateActionsSemantics, semantic, { events: {}, objects: {} })))
            .toMatch(/pool child "hand_over" declares required parameter\(s\) \[target\]/);

        const sequenced = {
            ...semantic,
            hangout: { label: 'H', type: 'continuous', category: 'social', durationTicks: 2, parameters: { target: { type: 'person', required: true } }, children: { mode: 'sequence', steps: [{ action: 'hand_over', params: { target: '$parent.target' } }] } },
        };
        expect(messagesOf(semantics(validateActionsSemantics, sequenced, { events: {}, objects: {} }))).toBe('');
    });

    test('lifecycle payload mappings validate against both the action and event parameter sets', () => {
        const fixture = { act: { label: 'A', type: 'discrete', category: 'maintenance', parameters: { object: { type: 'objectArchetype' } }, events: { onComplete: { event: 'evt', params: { object: '$params.ghost', rogue: 1 } } } } };
        const peers = { events: { evt: { triggers: { manual: {} }, parameters: { object: { type: 'string' } } } }, objects: {} };
        const output = messagesOf(semantics(validateActionsSemantics, fixture, peers));
        expect(output).toMatch(/undeclared action parameter "ghost"/);
        expect(output).toMatch(/declares no parameter "rogue"/);
    });

    test('a valid, fully-wired lifecycle event link is clean', () => {
        const fixture = { act: { label: 'A', type: 'discrete', category: 'maintenance', parameters: { object: { type: 'objectArchetype' } }, events: { onComplete: { event: 'evt', params: { object: '$params.object' } } } } };
        const peers = { events: { evt: { triggers: { manual: {} }, parameters: { object: { type: 'string' } } } }, objects: {} };
        expect(messagesOf(semantics(validateActionsSemantics, fixture, peers))).toBe('');
    });

    test('consequence ops are semantically validated through the shared checker', () => {
        const semantic = { a: { label: 'A', type: 'discrete', category: 'leisure', consequences: [{ op: 'triggerEvent', event: 'ghost' }, { op: 'createObject', archetype: 'unreal' }] } };
        const output = messagesOf(semantics(validateActionsSemantics, semantic, { events: {}, objects: {} }));
        expect(output).toMatch(/references unknown event "ghost"/);
        expect(output).toMatch(/unknown object archetype "unreal"/);
    });

    test('the real actions.json manifest passes semantic validation against its real peers', () => {
        expect(messagesOf(semantics(validateActionsSemantics, actionsConfig, { events: eventsConfig, objects: objectsConfig }))).toBe('');
    });
});

// ---------- object-action-relationships.json (task 044) ----------

describe('object-action-relationship structural validation', () => {
    const entry = {
        action: 'mix',
        inputs: [{ archetype: 'flour_bag', quantity: 1, disposition: 'consumed' }],
        outputs: [{ archetype: 'raw_dough', bindAs: 'output' }],
    };

    test('a well-formed entry passes', () => {
        expect(messagesOf(structure(validateOarStructure, { e: entry }))).toBe('');
    });

    test.each([
        ['top-level data not a record', ['nope'], /expected an object/],
        ['an entry not a record', { e: 'nope' }, /expected an object/],
        ['an entry with an unknown key', { e: { ...entry, note: 'x' } }, /unknown key/],
        ['a non-string action', { e: { ...entry, action: 5 } }, /expected a string/],
        ['inputs not an array', { e: { ...entry, inputs: 'bad' } }, /expected an array/],
        ['an input not a record', { e: { ...entry, inputs: ['bad'] } }, /expected an object/],
        ['an input with an unknown key', { e: { ...entry, inputs: [{ archetype: 'x', disposition: 'consumed', note: 'y' }] } }, /unknown key/],
        ['a non-string input archetype', { e: { ...entry, inputs: [{ archetype: 5, disposition: 'consumed' }] } }, /expected a string/],
        ['a zero input quantity', { e: { ...entry, inputs: [{ archetype: 'x', quantity: 0, disposition: 'consumed' }] } }, /expected >= 1/],
        ['an unknown disposition', { e: { ...entry, inputs: [{ archetype: 'x', disposition: 'burned' }] } }, /expected one of \[consumed, retained, transformed, required\]/],
        ['a transformed input without transformTo', { e: { ...entry, inputs: [{ archetype: 'x', disposition: 'transformed' }] } }, /transformTo/],
        ['transformTo not a record', { e: { ...entry, inputs: [{ archetype: 'x', disposition: 'transformed', transformTo: 'bad' }] } }, /expected an object/],
        ['transformTo with an unknown key', { e: { ...entry, inputs: [{ archetype: 'x', disposition: 'transformed', transformTo: { archetype: 'y', note: 'z' } }] } }, /unknown key/],
        ['transformTo missing archetype', { e: { ...entry, inputs: [{ archetype: 'x', disposition: 'transformed', transformTo: {} }] } }, /expected a string/],
        ['transformTo on a non-transformed input', { e: { ...entry, inputs: [{ archetype: 'x', disposition: 'consumed', transformTo: { archetype: 'y' } }] } }, /only transformed inputs/],
        ['outputs not an array', { e: { ...entry, outputs: 'bad' } }, /expected an array/],
        ['an output not a record', { e: { ...entry, outputs: ['bad'] } }, /expected an object/],
        ['an output with an unknown key', { e: { ...entry, outputs: [{ archetype: 'x', note: 'y' }] } }, /unknown key/],
        ['a non-string output archetype', { e: { ...entry, outputs: [{ archetype: 5 }] } }, /expected a string/],
        ['a zero output quantity', { e: { ...entry, outputs: [{ archetype: 'x', quantity: 0 }] } }, /expected >= 1/],
        ['an unknown output owner', { e: { ...entry, outputs: [{ archetype: 'x', owner: 'thief' }] } }, /expected one of/],
        ['an unknown output container', { e: { ...entry, outputs: [{ archetype: 'x', container: 'pocket' }] } }, /expected one of \[possessions, location\]/],
        ['an empty entry (no inputs or outputs)', { e: { action: 'mix', inputs: [], outputs: [] } }, /at least one input or output/],
        ['context not a record', { e: { ...entry, context: 'bad' } }, /expected an object/],
        ['context with an unknown key', { e: { ...entry, context: { objectAtLocation: { archetype: 'oven' }, note: 'x' } } }, /unknown key/],
        ['context.objectAtLocation with no discriminant', { e: { ...entry, context: { objectAtLocation: {} } } }, /at least one of archetype\/tag\/flag\/archetypeParam/],
    ])('rejects %s', (_label, fixture, pattern) => {
        expect(messagesOf(structure(validateOarStructure, fixture))).toMatch(pattern);
    });

    test('a well-formed context passes', () => {
        expect(messagesOf(structure(validateOarStructure, { e: { ...entry, context: { objectAtLocation: { tag: 'kitchen' } } } }))).toBe('');
    });
});

describe('object-action-relationship semantic validation', () => {
    test('dangling action/archetype refs and continuous actions are rejected', () => {
        const fixture = {
            bad: { action: 'ghost_action', inputs: [{ archetype: 'unobtainium', disposition: 'consumed' }], outputs: [{ archetype: 'phlebotinum' }] },
            alsoBad: { action: 'cont', inputs: [{ archetype: 'coin', disposition: 'required' }], outputs: [] },
        };
        const peers = { actions: { cont: { label: 'C', type: 'continuous', category: 'leisure' } }, objects: { coin: {} } };
        const output = messagesOf(semantics(validateOarSemantics, fixture, peers));
        expect(output).toMatch(/references unknown action "ghost_action"/);
        expect(output).toMatch(/unknown object archetype "unobtainium"/);
        expect(output).toMatch(/unknown object archetype "phlebotinum"/);
        expect(output).toMatch(/"cont" is continuous/);
    });

    test('a transformTo archetype must also be declared', () => {
        const fixture = { e: { action: 'mix', inputs: [{ archetype: 'flour', disposition: 'transformed', transformTo: { archetype: 'ghost_dough' } }], outputs: [] } };
        const peers = { actions: { mix: { label: 'M', type: 'discrete', category: 'maintenance' } }, objects: { flour: {} } };
        expect(messagesOf(semantics(validateOarSemantics, fixture, peers))).toMatch(/references unknown object archetype "ghost_dough"/);
    });

    test('a targetPerson output requires the action to declare a "target" parameter', () => {
        const fixture = { give: { action: 'craft', inputs: [], outputs: [{ archetype: 'coin', owner: 'targetPerson' }] } };
        const peers = { actions: { craft: { label: 'C', type: 'discrete', category: 'work' } }, objects: { coin: {} } };
        expect(messagesOf(semantics(validateOarSemantics, fixture, peers))).toMatch(/owner 'targetPerson' but action "craft" declares no "target" parameter/);

        const okPeers = { actions: { craft: { label: 'C', type: 'discrete', category: 'work', parameters: { target: { type: 'person', required: true } } } }, objects: { coin: {} } };
        expect(messagesOf(semantics(validateOarSemantics, fixture, okPeers))).toBe('');
    });

    test('a context.objectAtLocation archetype must be declared', () => {
        const fixture = { e: { action: 'cook', inputs: [], outputs: [{ archetype: 'meal' }], context: { objectAtLocation: { archetype: 'ghost_oven' } } } };
        const peers = { actions: { cook: { label: 'C', type: 'discrete', category: 'maintenance' } }, objects: { meal: {} } };
        expect(messagesOf(semantics(validateOarSemantics, fixture, peers))).toMatch(/references unknown object archetype "ghost_oven"/);
    });

    test('context.objectAtLocation query is structurally validated (not a record; archetype/archetypeParam conflict)', () => {
        const notRecord = { e: { action: 'mix', inputs: [{ archetype: 'flour_bag', disposition: 'consumed' }], outputs: [], context: { objectAtLocation: 'bad' } } };
        expect(messagesOf(structure(validateOarStructure, notRecord))).toMatch(/expected an object/);
        const conflict = { e: { action: 'mix', inputs: [{ archetype: 'flour_bag', disposition: 'consumed' }], outputs: [], context: { objectAtLocation: { archetype: 'oven', archetypeParam: 'x' } } } };
        expect(messagesOf(structure(validateOarStructure, conflict))).toMatch(/mutually exclusive/);
    });

    test('the real object-action-relationships.json passes semantic validation against its real peers', () => {
        expect(messagesOf(semantics(validateOarSemantics, oarConfig, { actions: actionsConfig, objects: objectsConfig }))).toBe('');
    });
});

// ---------- shared consequence-op checker (used by both actions.ts and oar.ts) ----------

describe('shared consequence-op structural checks', () => {
    test('every op kind validates its own shape', () => {
        const ops = [
            { op: 'createObject', archetype: 'coin', quantity: 2, owner: 'employer', container: 'location' },
            { op: 'consumeObject', object: { param: 'x' }, quantity: 1 },
            { op: 'removeObject', object: { output: 'y' } },
            { op: 'moveObject', object: { carried: { archetype: 'coin' } }, container: 'possessions' },
            { op: 'moveObjectToPerson', object: { atLocation: { tag: 'giftable' } }, target: 'targetPerson' },
            { op: 'transferObject', object: { param: 'x' }, owner: 'world' },
            { op: 'setObjectState', object: { param: 'x' }, key: 'broken', value: true },
            { op: 'adjustMoney', amount: -5, target: 'targetPerson' },
            { op: 'triggerEvent', event: 'gave_gift' },
            { op: 'scheduleEvent', event: 'gave_gift', afterTicks: 3 },
        ];
        expect(structure((d, i) => validateConsequenceOps(i, 'c', d), ops)).toEqual([]);
    });

    test.each([
        ['ops not an array', 'bad', /expected an array/],
        ['an op not a record', ['bad'], /expected an object/],
        ['an unknown op kind', [{ op: 'summonObject' }], /expected one of \[createObject/],
        ['createObject unknown key', [{ op: 'createObject', archetype: 'x', note: 'y' }], /unknown key/],
        ['createObject missing archetype', [{ op: 'createObject' }], /expected a string/],
        ['createObject bad quantity', [{ op: 'createObject', archetype: 'x', quantity: 0 }], /expected >= 1/],
        ['createObject bad owner', [{ op: 'createObject', archetype: 'x', owner: 'thief' }], /expected one of/],
        ['createObject bad container', [{ op: 'createObject', archetype: 'x', container: 'pocket' }], /expected one of \[possessions, location\]/],
        ['consumeObject unknown key', [{ op: 'consumeObject', object: { param: 'x' }, note: 'y' }], /unknown key/],
        ['consumeObject bad object ref', [{ op: 'consumeObject', object: { weird: true } }], /unrecognized object ref/],
        ['consumeObject bad quantity', [{ op: 'consumeObject', object: { param: 'x' }, quantity: 0 }], /expected >= 1/],
        ['removeObject unknown key', [{ op: 'removeObject', object: { param: 'x' }, note: 'y' }], /unknown key/],
        ['removeObject bad object ref not a record', [{ op: 'removeObject', object: 'bad' }], /expected an object/],
        ['moveObject unknown key', [{ op: 'moveObject', object: { param: 'x' }, container: 'possessions', note: 'y' }], /unknown key/],
        ['moveObject bad container', [{ op: 'moveObject', object: { param: 'x' }, container: 'pocket' }], /expected one of \[possessions, location, outside\]/],
        ['moveObjectToPerson unknown key', [{ op: 'moveObjectToPerson', object: { param: 'x' }, target: 'targetPerson', note: 'y' }], /unknown key/],
        ['moveObjectToPerson bad target', [{ op: 'moveObjectToPerson', object: { param: 'x' }, target: 'employer' }], /expected one of \[targetPerson\]/],
        ['transferObject unknown key', [{ op: 'transferObject', object: { param: 'x' }, owner: 'world', note: 'y' }], /unknown key/],
        ['transferObject bad owner', [{ op: 'transferObject', object: { param: 'x' }, owner: 'thief' }], /expected one of/],
        ['setObjectState unknown key', [{ op: 'setObjectState', object: { param: 'x' }, key: 'k', note: 'y' }], /unknown key/],
        ['setObjectState missing key', [{ op: 'setObjectState', object: { param: 'x' } }], /expected a string/],
        ['adjustMoney unknown key', [{ op: 'adjustMoney', amount: 1, note: 'y' }], /unknown key/],
        ['adjustMoney bad amount', [{ op: 'adjustMoney', amount: 'lots' }], /expected a number/],
        ['adjustMoney bad target', [{ op: 'adjustMoney', amount: 1, target: 'employer' }], /expected one of \[person, targetPerson\]/],
        ['triggerEvent unknown key', [{ op: 'triggerEvent', event: 'x', note: 'y' }], /unknown key/],
        ['triggerEvent missing event', [{ op: 'triggerEvent' }], /expected a string/],
        ['scheduleEvent unknown key', [{ op: 'scheduleEvent', event: 'x', afterTicks: 1, note: 'y' }], /unknown key/],
        ['scheduleEvent bad afterTicks', [{ op: 'scheduleEvent', event: 'x', afterTicks: 0 }], /expected >= 1/],
    ])('rejects %s', (_label, ops, pattern) => {
        expect(messagesOf(structure((d, i) => validateConsequenceOps(i, 'c', d), ops))).toMatch(pattern);
    });

    test.each([
        ['object ref { param }', { param: 'x' }],
        ['object ref { output }', { output: 'x' }],
        ['object ref { carried }', { carried: { archetype: 'coin' } }],
        ['object ref { atLocation }', { atLocation: { tag: 'giftable' } }],
    ])('accepts every object ref form: %s', (_label, ref) => {
        expect(structure((d, i) => validateConsequenceOps(i, 'c', d), [{ op: 'consumeObject', object: ref }])).toEqual([]);
    });

    test('an unrecognized object ref shape is rejected', () => {
        expect(messagesOf(structure((d, i) => validateConsequenceOps(i, 'c', d), [{ op: 'consumeObject', object: { mystery: 1 } }]))).toMatch(/unrecognized object ref/);
    });
});

describe('shared consequence-op semantic checks', () => {
    test('archetype/event refs resolve; a non-manual triggerEvent target is rejected; targetPerson needs a declared param', () => {
        const ops = [
            { op: 'createObject', archetype: 'ghost' },
            { op: 'triggerEvent', event: 'ghost_event' },
            { op: 'scheduleEvent', event: 'rolls_only', afterTicks: 5 }, // scheduleEvent doesn't require manual
            { op: 'transferObject', object: { param: 'x' }, owner: 'targetPerson' },
        ];
        const archetypes = new Set(['coin']);
        const events = { rolls_only: { triggers: { probabilistic: { perYear: 1 } } } } as unknown as EventManifest;
        const output = messagesOf(structure((d, i) => validateConsequenceOps(i, 'c', d), ops)); // structural: all shapes are fine
        expect(output).toBe('');
        const semanticIssues: ValidationIssue[] = [];
        validateConsequenceOpsSemantics(new IssueCollector('fixture', semanticIssues), 'c', ops as { op: string; archetype?: string; event?: string; owner?: string; target?: string }[], archetypes, events, new Set());
        const semanticOutput = messagesOf(semanticIssues);
        expect(semanticOutput).toMatch(/unknown object archetype "ghost"/);
        expect(semanticOutput).toMatch(/references unknown event "ghost_event"/);
        expect(semanticOutput).toMatch(/op references 'targetPerson' but the action declares no "target" parameter/);
        // scheduleEvent to a non-manual event is fine (only triggerEvent requires manual).
        expect(semanticOutput).not.toMatch(/rolls_only/);
    });

    test('a triggerEvent to a real event that lacks a manual trigger is rejected', () => {
        const ops = [{ op: 'triggerEvent', event: 'rolls_only' }];
        const events = { rolls_only: { triggers: { probabilistic: { perYear: 1 } } } } as unknown as EventManifest;
        const issues: ValidationIssue[] = [];
        validateConsequenceOpsSemantics(new IssueCollector('fixture', issues), 'c', ops as { op: string; archetype?: string; event?: string; owner?: string; target?: string }[], new Set(), events, new Set());
        expect(messagesOf(issues)).toMatch(/event "rolls_only" does not declare a manual trigger/);
    });

    test('a triggerEvent to a real, manual-triggerable event with a declared target param is clean', () => {
        const ops = [{ op: 'triggerEvent', event: 'e' }, { op: 'adjustMoney', amount: 1, target: 'targetPerson' }];
        const events = { e: { triggers: { manual: {} } } } as unknown as EventManifest;
        const issues: ValidationIssue[] = [];
        validateConsequenceOpsSemantics(new IssueCollector('fixture', issues), 'c', ops as { op: string; archetype?: string; event?: string; owner?: string; target?: string }[], new Set(), events, new Set(['target']));
        expect(messagesOf(issues)).toBe('');
    });
});
