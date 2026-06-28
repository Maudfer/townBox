import Workplace from '../src/app/game/Workplace';
import Person from '../src/app/game/Person';
import { generateBusiness } from '../src/app/game/BusinessGen';
import { BusinessBlueprint, JobTable } from '../src/types/Business';
import { DEFAULT_SHIFT_START, DEFAULT_SHIFT_END, JobRequirements } from '../src/types/Work';

const jobs: JobTable = {
    laborer: { title: 'Laborer', salary: 1400, requiredSkills: ['ConstructionSkill'] },
};

const blueprint: BusinessBlueprint = {
    friendlyName: 'Construction Site',
    size: { min: 1, max: 6 },
    jobs: { laborer: { count: { mode: 'const', value: 3 } } },
};

describe('workplace hiring against a generated business', () => {
    test('a workplace with no business has no jobs to offer', () => {
        const workplace = new Workplace(0, 0, null);
        const person = new Person(0, 0);
        person.work.setSkills([JobRequirements.ConstructionSkill]); // skilled, but there are no jobs to fill
        expect(workplace.hire(person)).toBeNull();
    });

    test('after a business is assigned, a skill-matched person is hired with default shift times', () => {
        const workplace = new Workplace(0, 0, null);
        workplace.setBusiness(generateBusiness('construction_site', blueprint, jobs, 'Acme Build', 2));

        const person = new Person(0, 0);
        person.work.setSkills([JobRequirements.ConstructionSkill]); // matches the laborer requirement
        const job = workplace.hire(person);

        expect(job).not.toBeNull();
        expect(job!.title).toBe('Laborer');
        expect(job!.shiftStart).toBe(DEFAULT_SHIFT_START);
        expect(job!.shiftEnd).toBe(DEFAULT_SHIFT_END);
        expect(job!.shiftStart).toBeLessThan(job!.shiftEnd);
    });
});
