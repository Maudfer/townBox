import SkillBook, { DEFAULT_SKILL_MANIFEST } from 'game/skills/SkillBook';
import { compileSkills } from 'util/skillGraph';
import { schoolDailyGain, totalEligibleSchoolDays, SCHOOL_BASIC_CAP } from 'util/school';
import { TICKS_PER_YEAR } from 'util/time';
import { SkillManifest } from 'types/Skill';
import { SchoolConfig } from 'types/School';

import jobsConfig from 'json/jobs.json';
import schoolsConfig from 'json/schools.json';

// The skill model (tasks 059–062): the dependency-graph compiler, the SkillBook store (grants, gating,
// atomic closures), and deterministic age-appropriate initialization — over the REAL 335-skill manifest.

const SCHOOL = schoolsConfig as unknown as SchoolConfig;
const JOB_CORE: ReadonlySet<string> = new Set(
    Object.values(jobsConfig as Record<string, { requiredSkills?: string[] }>).flatMap(job => job.requiredSkills ?? [])
);

const bornAt = (ageYears: number, tick = 0): number => tick - ageYears * TICKS_PER_YEAR;

describe('skill graph compiler (util/skillGraph)', () => {
    test('the shipped manifest compiles: no errors, full topo order, basics before dependents', () => {
        const compiled = compileSkills(DEFAULT_SKILL_MANIFEST);
        expect(compiled.errors).toEqual([]);
        expect(compiled.topoOrder).toHaveLength(Object.keys(DEFAULT_SKILL_MANIFEST).length);
        const index = new Map(compiled.topoOrder.map((id, i) => [id, i]));
        // Every dependency precedes its dependent.
        for (const [id, deps] of Object.entries(compiled.dependenciesOf)) {
            for (const dep of deps) {
                expect(index.get(dep.skill)!).toBeLessThan(index.get(id)!);
            }
        }
    });

    test('cycles, missing refs, self-deps, and bad thresholds are compiler errors', () => {
        const bad: SkillManifest = {
            a: { label: 'A', dependencies: [{ skill: 'b', minProficiency: 10 }] },
            b: { label: 'B', dependencies: [{ skill: 'a', minProficiency: 10 }] },
            c: { label: 'C', dependencies: [{ skill: 'ghost', minProficiency: 10 }, { skill: 'c', minProficiency: 200 }] },
        };
        const errors = compileSkills(bad).errors.join('\n');
        expect(errors).toMatch(/cycle/);
        expect(errors).toMatch(/unknown dependency 'ghost'/);
        expect(errors).toMatch(/depends on itself/);
        expect(errors).toMatch(/minProficiency must be in \(0, 100\]/);
    });
});

describe('SkillBook grants', () => {
    test('acquire-on-first-gain, clamp at 100, and no zero records', () => {
        const book = new SkillBook();
        expect(book.has('p', 'math')).toBe(false);
        book.grant('p', 'math', { toAtLeast: 0 }, 5, 'test');
        expect(book.has('p', 'math')).toBe(false); // zero-proficiency records are never stored
        book.grant('p', 'math', { add: 150 }, 6, 'test');
        expect(book.proficiency('p', 'math')).toBe(100); // clamped
        expect(book.skillsOf('p')['math']!.firstAcquiredTick).toBe(6);
    });

    test('dependency gating: a specific skill cannot gain proficiency before its prerequisites', () => {
        const book = new SkillBook();
        // suture_wounds needs physical_coordination 25, biology 20, use_sterile_equipment 15.
        expect(book.grant('p', 'suture_wounds', { toAtLeast: 10 }, 0, 'test')).toEqual({ ok: false, reason: 'dependenciesUnmet' });
        expect(book.grant('p', 'nonexistent', { toAtLeast: 10 }, 0, 'test')).toEqual({ ok: false, reason: 'unknownSkill' });

        book.grant('p', 'physical_coordination', { toAtLeast: 25 }, 0, 'test');
        book.grant('p', 'biology', { toAtLeast: 20 }, 0, 'test');
        book.grant('p', 'chemistry', { toAtLeast: 10 }, 0, 'test');
        book.grant('p', 'use_sterile_equipment', { toAtLeast: 15 }, 0, 'test');
        expect(book.grant('p', 'suture_wounds', { toAtLeast: 10 }, 1, 'test').ok).toBe(true);
        expect(book.meets('p', [{ skill: 'suture_wounds', minProficiency: 10 }])).toBe(true);
    });

    test('grantClosure is atomic: one unsatisfiable grant leaves zero mutations', () => {
        const book = new SkillBook();
        const result = book.grantClosure('p', [
            { skill: 'biology', amount: { toAtLeast: 20 } },
            { skill: 'suture_wounds', amount: { toAtLeast: 15 } }, // missing coordination + sterile equipment
        ], 0, 'trainingGrant:test');
        expect(result).toEqual({ ok: false, reason: 'dependenciesUnmet' });
        expect(book.hasAny('p')).toBe(false); // nothing applied

        // A complete closure applies whole, in dependency order.
        const full = book.grantClosure('p', [
            { skill: 'suture_wounds', amount: { toAtLeast: 15 } },
            { skill: 'use_sterile_equipment', amount: { toAtLeast: 15 } },
            { skill: 'biology', amount: { toAtLeast: 20 } },
            { skill: 'chemistry', amount: { toAtLeast: 10 } },
            { skill: 'physical_coordination', amount: { toAtLeast: 25 } },
        ], 3, 'trainingGrant:test');
        expect(full.ok).toBe(true);
        expect(book.proficiency('p', 'suture_wounds')).toBe(15);
    });

    test('grantWithPrerequisites tops up the whole chain (education/legacy path)', () => {
        const book = new SkillBook();
        const result = book.grantWithPrerequisites('p', 'check_drug_interactions', 30, 0, 'event');
        expect(result.ok).toBe(true);
        // dispense_medication (dep) and ITS basics got topped to their thresholds.
        expect(book.proficiency('p', 'dispense_medication')).toBeGreaterThanOrEqual(15);
        expect(book.proficiency('p', 'reading')).toBeGreaterThanOrEqual(25);
        expect(book.proficiency('p', 'chemistry')).toBeGreaterThanOrEqual(20);
    });

    test('provenance records why a skill is held', () => {
        const book = new SkillBook();
        book.grant('p', 'math', { toAtLeast: 30 }, 0, 'initialization');
        book.grant('p', 'math', { toAtLeast: 50 }, 9, 'school');
        expect(book.skillsOf('p')['math']!.provenance).toEqual(['initialization', 'school']);
    });

    test('state round-trips through save/load', () => {
        const book = new SkillBook();
        book.grant('p', 'math', { toAtLeast: 42 }, 7, 'test');
        book.initialize('q', 30, bornAt(30), 0, 1234, JOB_CORE);
        const restored = new SkillBook();
        restored.loadState(book.getState());
        expect(restored.proficiency('p', 'math')).toBe(42);
        expect(restored.isInitialized('q')).toBe(true);
        expect(restored.skillsOf('q')).toEqual(book.skillsOf('q'));
    });
});

