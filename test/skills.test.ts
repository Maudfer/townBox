import { assignSkills, DEFAULT_SKILL_PARAMS } from '../src/util/skills';
import { JobRequirements, SkillAssignmentParams } from '../src/types/Work';

const SEED = 12345;
const VALID = new Set(Object.values(JobRequirements));

describe('assignSkills', () => {
    test('is deterministic for the same personId + age + seed', () => {
        const a = assignSkills('p1', 30, SEED);
        const b = assignSkills('p1', 30, SEED);
        expect(a).toEqual(b);
    });

    test('different people generally get different skill sets', () => {
        const sets = ['p1', 'p2', 'p3', 'p4', 'p5'].map(id => assignSkills(id, 30, SEED).join(','));
        // Not all identical (the assignment actually varies by person).
        expect(new Set(sets).size).toBeGreaterThan(1);
    });

    test('only ever returns valid, distinct skills', () => {
        for (let i = 0; i < 200; i++) {
            const skills = assignSkills(`p${i}`, 30, SEED);
            expect(new Set(skills).size).toBe(skills.length); // distinct
            for (const skill of skills) {
                expect(VALID.has(skill)).toBe(true);
            }
        }
    });

    test('adults get 1..3 skills; minors get 0..1', () => {
        for (let i = 0; i < 200; i++) {
            const adult = assignSkills(`a${i}`, 30, SEED);
            expect(adult.length).toBeGreaterThanOrEqual(DEFAULT_SKILL_PARAMS.adult.minSkills);
            expect(adult.length).toBeLessThanOrEqual(DEFAULT_SKILL_PARAMS.adult.maxSkills);

            const minor = assignSkills(`m${i}`, 10, SEED);
            expect(minor.length).toBeGreaterThanOrEqual(DEFAULT_SKILL_PARAMS.minor.minSkills);
            expect(minor.length).toBeLessThanOrEqual(DEFAULT_SKILL_PARAMS.minor.maxSkills);
        }
    });

    test('the working-age threshold decides the life stage', () => {
        const threshold = DEFAULT_SKILL_PARAMS.workingAgeYears;
        // A custom params with a fixed minor count of 0 and adult count of 2 makes the boundary observable.
        const params: SkillAssignmentParams = {
            workingAgeYears: threshold,
            minor: { minSkills: 0, maxSkills: 0 },
            adult: { minSkills: 2, maxSkills: 2 },
            weights: DEFAULT_SKILL_PARAMS.weights,
        };
        expect(assignSkills('x', threshold - 1, SEED, params)).toHaveLength(0);
        expect(assignSkills('x', threshold, SEED, params)).toHaveLength(2);
    });

    test('higher-weighted skills are drawn more often across the population', () => {
        const counts = new Map<string, number>();
        for (let i = 0; i < 5000; i++) {
            for (const skill of assignSkills(`person-${i}`, 30, SEED)) {
                counts.set(skill, (counts.get(skill) ?? 0) + 1);
            }
        }
        // RetailSkill (weight 1.2) should clearly out-appear MedicalSkill (weight 0.4).
        expect(counts.get(JobRequirements.RetailSkill) ?? 0).toBeGreaterThan(counts.get(JobRequirements.MedicalSkill) ?? 0);
    });
});
