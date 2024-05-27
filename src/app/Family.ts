import { fakerPT_BR } from '@faker-js/faker';

import GameManager from "app/GameManager";
import Person from 'app/Person';
import House from 'app/House';

import { Gender, Genders, Relationship, Relationships, RelationshipProbabilities, FamilyOverview } from 'types/Social';

const MIN_FAMILY_MEMBERS = 1;
const MAX_FAMILY_MEMBERS = 6;

const MIN_AGE = 0;
const MAX_AGE = 100;
const ADULT_AGE = 18;
const ELDERLY_AGE = 75;

const PARENT_MIN_AGE_GAP = 18; // Can't be lower than ADULT_AGE
const PARENT_MAX_AGE_GAP = 40;
const SPOUSE_MAX_AGE_GAP = 20;

export default class Family {
    familyName: string;
    household: House;
    members: Person[];

    constructor(household: House) {
        this.familyName = fakerPT_BR.person.lastName();
        this.household = household;
        this.members = [];
    }

    private randomAge(minAge: number, maxAge: number): number {
        return Math.floor(Math.random() * (maxAge - minAge)) + minAge;
    }

    private generateContextualAge(relationship: Relationship, existingPersonAge: number): number {
        if (relationship === Relationships.Sibling) {
            console.error(`existingPersonAge: ${existingPersonAge};`, `relationship: ${existingPersonAge};`,);
            throw new Error("We can't dynamically generate sibling ages. Ages should be calculated individually against parents.");
        }

        if (existingPersonAge < ADULT_AGE && (relationship === Relationships.Child)) {
            console.error(`existingPersonAge: ${existingPersonAge};`, `relationship: ${relationship};`,);
            throw new Error("Minors cannot have children.");
        }

        if (existingPersonAge < ADULT_AGE && (relationship === Relationships.Spouse)) {
            console.error(`existingPersonAge: ${existingPersonAge};`, `relationship: ${existingPersonAge};`,);
            throw new Error("Minors cannot marry.");
        }

        const ageRange = {
            [Relationships.Father]: { min: existingPersonAge + PARENT_MIN_AGE_GAP, max: existingPersonAge + PARENT_MAX_AGE_GAP },
            [Relationships.Mother]: { min: existingPersonAge + PARENT_MIN_AGE_GAP, max: existingPersonAge + PARENT_MAX_AGE_GAP },
            [Relationships.Spouse]: { min: existingPersonAge - SPOUSE_MAX_AGE_GAP, max: existingPersonAge + SPOUSE_MAX_AGE_GAP },
            [Relationships.Child]: { min: Math.max(existingPersonAge - PARENT_MAX_AGE_GAP, MIN_AGE), max: existingPersonAge - PARENT_MIN_AGE_GAP },
        };

        // Ensure the age range is within the global constraints
        const relationshipAgeRange = ageRange[relationship];
        relationshipAgeRange.min = Math.max(relationshipAgeRange.min, MIN_AGE);
        relationshipAgeRange.max = Math.min(relationshipAgeRange.max, MAX_AGE);

        // Validate the final age range
        if (relationshipAgeRange.min > relationshipAgeRange.max) {
            throw new Error(`Invalid age range for ${relationship}.`);
        }

        return this.randomAge(relationshipAgeRange.min, relationshipAgeRange.max);
    }

    async autoGenerate(gameManager: GameManager): Promise<Person[]> {
        const familySize = Math.floor(Math.random() * (MAX_FAMILY_MEMBERS - MIN_FAMILY_MEMBERS + 1)) + MIN_FAMILY_MEMBERS; // Between 1 and 5 members
        let familyMembers: Person[] = [];

        for (let i = 0; i < familySize; i++) {
            const housePosition = this.household.getEntrance();
            const gender: Gender = Math.random() > 0.5 ? Genders.Male : Genders.Female;
            const firstName = fakerPT_BR.person.firstName(gender);

            const person: Person = await gameManager.emitSingle("personSpawnRequest", housePosition);
            if (!person) {
                throw new Error("Invalid person to generate family member");
            }

            person.setIndoors(true);

            person.social.setHome(this.household);
            person.social.setFirstName(firstName);
            person.social.setFamilyName(this.familyName);
            person.social.setGender(gender);

            this.household.addResident(person);
            this.household.addOccupant(person);

            familyMembers.push(person);
        }

        familyMembers = this.addRelationships(familyMembers);
        this.members = familyMembers;

        return this.members;
    }

