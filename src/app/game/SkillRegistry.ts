import Person from 'game/Person';

import { PersonId } from 'types/Genealogy';
import { JobRequirements } from 'types/Work';
import { SkillRegistry as ISkillRegistry } from 'types/LifeEvent';

// Concrete skill adapter (task 032): lets education/training events grant a real skill to a materialized
// person via the `acquireSkill` effect, without the engine importing the WorkLife/Field layer. Built fresh each
// day by City.handleNewDay over the current materialized people. Idempotent: WorkLife.addSkill dedupes, so a
// re-granted skill is a harmless no-op (returns false). Acquired skills persist in the save (PersonSnapshot),
// so the grant is permanent and survives reload.
const VALID_SKILLS = new Set<string>(Object.values(JobRequirements));

export default class SkillRegistry implements ISkillRegistry {
    constructor(private byGenId: Map<PersonId, Person>) {}

    acquireSkill(personId: PersonId, skill: string): boolean {
        const person = this.byGenId.get(personId);
        if (!person || !VALID_SKILLS.has(skill)) {
            return false;
        }
        const work = person.work;
        if (work.getSkills().includes(skill as JobRequirements)) {
            return false; // already has it
        }
        work.addSkill(skill as JobRequirements);
        return true;
    }
}
