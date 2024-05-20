import { fakerPT_BR } from '@faker-js/faker';

import GameManager from "app/GameManager";
import Person from 'app/Person';
import House from 'app/House';

import { Gender, Genders, Relationship, Relationships } from 'types/Social';

const MIN_FAMILY_MEMBERS = 1;
const MAX_FAMILY_MEMBERS = 5;
const MIN_AGE = 0;
const MAX_AGE = 100;
const ADULT_AGE = 18;

export default class Family {
    familyName: string;
    household: House;
    members: Person[];

    constructor(household: House) {
        this.familyName = fakerPT_BR.person.lastName();
        this.household = household;
        this.members = [];
    }

    public async autoGenerate(gameManager:  GameManager): Promise<Person[]> {
        const familySize = Math.floor(Math.random() * MAX_FAMILY_MEMBERS) + MIN_FAMILY_MEMBERS; // Between 1 and 5 members
        const ages = this.generateAges(familySize);

        const familyMembers: Person[] = [];

        for (let i = 0; i < familySize; i++) {
            const gender: Gender = Math.random() > 0.5 ? Genders.Male : Genders.Female;
            const firstName = fakerPT_BR.person.firstName(gender);
            const housePosition = this.household.getEntrance();
            
            const age = ages[i];
            if (!age) {
                throw new Error("Invalid age to generate family member");
            }

            const person: Person = await gameManager.emitSingle("personSpawnRequest", housePosition);
            if (!person) {
                throw new Error("Invalid person to generate family member");
            }

            person.setIndoors(true);
            person.social.setFirstName(firstName);
            person.social.setHome(this.household);
            person.social.setAge(age);
            person.social.setGender(gender);

            this.household.addResident(person);
            this.household.addOccupant(person);

            familyMembers.push(person);
        }


        for (let i = 0; i < familyMembers.length; i++) {
            for (let j = 0; j < familyMembers.length; j++) {
                const person1 = familyMembers[i];
                const person2 = familyMembers[j];

                if ( (i !== j) && person1 && person2) {
                    this.assignRelationship(person1, person2);
                }
            }
        }

        this.members = familyMembers;
        return familyMembers;
    }

    private generateAges(familySize: number): number[] {
        const ages: number[] = [];

        for (let i = 0; i < familySize; i++) {
            let age: number;
            if (ages.length === 0) {
                age = Math.floor(Math.random() * (MAX_AGE - ADULT_AGE)) + ADULT_AGE; // Ensure at least one adult
            } else {
                age = Math.floor(Math.random() * (MAX_AGE - MIN_AGE)) + MIN_AGE;
            }
            ages.push(age);
        }

        const sortedAges = ages.sort((a, b) => a - b);
        return sortedAges;
    }

    private assignRelationship(person1: Person, person2: Person) {
        const person1Info = person1.social.getInfo();
        const person2Info = person2.social.getInfo();

        const ageDifference = person1Info.age - person2Info.age;
        let relationship: Relationship;



        if (ageDifference >= ADULT_AGE && !person1Info.relationships[Relationships.Father] && !person2Info.relationships[Relationships.Mother]) {
            relationship = person1Info.gender === Genders.Male ? Relationships.Father : Relationships.Mother;
        } else if (ageDifference <= -ADULT_AGE) {
            relationship = Relationships.Child;
        } else {
            relationship = Relationships.Sibling;
        }

        person1.social.addRelationship(relationship, person2);

        // Assign inverse relationship
        if (relationship === Relationships.Father || relationship === Relationships.Mother) {
            person2.social.addRelationship(Relationships.Child, person1);
        } else if (relationship === Relationships.Child) {
            if (person1Info.gender === Genders.Male) {
                person2.social.addRelationship(Relationships.Father, person1);
            } else {
                person2.social.addRelationship(Relationships.Mother, person1);
            }
        } else if (relationship === Relationships.Sibling) {
            person2.social.addRelationship(Relationships.Sibling, person1);
        }
    }

    toString(): string {
        return `Family: ${this.familyName}, Members: ${this.members.map(member => member.toString()).join(', ')}`;
    }
}