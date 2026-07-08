import Field from 'game/Field';
import Person from 'game/Person';
import Workplace from 'game/Workplace';
import SkillBook from 'game/SkillBook';

import { PersonId } from 'types/Genealogy';
import { JobMarket as IJobMarket } from 'types/LifeEvent';

// Concrete employment adapter (task 015): the bridge between the pure event engine and the materialized
// Workplace/Field layer. The engine consults it to derive `employed`/`canBeHired` and to perform
// hiring/firing via the `acquireSlot`/`releaseSlot` effects, so the engine never imports the scene-side
// classes. Built fresh each tick by City.handleTick over the current materialized people; skills read from the central SkillBook (task 059).
//
// Hiring is deterministic: among workplaces with an open position the candidate's skills can fill, it picks
// the highest score = SKILL_WEIGHT * (skills the role requires) − DISTANCE_WEIGHT * (home↔workplace Manhattan
// tile distance), ties broken by the workplace's anchor key. No RNG, so reloads reproduce the same hires.

// A strong skill fit can outweigh several tiles of distance; tune as the economy/data matures (033/034).
const SKILL_WEIGHT = 8;
const DISTANCE_WEIGHT = 1;
const NO_HOME_DISTANCE = 9999;

interface Match {
    person: Person;
    workplace: Workplace;
}

export default class JobMarket implements IJobMarket {
    private workplaces: Workplace[];

    constructor(private byGenId: Map<PersonId, Person>, field: Field, private skillBook: SkillBook) {
        this.workplaces = field.getStructures().filter((tile): tile is Workplace => tile instanceof Workplace);
    }

    isEmployed(personId: PersonId): boolean {
        const person = this.byGenId.get(personId);
        return !!person && person.work.getJob() !== null;
    }

    canHire(personId: PersonId): boolean {
        return this.bestMatch(personId) !== null;
    }

    hire(personId: PersonId): boolean {
        const match = this.bestMatch(personId);
        if (!match) {
            return false;
        }
        const job = match.workplace.hire(match.person, requirements => requirements.every(requirement => this.skillBook.has(match.person.social.getPersonId() ?? personId, requirement)));
        if (!job) {
            return false;
        }
        match.person.work.setJob(job);
        match.person.work.setWorkplace(match.workplace); // employer reference for the commute (task 006)
        return true;
    }

    fire(personId: PersonId): void {
        const person = this.byGenId.get(personId);
        if (!person || person.work.getJob() === null) {
            return;
        }
        const employer = this.workplaces.find(workplace => workplace.getEmployees().includes(person));
        employer?.layoff(person);
        person.work.clearJob();
    }

    // The best (highest-scoring) workplace the person can be hired into right now, or null if none is fillable.
    private bestMatch(personId: PersonId): Match | null {
        const person = this.byGenId.get(personId);
        if (!person || person.work.getJob() !== null) {
            return null;
        }
        if (!this.skillBook.hasAny(personId)) {
            return null; // skill-less people (newborns) are not hireable
        }

        const home = person.social.getHome();
        const homePos = home ? home.getPosition() : null;

        let best: Match | null = null;
        let bestScore = -Infinity;
        let bestKey = '';

        for (const workplace of this.workplaces) {
            const fit = this.bestFit(workplace, personId);
            if (fit < 0) {
                continue;
            }
            const position = workplace.getPosition();
            const distance = homePos && position
                ? Math.abs(homePos.row - position.row) + Math.abs(homePos.col - position.col)
                : NO_HOME_DISTANCE;
            const score = SKILL_WEIGHT * fit - DISTANCE_WEIGHT * distance;
            const key = workplace.getIdentifier();
            if (score > bestScore || (score === bestScore && key < bestKey)) {
                bestScore = score;
                bestKey = key;
                best = { person, workplace };
            }
        }

        return best;
    }

    // The strongest fit among a workplace's open positions the person can fill (the number of required skills,
    // so specialist roles outrank generic ones), or -1 if none are fillable. Possession is any positive
    // proficiency in the SkillBook (task 059); per-rank proficiency THRESHOLDS arrive with task 064.
    private bestFit(workplace: Workplace, personId: PersonId): number {
        let best = -1;
        for (const position of workplace.getOpenPositions()) {
            if (position.requirements.every(requirement => this.skillBook.has(personId, requirement))) {
                best = Math.max(best, position.requirements.length);
            }
        }
        return best;
    }
}
