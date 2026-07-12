import { SkillManifest } from 'types/Skill';
import { compileSkills } from 'util/skillGraph';

// The skill dependency-graph compiler (task 059): flat manifest in, DAG out (the EventCompiler pattern).

function skill(label: string, overrides: Partial<SkillManifest[string]> = {}): SkillManifest[string] {
    return { label, ...overrides };
}

describe('compileSkills — happy path', () => {
    test('produces a deterministic topo order (dependencies before dependents)', () => {
        const manifest: SkillManifest = {
            biology: skill('Biology', { basic: true }),
            suture_wounds: skill('Suture wounds', { dependencies: [{ skill: 'biology', minProficiency: 30 }] }),
            perform_surgery: skill('Perform surgery', { dependencies: [{ skill: 'suture_wounds', minProficiency: 50 }] }),
        };
        const compiled = compileSkills(manifest);
        expect(compiled.errors).toEqual([]);
        expect(compiled.topoOrder).toEqual(['biology', 'suture_wounds', 'perform_surgery']);
        expect(compiled.dependenciesOf['perform_surgery']).toEqual([{ skill: 'suture_wounds', minProficiency: 50 }]);
    });

    test('a skill with no dependencies has an empty dependenciesOf entry', () => {
        const manifest: SkillManifest = { biology: skill('Biology', { basic: true }) };
        const compiled = compileSkills(manifest);
        expect(compiled.dependenciesOf['biology']).toEqual([]);
    });

    test('multiple prerequisites are allowed (a DAG, not a tree)', () => {
        const manifest: SkillManifest = {
            biology: skill('Biology', { basic: true }),
            chemistry: skill('Chemistry', { basic: true }),
            pharmacology: skill('Pharmacology', {
                dependencies: [
                    { skill: 'biology', minProficiency: 20 },
                    { skill: 'chemistry', minProficiency: 20 },
                ],
            }),
        };
        const compiled = compileSkills(manifest);
        expect(compiled.errors).toEqual([]);
        expect(compiled.topoOrder.indexOf('pharmacology')).toBeGreaterThan(compiled.topoOrder.indexOf('biology'));
        expect(compiled.topoOrder.indexOf('pharmacology')).toBeGreaterThan(compiled.topoOrder.indexOf('chemistry'));
    });

    test('topo order is deterministic across independent roots (sorted)', () => {
        const manifest: SkillManifest = { zebra: skill('Zebra', { basic: true }), alpha: skill('Alpha', { basic: true }) };
        const compiled = compileSkills(manifest);
        expect(compiled.topoOrder).toEqual(['alpha', 'zebra']);
    });
});

describe('compileSkills — structural errors', () => {
    test('flags a basic skill that declares dependencies', () => {
        const manifest: SkillManifest = {
            biology: skill('Biology', { basic: true, dependencies: [{ skill: 'biology', minProficiency: 10 }] }),
        };
        const compiled = compileSkills(manifest);
        expect(compiled.errors).toContain("biology: basic skills must have no dependencies");
    });

    test('flags an unknown dependency reference', () => {
        const manifest: SkillManifest = {
            suture_wounds: skill('Suture wounds', { dependencies: [{ skill: 'nonexistent', minProficiency: 10 }] }),
        };
        const compiled = compileSkills(manifest);
        expect(compiled.errors).toContain("suture_wounds: unknown dependency 'nonexistent'");
    });

    test('flags a self-dependency', () => {
        const manifest: SkillManifest = {
            suture_wounds: skill('Suture wounds', { dependencies: [{ skill: 'suture_wounds', minProficiency: 10 }] }),
        };
        const compiled = compileSkills(manifest);
        expect(compiled.errors).toContain('suture_wounds: depends on itself');
    });

    test('flags a duplicate dependency', () => {
        const manifest: SkillManifest = {
            biology: skill('Biology', { basic: true }),
            suture_wounds: skill('Suture wounds', {
                dependencies: [
                    { skill: 'biology', minProficiency: 10 },
                    { skill: 'biology', minProficiency: 20 },
                ],
            }),
        };
        const compiled = compileSkills(manifest);
        expect(compiled.errors).toContain("suture_wounds: duplicate dependency 'biology'");
    });

    test('flags an out-of-range minProficiency (<=0 or >100)', () => {
        const manifest: SkillManifest = {
            biology: skill('Biology', { basic: true }),
            zero: skill('Zero', { dependencies: [{ skill: 'biology', minProficiency: 0 }] }),
            over: skill('Over', { dependencies: [{ skill: 'biology', minProficiency: 101 }] }),
        };
        const compiled = compileSkills(manifest);
        expect(compiled.errors.some(e => e.includes("zero: dependency 'biology' minProficiency"))).toBe(true);
        expect(compiled.errors.some(e => e.includes("over: dependency 'biology' minProficiency"))).toBe(true);
    });

    test('flags a dependency cycle and still returns a (partial, non-fatal) result', () => {
        const manifest: SkillManifest = {
            a: skill('A', { dependencies: [{ skill: 'b', minProficiency: 10 }] }),
            b: skill('B', { dependencies: [{ skill: 'a', minProficiency: 10 }] }),
        };
        const compiled = compileSkills(manifest);
        expect(compiled.errors.some(e => e.startsWith('dependency cycle involving: a, b'))).toBe(true);
        // The cyclic nodes never resolve indegree 0, so they're excluded from topoOrder.
        expect(compiled.topoOrder).toEqual([]);
    });

    test('a three-node cycle mixed with a healthy root is partially ordered', () => {
        const manifest: SkillManifest = {
            biology: skill('Biology', { basic: true }),
            x: skill('X', { dependencies: [{ skill: 'y', minProficiency: 10 }] }),
            y: skill('Y', { dependencies: [{ skill: 'z', minProficiency: 10 }] }),
            z: skill('Z', { dependencies: [{ skill: 'x', minProficiency: 10 }] }),
        };
        const compiled = compileSkills(manifest);
        expect(compiled.topoOrder).toEqual(['biology']);
        expect(compiled.errors.some(e => e.startsWith('dependency cycle involving: x, y, z'))).toBe(true);
    });
});
