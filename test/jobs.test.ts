import Workplace from '../src/app/game/Workplace';
import Person from '../src/app/game/Person';
import { DEFAULT_SHIFT_START, DEFAULT_SHIFT_END } from '../src/types/Work';

describe('job shift times', () => {
    test('seeded workplace jobs carry sensible default shift times', () => {
        const workplace = new Workplace(0, 0, null);
        const person = new Person(0, 0); // default WorkLife has the ConstructionSkill

        const job = workplace.hire(person);

        expect(job).not.toBeNull();
        expect(job!.shiftStart).toBe(DEFAULT_SHIFT_START);
        expect(job!.shiftEnd).toBe(DEFAULT_SHIFT_END);
        expect(job!.shiftStart).toBeLessThan(job!.shiftEnd);
    });
});