describe('initialization (task 062)', () => {
    test('newborns get nothing; toddlers get the partial milestone ladder, never all basics', () => {
        const book = new SkillBook();
        book.initialize('baby', 0, bornAt(0), 0, 7, JOB_CORE);
        expect(book.hasAny('baby')).toBe(false);

        book.initialize('tot', 3, bornAt(3), 0, 7, JOB_CORE);
        expect(book.proficiency('tot', 'speaking')).toBeGreaterThanOrEqual(20);
        expect(book.has('tot', 'history')).toBe(false); // not all basics prematurely
        expect(book.has('tot', 'physics')).toBe(false);
    });

    test('school-age initialization synthesizes full attendance since the 7th birthday', () => {
        const book = new SkillBook();
        const birthTick = bornAt(12);
        book.initialize('kid', 12, birthTick, 0, 7, JOB_CORE);
        const gain = schoolDailyGain(SCHOOL, birthTick);
        // ~5 years of school days at the exact-60 rate: proficiency well above milestones, below the cap.
        const math = book.proficiency('kid', 'math');
        expect(math).toBeGreaterThan(20);
        expect(math).toBeLessThan(SCHOOL_BASIC_CAP);
        expect(gain * totalEligibleSchoolDays(SCHOOL, birthTick)).toBeCloseTo(SCHOOL_BASIC_CAP, 6);
    });

    test('adults: every basic at 60 plus a bounded, dependency-valid assortment', () => {
        const book = new SkillBook();
        book.initialize('adult', 40, bornAt(40), 0, 99, JOB_CORE);
        for (const basic of ['math', 'reading', 'writing', 'speaking', 'biology', 'music', 'art', 'civics']) {
            expect(book.proficiency('adult', basic)).toBe(60);
        }
        const specifics = Object.entries(book.skillsOf('adult')).filter(([id]) => !DEFAULT_SKILL_MANIFEST[id]!.basic);
        expect(specifics.length).toBeGreaterThanOrEqual(3); // 45+ band minimum, prerequisites may add more
        // No unexplained masters, and every record satisfies the dependency graph.
        for (const [id, record] of specifics) {
            expect(record.proficiency).toBeLessThanOrEqual(75);
            for (const dep of DEFAULT_SKILL_MANIFEST[id]!.dependencies ?? []) {
                expect(book.proficiency('adult', dep.skill)).toBeGreaterThanOrEqual(dep.minProficiency);
            }
        }
    });

    test('deterministic per (seed, person) and idempotent across re-entry', () => {
        const a = new SkillBook();
        const b = new SkillBook();
        a.initialize('p1', 35, bornAt(35), 0, 42, JOB_CORE);
        b.initialize('p1', 35, bornAt(35), 0, 42, JOB_CORE);
        expect(a.skillsOf('p1')).toEqual(b.skillsOf('p1'));

        const snapshot = JSON.stringify(a.skillsOf('p1'));
        a.initialize('p1', 36, bornAt(35), 100, 42, JOB_CORE); // re-entry later: never re-runs
        expect(JSON.stringify(a.skillsOf('p1'))).toBe(snapshot);

        const c = new SkillBook();
        c.initialize('p1', 35, bornAt(35), 0, 43, JOB_CORE); // different seed → different assortment
        const differs = JSON.stringify(c.skillsOf('p1')) !== snapshot;
        expect(differs).toBe(true);
    });

    test('the closed hiring loop holds: initialized adults can staff real jobs', () => {
        // Across a modest cohort, at least some adults hold a complete requiredSkills set for some job —
        // the guard against "nobody is hireable" regressions (056/061 orphan concern).
        const book = new SkillBook();
        const jobs = Object.values(jobsConfig as Record<string, { requiredSkills: string[] }>);
        let hireable = 0;
        for (let i = 0; i < 40; i++) {
            const id = `adult-${i}`;
            book.initialize(id, 30 + (i % 30), bornAt(30 + (i % 30)), 0, 1000 + i, JOB_CORE);
            if (jobs.some(job => job.requiredSkills.every(skill => book.has(id, skill)))) {
                hireable++;
            }
        }
        expect(hireable).toBeGreaterThan(5);
    });
});
