import Field from 'game/Field';
import House from 'game/House';
import Person from 'game/Person';

import { PersonId } from 'types/Genealogy';
import { HousingMarket as IHousingMarket } from 'types/LifeEvent';

// Concrete housing adapter (task 024): the bridge between the pure event engine and the materialized
// House/Field layer for the move_out event. The engine consults `canMoveOut` to gate eligibility so the per-day
// roll only happens when the person can actually leave home — i.e. they live in a household they don't head
// (with someone to leave behind) and there is a vacant home available to move into. Adulthood/employment are
// gated by the move_out event predicate. Built fresh each day by City.handleNewDay; no RNG.
export default class HousingMarket implements IHousingMarket {
    private hasVacancy: boolean;

    constructor(private byGenId: Map<PersonId, Person>, field: Field) {
        this.hasVacancy = field.getStructures().some(tile => tile instanceof House && tile.getResidents().length === 0);
    }

    canMoveOut(personId: PersonId): boolean {
        if (!this.hasVacancy) {
            return false;
        }
        const person = this.byGenId.get(personId);
        const home = person?.social.getHome();
        if (!(home instanceof House)) {
            return false;
        }
        const household = home.getHousehold();
        return !!household && household.headId !== personId && home.getResidents().length > 1;
    }
}