    private addRelationships(familyMembers: Person[]): Person[] {
        const personPool: Person[] = [];

        function inverseRelationship(relationship: Relationship, gender: Gender) {
            const inverseMap = {
                [Relationships.Father]: Relationships.Child,
                [Relationships.Mother]: Relationships.Child,
                [Relationships.Spouse]: Relationships.Spouse,
                [Relationships.Child]: gender === Genders.Male ? Relationships.Father : Relationships.Mother,
                [Relationships.Sibling]: Relationships.Sibling,
            };

            return inverseMap[relationship];
        }

        const corePerson = familyMembers.pop();
        if (!corePerson) {
            throw new Error("Invalid core person");
        }

        const age = this.randomAge(ADULT_AGE, ELDERLY_AGE);
        corePerson.social.setAge(age);
        personPool.push(corePerson);

        let currentPerson1 = corePerson;
        console.log(`-----------------------------------------------------------`);
        console.log(`Starting with ${currentPerson1.social.getFullName()} (${currentPerson1.social.getAge()}) as core member.`);

        while (familyMembers.length > 0) {
            const currentPerson2 = familyMembers.pop();
            if (!currentPerson2) {
                console.error(familyMembers, personPool);
                throw new Error("Invalid random member to generate relationship");
            }

            console.log(`${currentPerson1.social.getFullName()} (${currentPerson1.social.getAge()}) is current primary member.`);
            console.log(`Pulled ${currentPerson2.social.getFullName()} as second member.`);
            const relationship = this.createRelationship(currentPerson1, currentPerson2);
            const counterpart = inverseRelationship(relationship, currentPerson1.social.getGender());

            /*
            * Person1 has [relationship] Person2. We add [relationship] to Person1's relationships so Person1 *has* a [relationship] that is Person2.
            * Person2 has [counterpart] Person1. We add [counterpart] to Person2's relationships so Person2 *has* a [counterpart] that is Person1.
            */
            currentPerson1.social.addRelationship(relationship, currentPerson2);
            currentPerson2.social.addRelationship(counterpart, currentPerson1);

            const generatedAge = this.generateContextualAge(relationship, currentPerson1.social.getAge());
            currentPerson2.social.setAge(generatedAge);
            
            console.log(`${currentPerson1.social.getFullName()} (${currentPerson1.social.getAge()}) has ${relationship} ${currentPerson2.social.getFullName()}.`);
            console.log(`${currentPerson2.social.getFullName()} (${currentPerson2.social.getAge()}) has ${counterpart} ${currentPerson1.social.getFullName()}.`);

            personPool.push(currentPerson2);
            this.findAndAddSiblings(personPool);

            if (relationship === Relationships.Father || relationship === Relationships.Mother) {
                this.tryToMarryParents(currentPerson1, currentPerson2, relationship);
            }

            if (relationship === Relationships.Spouse) {
                this.tryToShareChildren(currentPerson1, currentPerson2);
            }

            const nextSourcePerson = personPool[Math.floor(Math.random() * personPool.length)];
            if (!nextSourcePerson) {
                console.error(personPool);
                throw new Error("Invalid next current person");
            }

            currentPerson1 = nextSourcePerson;
            console.log(`Next core person is going to be ${nextSourcePerson.social.getFullName()} (${nextSourcePerson.social.getAge()})`);
            console.log(`-----------------------------------------------------------`);
        }

        return personPool;
    }

    private findAndAddSiblings(personPool: Person[]): void {
        for (let i = 0; i < personPool.length; i++) {
            const person = personPool[i];
            if (!person) {
                continue;
            }
            const parents = person.social.queryRelationships([Relationships.Father, Relationships.Mother]);
    
            if (parents.length > 0) {
                for (let j = i + 1; j < personPool.length; j++) {
                    const otherPerson = personPool[j];
                    if (!otherPerson) {
                        continue;
                    }

                    const otherParents = otherPerson.social.queryRelationships([Relationships.Father, Relationships.Mother]);
                    const commonParents = parents.filter(parent => otherParents.includes(parent));
                    
                    const alreadySiblings = !person.social.hasRelationshipWith(Relationships.Sibling, otherPerson);
                    if (commonParents.length > 0 && !alreadySiblings) {
                        person.social.addRelationship(Relationships.Sibling, otherPerson);
                        otherPerson.social.addRelationship(Relationships.Sibling, person);
                        console.log(`${person.social.getFullName()} and ${otherPerson.social.getFullName()} are now siblings.`);
                    }
                }
            }
        }
    }

    private tryToMarryParents(person1: Person, person2: Person, relationship: Relationship): void {
        /* Additional marriage generation
        * if Person1 has person2 as a child and Person1 is unmarried, check if Person2 has another parent that can be married to Person1
        * if Person1 has Person2 as a parent and Person2 is unmarried, check if Person1 has another parent that can be married to Person2
        */
        const baseChance = 0.85;
        if (Math.random() > baseChance) {
            return;
        }

        const otherParentRelationship = relationship === Relationships.Father ? Relationships.Mother : Relationships.Father;
        const otherParent = person1.social.queryRelationship(otherParentRelationship) as Person;
        const areSiblings = person1.social.hasRelationshipWith(Relationships.Sibling, otherParent);
    
        if (otherParent && otherParent instanceof Person && !areSiblings) {
            person2.social.addRelationship(Relationships.Spouse, otherParent);
            otherParent.social.addRelationship(Relationships.Spouse, person2);
            console.log(`${person2.social.getFullName()} married ${otherParent.social.getFullName()}`);
        }
    }

