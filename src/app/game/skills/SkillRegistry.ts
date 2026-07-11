import SkillBook from 'game/skills/SkillBook';

import { PersonId } from 'types/Genealogy';
import { SkillRegistry as ISkillRegistry } from 'types/LifeEvent';

// Concrete skill adapter (task 032; reworked by 059): lets education/training events grant real proficiency
// via the `acquireSkill` effect, without the engine importing the SkillBook layer. Education teaches its
// prerequisites too (grantWithPrerequisites), so a trade-school graduate with weak basics still ends up with
// a coherent, dependency-valid record. Grants are grant-to-at-least: re-granting is a harmless no-op.
// Rebuilt per tick by City.handleTick (it carries the tick for record timestamps).
const DEFAULT_EVENT_GRANT_PROFICIENCY = 25;

export default class SkillRegistry implements ISkillRegistry {
    constructor(private skillBook: SkillBook, private tick: number) {}

    acquireSkill(personId: PersonId, skill: string, toAtLeast?: number): boolean {
        const floor = toAtLeast ?? DEFAULT_EVENT_GRANT_PROFICIENCY;
        const before = this.skillBook.proficiency(personId, skill);
        if (before >= floor) {
            return false; // already there — no-op, mirrors the old dedupe semantics
        }
        const result = this.skillBook.grantWithPrerequisites(personId, skill, floor, this.tick, 'event');
        return result.ok;
    }
}
