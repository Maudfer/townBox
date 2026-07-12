import Building from 'game/world/Building';
import WorkLife from 'game/population/WorkLife';
import { JobPosition } from 'types/Work';

// WorkLife is a thin employment record: the job + the employer Building reference (the commute
// destination). Skills live elsewhere (SkillBook); this class is deliberately dumb storage.

function fakeBuilding(key: string): Building {
    return { getIdentifier: () => key } as unknown as Building;
}

function job(title: string): JobPosition {
    return {
        title,
        salary: 1000,
        requirements: [],
        shiftStart: 9 * 60,
        shiftEnd: 17 * 60,
    };
}

describe('WorkLife', () => {
    test('starts unemployed', () => {
        const work = new WorkLife();
        expect(work.getJob()).toBeNull();
        expect(work.getWorkplace()).toBeNull();
        expect(work.getInfo()).toEqual({ job: null });
    });

    test('setJob/setWorkplace round-trip independently', () => {
        const work = new WorkLife();
        const position = job('Clerk');
        const workplace = fakeBuilding('5-5');

        work.setJob(position);
        expect(work.getJob()).toBe(position);
        expect(work.getInfo()).toEqual({ job: position });

        work.setWorkplace(workplace);
        expect(work.getWorkplace()).toBe(workplace);
    });

    test('clearJob resets both the job and the employer reference together', () => {
        const work = new WorkLife();
        work.setJob(job('Baker'));
        work.setWorkplace(fakeBuilding('2-2'));

        work.clearJob();

        expect(work.getJob()).toBeNull();
        expect(work.getWorkplace()).toBeNull();
    });

    test('setJob can replace an existing job (promotion/rehire)', () => {
        const work = new WorkLife();
        const junior = job('Junior Clerk');
        const senior = job('Senior Clerk');

        work.setJob(junior);
        work.setJob(senior);

        expect(work.getJob()).toBe(senior);
    });
});