    private tryToShareChildren(person1: Person, person2: Person): void {
        /* Shared children relationship generation
        * if Person1 and Person2 are married, check if they have children that can be shared between them
        */
        const baseChance = 0.75;
        if (Math.random() > baseChance) {
            return;
        }

        const childrenOf1 = person1.social.queryRelationship(Relationships.Child) as Person[];
        const childrenOf2 = person2.social.queryRelationship(Relationships.Child) as Person[];

        for (const child of childrenOf1) {
            if (childrenOf2.includes(child)) {
                continue;
            }

            const relationship = person2.social.getGender() === Genders.Male ? Relationships.Father : Relationships.Mother;
            person2.social.addRelationship(Relationships.Child, child);
            child.social.addRelationship(relationship, person2);
            console.log(`${person2.social.getFullName()} and ${person1.social.getFullName()} now share child ${child.social.getFullName()}`);
        }

        for (const child of childrenOf2) {
            if (childrenOf1.includes(child)) {
                continue;
            }

            const relationship = person1.social.getGender() === Genders.Male ? Relationships.Father : Relationships.Mother;
            person1.social.addRelationship(Relationships.Child, child);
            child.social.addRelationship(relationship, person1);
            console.log(`${person1.social.getFullName()} and ${person2.social.getFullName()} now share child ${child.social.getFullName()}`);
        }
    }

    private buildRelationshipProbability(person1: Person, person2: Person): RelationshipProbabilities {
        const person1Info = person1.social.getInfo();
        const person2Info = person2.social.getInfo();

        function parentProbability(age: number, hasExistingParent: boolean): number {
            if (hasExistingParent) {
                return 0;
            }

            const linearThreshold = 0.8; // 80% base chance to have living parents
            let parentProbability = linearThreshold - ((age - ADULT_AGE) * linearThreshold / (ELDERLY_AGE - ADULT_AGE)); // linear interpolation
            parentProbability = (parentProbability > linearThreshold) ? linearThreshold : parentProbability;
            parentProbability = (parentProbability < 0) ? 0 : parentProbability;

            return parentProbability;
        }

        function spouseProbability(age: number, hasExistingSpouse: boolean): number {
            const baseChance = 0.5;

            if (age < ADULT_AGE) {
                return 0;
            }

            if (hasExistingSpouse) {
                return 0;
            }

            return baseChance;
        }

        function childProbability(age: number, existingChildren: Person[]): number {
            const baseChance = 0.35;

            if (age < ADULT_AGE) {
                return 0;
            }

            // Base chance of having a child is 60%, then decreases by 10% for each existing child
            let probability = baseChance - (0.10 * existingChildren.length);
            probability = probability < 0 ? 0 : probability;

            if (age < 25) {
                probability -= 0.15;
            }

            return probability;
        }

        // Metrics related to person1's constraints
        const hasFather = person1.social.hasRelationship(Relationships.Father);
        const hasMother = person1.social.hasRelationship(Relationships.Mother);
        const hasSpouse = person1.social.hasRelationship(Relationships.Spouse);
        const children = person1.social.queryRelationship(Relationships.Child) as Person[];

        // Constraints that can be affected by outside factors, such as person2's gender
        const areSiblings = person1.social.hasRelationshipWith(Relationships.Sibling, person2);
        const isHavingFatherPossible = (!areSiblings) && (person2Info.gender === Genders.Male);
        const isHavinMotherPossible = (!areSiblings) && (person2Info.gender === Genders.Female);
        const isHavinSpousePossible = (!areSiblings) && (person2Info.gender !== person1Info.gender); // TODO: be inclusive
        const isHavingChildPossible = (!areSiblings);

        const probabilityMap: RelationshipProbabilities = {
            [Relationships.Father]: isHavingFatherPossible ? parentProbability(person1Info.age, hasFather) : 0,
            [Relationships.Mother]: isHavinMotherPossible ? parentProbability(person1Info.age, hasMother) : 0,
            [Relationships.Spouse]: isHavinSpousePossible ? spouseProbability(person1Info.age, hasSpouse) : 0,
            [Relationships.Child]: isHavingChildPossible ? childProbability(person1Info.age, children) : 0,
        };

        // Person1's probability of having a [keyof RelationshipProbabilities] who is Person2
        return probabilityMap;
    }

    private createRelationship(person1: Person, person2: Person): Relationship {
        const probabilityMap = this.buildRelationshipProbability(person1, person2);
        console.log(probabilityMap);

        const totalWeight = Object.values(probabilityMap).reduce((sum, weight) => sum + weight, 0);
        if (totalWeight <= 0) {
            console.error(probabilityMap);
            throw new Error("No relationship probability could be calculated");
        }

        let randomValue = Math.random() * totalWeight;
        let relationship;
        for (const relationshipName of Object.keys(probabilityMap) as (keyof RelationshipProbabilities)[]) {
            randomValue -= probabilityMap[relationshipName];
            if (randomValue <= 0) {
                relationship = relationshipName;
                break;
            }
        }

        if (!relationship) {
            console.error(probabilityMap, randomValue);
            throw new Error("No relationship type could be selected");
        }

        return relationship;
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
