import { JobRequirements } from '../src/types/Work';
import { BusinessBlueprintTable, JobTable } from '../src/types/Business';
import { DemandTable } from '../src/types/Demand';

import businessesConfig from '../src/json/businesses.json';
import jobsConfig from '../src/json/jobs.json';
import demandConfig from '../src/json/demand.json';
import materialsConfig from '../src/json/materials.json';
import skillsConfig from '../src/json/skills.json';

const BLUEPRINTS = businessesConfig as unknown as BusinessBlueprintTable;
const JOBS = jobsConfig as unknown as JobTable;
const DEMAND = demandConfig as unknown as DemandTable;
const MATERIALS = materialsConfig as Record<string, { basePrice: number }>;
const SKILL_WEIGHTS = (skillsConfig as { weights: Record<string, number> }).weights;

const VALID_SKILLS = new Set<string>(Object.values(JobRequirements));

// Guards the data-only expansion (tasks 034 + 033b): the reference tables must stay internally consistent, or
// businesses generate broken positions, hiring can't match, and the demand model divides by missing categories.
describe('content consistency (tasks 034 + 033b)', () => {
    test('every job requires only real JobRequirements skills', () => {
        for (const [jobId, def] of Object.entries(JOBS)) {
            for (const skill of def.requiredSkills) {
                expect({ jobId, skill, valid: VALID_SKILLS.has(skill) }).toEqual({ jobId, skill, valid: true });
            }
        }
    });

    test('no unfillable jobs: every required skill is assignable (has a positive weight in skills.json)', () => {
        for (const [jobId, def] of Object.entries(JOBS)) {
            for (const skill of def.requiredSkills) {
                expect({ jobId, skill, weight: SKILL_WEIGHTS[skill] ?? 0 }).toEqual({ jobId, skill, weight: expect.any(Number) });
                expect(SKILL_WEIGHTS[skill] ?? 0).toBeGreaterThan(0);
            }
        }
    });

    test('every skill weight key is a real skill (no stale weights)', () => {
        for (const skill of Object.keys(SKILL_WEIGHTS)) {
            expect({ skill, valid: VALID_SKILLS.has(skill) }).toEqual({ skill, valid: true });
        }
    });

    test('every blueprint references defined jobs, a known demand category, and known materials', () => {
        for (const [key, blueprint] of Object.entries(BLUEPRINTS)) {
            for (const jobId of Object.keys(blueprint.jobs)) {
                expect({ key, jobId, defined: jobId in JOBS }).toEqual({ key, jobId, defined: true });
            }
            expect({ key, category: blueprint.category, known: blueprint.category in DEMAND }).toEqual({ key, category: blueprint.category, known: true });
            for (const material of Object.keys(blueprint.materialsPerUnit ?? {})) {
                expect({ key, material, known: material in MATERIALS }).toEqual({ key, material, known: true });
            }
            // Producer outputs (task 035) must be real materials too.
            for (const material of Object.keys(blueprint.products ?? {})) {
                expect({ key, product: material, known: material in MATERIALS }).toEqual({ key, product: material, known: true });
            }
        }
    });

    test('every produced material is actually consumed by some blueprint (no orphan production)', () => {
        const consumed = new Set<string>();
        for (const blueprint of Object.values(BLUEPRINTS)) {
            for (const material of Object.keys(blueprint.materialsPerUnit ?? {})) {
                consumed.add(material);
            }
        }
        for (const [key, blueprint] of Object.entries(BLUEPRINTS)) {
            for (const material of Object.keys(blueprint.products ?? {})) {
                expect({ key, product: material, consumed: consumed.has(material) }).toEqual({ key, product: material, consumed: true });
            }
        }
    });

    test('the roster is substantially expanded (sanity floors)', () => {
        expect(Object.keys(BLUEPRINTS).length).toBeGreaterThanOrEqual(15);
        expect(Object.keys(JOBS).length).toBeGreaterThanOrEqual(25);
        expect(VALID_SKILLS.size).toBeGreaterThanOrEqual(14);
        // Every demand category is served by at least one blueprint (no orphaned demand).
        for (const category of Object.keys(DEMAND)) {
            const served = Object.values(BLUEPRINTS).some(blueprint => blueprint.category === category);
            expect({ category, served }).toEqual({ category, served: true });
        }
    });
});
