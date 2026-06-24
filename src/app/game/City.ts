import { fakerPT_BR } from '@faker-js/faker';

import GameManager from 'game/GameManager';
import House from 'game/House';
import Person from 'game/Person';
import Vehicle from 'game/Vehicle';
import { DEFAULT_POPULATION_PARAMS } from 'game/Population';

import { ageAt, relationshipLabel } from 'util/kinship';
import { Household } from 'types/Household';
import { PersonId } from 'types/Genealogy';

let Game: GameManager;

// Households are drawn at the present moment. Until the clock (005) exists, "now" is tick 0.
const CURRENT_TICK = 0;
export default class City {    
    private name: string;
    private population: number;


    constructor(gameManager: GameManager) {
        Game = gameManager;

        this.name = fakerPT_BR.location.city();
        this.population = 0;

        Game.on("houseBuilt", { callback: this.setupHousehold, context: this });
        console.log('City created:', this.name);
    }

    public getName(): string {
        return this.name;
    }

    public setName(name: string): void {
        this.name = name;
    }

    public getPopulation(): number {
        return this.population;
    }

    public setPopulation(population: number): void {
        this.population = population;
    }

    public async setupHousehold(house: House): Promise<void> {
        if (!house) {
            throw new Error("Invalid house to setup household");
        }

        const population = Game.population;
        if (!population) {
            throw new Error("Cannot setup household before the population pool exists");
        }

        const ticksPerYear = DEFAULT_POPULATION_PARAMS.ticksPerYear;
        const capacity = house.getOverview().maxResidents;
        const selection = population.drawHousehold(CURRENT_TICK, capacity, ticksPerYear);
        const pool = population.getPeople();

        // Materialize each drawn pool person into a live Person bound to this house.
        const personByGenId = new Map<PersonId, Person>();
        for (const memberId of selection.memberIds) {
            const genPerson = population.getPerson(memberId);
            if (!genPerson) {
                continue;
            }

            const person: Person = await Game.emitSingle("personSpawnRequest", house.getEntrance());
            if (!person) {
                continue;
            }

            person.setIndoors(true);
            person.social.setHome(house);
            const age = ageAt(genPerson, CURRENT_TICK, ticksPerYear);
            person.setupCitizenship(genPerson.firstName, genPerson.familyName, age, genPerson.gender);

            house.addResident(person);
            house.addOccupant(person);
            personByGenId.set(memberId, person);
        }

        // Mirror the pool's kinship onto the materialized residents so the family-tree window renders.
        for (const [aId, aPerson] of personByGenId) {
            for (const [bId, bPerson] of personByGenId) {
                if (aId === bId) {
                    continue;
                }
                const label = relationshipLabel(pool, aId, bId);
                if (label) {
                    aPerson.social.addRelationship(label, bPerson);
                }
            }
        }

        const household: Household = {
            id: `hh-${house.getIdentifier()}`,
            houseKey: house.getIdentifier(),
            headId: selection.headId,
            memberIds: selection.memberIds,
            arrangement: selection.arrangement,
        };
        house.setHousehold(household);

        this.population += personByGenId.size;
        console.log('Household spawned', household.arrangement, household.memberIds.length, 'members');
    }

    public setupCar(vehicle: Vehicle): void {
        console.log('Car spawning', vehicle);
    }
}


