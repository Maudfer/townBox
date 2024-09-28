import { fakerPT_BR } from '@faker-js/faker';

import GameManager from 'game/GameManager';
import Person from 'game/Person';
import House from 'game/House';

import { Gender, Genders, Relationship, Relationships, FamilyOverview } from 'types/Social';

const MIN_FAMILY_MEMBERS = 1;
const MAX_FAMILY_MEMBERS = 10;

const MIN_AGE = 0;
const MAX_AGE = 100;
const ADULT_AGE = 18;

const PARENT_MIN_AGE_GAP = 18; // Should never be lower than ADULT_AGE
const PARENT_MAX_AGE_GAP = 40;
const SPOUSE_MAX_AGE_GAP = 20;

const SPOUSE_PROBABILITY = 0.5;
const CHILD_COPARENT_PROBABILITY = 0.85;
const CHILD_PROBABILITY_BASIS = 0.6;
const CHILD_PROBABILITY_STEP = 0.15;
const CHILD_PROBABILITY_MIN = 0.15;

export default class Family {
    familyName: string;
    familyId: string;
    household: House;
    members: Person[];

    constructor(household: House) {
        this.familyName = `${fakerPT_BR.person.lastName()}`;
        this.familyId = `${this.familyName.toLowerCase().replace(" ", "-")}-${new Date().getTime()}`;
        this.household = household;
        this.members = [];
    }

    async createPerson(gameManager: GameManager, age: number, gender: Gender, firstName: string): Promise<Person> {
        const housePosition = this.household.getEntrance();

        const person: Person = await gameManager.emitSingle("personSpawnRequest", housePosition);
        if (!person || !gender || age === undefined) {
            console.log(person, gender, age);
            throw new Error("Invalid person to generate family member");
        }

        person.setIndoors(true);
        person.social.setHome(this.household);
        person.social.setFamilyName(this.familyName);

        person.social.setAge(age);
        person.social.setGender(gender);
        person.social.setFirstName(firstName);

        this.household.addResident(person);
        this.household.addOccupant(person);
        this.members.push(person);

        return person;
    }

    async autoGenerate(gameManager: GameManager): Promise<Person[]> {
        const numberOfPeople = Math.floor(Math.random() * (MAX_FAMILY_MEMBERS - MIN_FAMILY_MEMBERS + 1)) + MIN_FAMILY_MEMBERS;

        const gender = Math.random() > 0.5 ? Genders.Male : Genders.Female;
        const age = Math.floor(Math.random() * (MAX_AGE - ADULT_AGE + 1)) + ADULT_AGE;
        const name = fakerPT_BR.person.firstName(gender);

        const firstPerson = await this.createPerson(gameManager, age, gender, name);

        await this.generateBaseRelationships(gameManager, firstPerson, numberOfPeople);
        
        return this.members;
    }

