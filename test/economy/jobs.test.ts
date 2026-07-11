import Person from 'game/agents/Person';
import { generateBusiness } from 'game/economy/BusinessGen';
import Workplace from 'game/world/Workplace';
import { BusinessBlueprint, JobTable } from 'types/Business';
import {DEFAULT_SHIFT_START, DEFAULT_SHIFT_END} from 'types/Work';

const jobs: JobTable = {
    laborer: { title: 'Laborer', salary: 1400, requiredSkills: ['carry_building_materials'], ranks: [{ rankId: 'entry', label: 'Trainee', entry: true, requires: ['carry_building_materials'].map(skill => ({ skill, minProficiency: 10 })), progresses: ['carry_building_materials'].map(skill => ({ skill, multiplier: 1 })) }], shiftStart: 540, shiftEnd: 1020, daysOfWeek: ['mon','tue','wed','thu','fri'], workActions: { continuous: [{ action: 'doing_paperwork' }], discrete: [{ action: 'jotted_a_note', chancePerTick: 0.2 }] } },
};

const blueprint: BusinessBlueprint = {
    friendlyName: 'Construction Site',
    category: 'construction',
    size: { min: 1, max: 6 },
    jobs: { laborer: { count: { mode: 'const', value: 3 } } },
};

describe('workplace hiring against a generated business', () => {
    test('a workplace with no business has no jobs to offer', () => {
        const workplace = new Workplace(0, 0, null);
        const person = new Person(0, 0);
        // Skilled (per the canFill predicate), but there are no jobs to fill.
        expect(workplace.hire(person, requirements => requirements.every(r => r === 'carry_building_materials'))).toBeNull();
    });

    test('after a business is assigned, a skill-matched person is hired with default shift times', () => {
        const workplace = new Workplace(0, 0, null);
        workplace.setBusiness(generateBusiness('construction_site', blueprint, jobs, 'Acme Build', 2));

        const person = new Person(0, 0);
        // The canFill predicate stands in for the SkillBook read JobMarket performs (task 059).
        const job = workplace.hire(person, requirements => requirements.every(r => r === 'carry_building_materials'));

        expect(job).not.toBeNull();
        expect(job!.title).toBe('Laborer');
        expect(job!.shiftStart).toBe(DEFAULT_SHIFT_START);
        expect(job!.shiftEnd).toBe(DEFAULT_SHIFT_END);
        expect(job!.shiftStart).toBeLessThan(job!.shiftEnd);
    });
});

// Skill consumption (task 076/M1): every non-basic skill must be REQUIRED or PROGRESSED by some job rank, or
// it's inert data on Person records (a proficiency number nothing gates or grows). The inverse of the CI
// 18-year-old reachability rule.
describe('skill consumption over the real manifests (task 076/M1)', () => {
     
    const realSkills = require('json/skills.json') as Record<string, { basic?: boolean }>;
     
    const realJobs = require('json/jobs.json') as Record<string, { ranks?: { requires?: { skill: string }[]; progresses?: { skill: string }[]; entryTrainingGrant?: { grants?: { skill: string }[] } }[] }>;

    test('every non-basic skill is required or progressed by at least one job rank', () => {
        const consumed = new Set<string>();
        for (const job of Object.values(realJobs)) {
            for (const rank of job.ranks ?? []) {
                for (const r of rank.requires ?? []) consumed.add(r.skill);
                for (const p of rank.progresses ?? []) consumed.add(p.skill);
                for (const g of rank.entryTrainingGrant?.grants ?? []) consumed.add(g.skill);
            }
        }
        const dead = Object.entries(realSkills)
            .filter(([, def]) => !def.basic)
            .map(([id]) => id)
            .filter(id => !consumed.has(id))
            .sort();
        expect(dead).toEqual([]);
    });
});