    private async generateBaseRelationships(gameManager: GameManager, person: Person, leafDistance: number): Promise<void> {
        const personAge = person.social.getAge();
        const personGender = person.social.getGender();
    
        if (personAge < ADULT_AGE) return;
        if (leafDistance <= 0) return;
    
        const hasSpouse = person.social.hasRelationship(Relationships.Spouse);
        const shouldMarry = Math.random() < SPOUSE_PROBABILITY;
        let spouse: Person | null = null;
        if (!hasSpouse && shouldMarry) {
            const ageGap = Math.floor(Math.random() * (SPOUSE_MAX_AGE_GAP * 2 + 1)) - SPOUSE_MAX_AGE_GAP;
    
            const spouseAge = Math.max(ADULT_AGE, Math.min(MAX_AGE, personAge + ageGap));
            const spouseGender = personGender === Genders.Male ? Genders.Female : Genders.Male;
            const spouseName = fakerPT_BR.person.firstName(spouseGender);
    
            spouse = await this.createPerson(gameManager, spouseAge, spouseGender, spouseName);
    
            person.social.addRelationship(Relationships.Spouse, spouse);
            spouse.social.addRelationship(Relationships.Spouse, person);

            leafDistance--;
            await this.generateBaseRelationships(gameManager, spouse, leafDistance);
        }
    
        let numberOfChildren = this.generateNumberOfChildren(!!spouse);
        if (numberOfChildren > 0) {
            for (let i = 0; i < numberOfChildren; i++) {
                const parentAges = [personAge];
                const spouse = person.social.queryRelationship(Relationships.Spouse) as Person | null;
                const isCoparented = spouse && (Math.random() < CHILD_COPARENT_PROBABILITY);

                if (isCoparented && spouse) parentAges.push(spouse.social.getAge());
    
                const parentMinChildAges = parentAges.map(parentAge => Math.max(MIN_AGE, parentAge - PARENT_MAX_AGE_GAP));
                const parentMaxChildAges = parentAges.map(parentAge => Math.min(MAX_AGE, parentAge - PARENT_MIN_AGE_GAP));
    
                const minChildAge = Math.max(...parentMinChildAges);
                const maxChildAge = Math.min(...parentMaxChildAges);
                if (minChildAge > maxChildAge) continue;
    
                const ageGap = maxChildAge - minChildAge + 1;
                const childAge = Math.floor(Math.random() * ageGap) + minChildAge;
                const childGender = Math.random() > 0.5 ? Genders.Female : Genders.Male;
                const childName = fakerPT_BR.person.firstName(childGender);
    
                const child = await this.createPerson(gameManager, childAge, childGender, childName);
    
                const childPersonRelationship = this.inverseRelationship(Relationships.Child, personGender);
                person.social.addRelationship(Relationships.Child, child);
                child.social.addRelationship(childPersonRelationship, person);
    
                if (isCoparented && spouse) {
                    const spouseGender = spouse.social.getGender();
                    const childSpouseRelationship = this.inverseRelationship(Relationships.Child, spouseGender);
                    spouse.social.addRelationship(Relationships.Child, child);
                    child.social.addRelationship(childSpouseRelationship, spouse);
                }
    
                leafDistance--;
                await this.generateBaseRelationships(gameManager, child, leafDistance);
                if (leafDistance <= 0) return;
            }
        }
    }

    private generateNumberOfChildren(isMarried: boolean): number {
        let currentProbability = CHILD_PROBABILITY_BASIS - (isMarried ? 0 : CHILD_PROBABILITY_STEP);
        let numberOfChildren = 0;

        while (Math.random() < currentProbability) {
            numberOfChildren++;
            currentProbability = Math.max(CHILD_PROBABILITY_MIN, currentProbability - CHILD_PROBABILITY_STEP);
        }

        return numberOfChildren;
    }

    private inverseRelationship(relationship: Relationship, gender: Gender): Relationship {
        const inverseMap: { [key in Relationship]: Relationship } = {
            [Relationships.Father]: Relationships.Child,
            [Relationships.Mother]: Relationships.Child,
            [Relationships.Grandfather]: Relationships.Grandchild,
            [Relationships.Grandmother]: Relationships.Grandchild,
            [Relationships.Spouse]: Relationships.Spouse,
            [Relationships.Child]: gender === Genders.Male ? Relationships.Father : Relationships.Mother,
            [Relationships.Grandchild]: gender === Genders.Male ? Relationships.Grandfather : Relationships.Grandmother,
            [Relationships.Sibling]: Relationships.Sibling,
            [Relationships.Uncle]: gender === Genders.Male ? Relationships.Nephew : Relationships.Niece,
            [Relationships.Aunt]: gender === Genders.Male ? Relationships.Nephew : Relationships.Niece,
            [Relationships.Niece]: gender === Genders.Male ? Relationships.Uncle : Relationships.Aunt,
            [Relationships.Nephew]: gender === Genders.Male ? Relationships.Uncle : Relationships.Aunt,
        };
    
        return inverseMap[relationship];
    }

    getOverview(): FamilyOverview {
        const overview: FamilyOverview = {
            familyName: this.familyName,
            household: this.household.getOverview(),
            members: this.members.map(member => member.getOverview())
        };

        return overview;
    }
}
