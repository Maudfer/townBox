import { fakerPT_BR } from '@faker-js/faker';

import GameManager from "app/GameManager";
import Person from 'app/Person';
import House from 'app/House';

import { Gender, Genders, Relationships, FamilyOverview } from 'types/Social';

const MIN_FAMILY_MEMBERS = 1;
const MAX_FAMILY_MEMBERS = 5;
const MIN_AGE = 0;
const MAX_AGE = 100;
const ADULT_AGE = 18;
const COUPLE_MAX_AGE_DIFF = 25;
const SINGLE_PARENT_PROBABILITY = 0.3; // Probability of assigning a child to a single parent

export default class Family {
    familyName: string;
    household: House;
    members: Person[];

    constructor(household: House) {
        this.familyName = fakerPT_BR.person.lastName();
        this.household = household;
        this.members = [];
    }

    async autoGenerate(gameManager: GameManager): Promise<Person[]> {
        const familySize = Math.floor(Math.random() * (MAX_FAMILY_MEMBERS - MIN_FAMILY_MEMBERS + 1)) + MIN_FAMILY_MEMBERS; // Between 1 and 5 members
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
            person.social.setFamilyName(this.familyName);
            person.social.setHome(this.household);
            person.social.setAge(age);
            person.social.setGender(gender);

            this.household.addResident(person);
            this.household.addOccupant(person);

            familyMembers.push(person);
        }

        // Assign relationships properly
        this.assignRelationships(familyMembers);

        this.members = familyMembers;
        return familyMembers;
    }

    private generateAges(familySize: number): number[] {
        const ages: number[] = [];

        // Ensure at least one adult
        const adultAge = Math.floor(Math.random() * (MAX_AGE - ADULT_AGE)) + ADULT_AGE;
        ages.push(adultAge);

        for (let i = 1; i < familySize; i++) {
            let age: number;
            if (Math.random() > 0.5) {
                // Generate a child's age
                age = Math.floor(Math.random() * (ADULT_AGE - MIN_AGE)) + MIN_AGE;
            } else {
                // Generate another adult's age
                age = Math.floor(Math.random() * (MAX_AGE - ADULT_AGE)) + ADULT_AGE;
            }
            ages.push(age);
        }

        return ages.sort((a, b) => a - b);
    }

    private assignRelationships(familyMembers: Person[]): void {
        const children: Person[] = [];
        const adults: Person[] = [];

        // Separate adults and children
        familyMembers.forEach(person => {
            if (person.social.getInfo().age >= ADULT_AGE) {
                adults.push(person);
            } else {
                children.push(person);
            }
        });

        const couples: [Person, Person][] = [];
        const singles: Person[] = [...adults]; // Initially all adults are single

        // Form couples based on age similarity
        for (let i = 0; i < adults.length; i++) {
            for (let j = i + 1; j < adults.length; j++) {
                const person1 = adults[i];
                const person2 = adults[j];
                if (person1 && person2){
                    const ageDiff = Math.abs(person1.social.getInfo().age - person2.social.getInfo().age);
                    if (ageDiff <= COUPLE_MAX_AGE_DIFF) {
                        couples.push([person1, person2]);
                        singles.splice(singles.indexOf(person1), 1);
                        singles.splice(singles.indexOf(person2), 1);
                        break; // Move to the next adult
                    }
                }
            }
        }

        // Assign children to couples or single parents
        children.forEach(child => {
            const assignToSingleParent = Math.random() < SINGLE_PARENT_PROBABILITY;

            if (!assignToSingleParent && couples.length > 0) {
                const couple = couples[Math.floor(Math.random() * couples.length)];
                if (!couple) {
                    return;
                }

                this.assignParentChildRelationship(couple[0], child);
                this.assignParentChildRelationship(couple[1], child);
            } else if (singles.length > 0) {
                const singleParent = singles[Math.floor(Math.random() * singles.length)];
                if (!singleParent) {
                    return;
                }

                this.assignParentChildRelationship(singleParent, child);
            } else if (couples.length > 0) {
                // Fallback if no singles available but couples exist
                const couple = couples[Math.floor(Math.random() * couples.length)];
                if (!couple) {
                    return;
                }

                this.assignParentChildRelationship(couple[0], child);
                this.assignParentChildRelationship(couple[1], child);
            }
        });

        // Assign sibling relationships
        this.assignSiblingRelationships(children);

        // Check for individuals without any relationships and assign them as siblings to those without parents
        this.assignLeftoverSiblings(familyMembers);
    }

    private assignParentChildRelationship(person1: Person, person2: Person): void {
        const person1Info = person1.social.getInfo();
        const person2Info = person2.social.getInfo();

        const ageDifference = person1Info.age - person2Info.age;

        if (ageDifference >= ADULT_AGE) {
            const relationship = person1Info.gender === Genders.Male ? Relationships.Father : Relationships.Mother;
            person1.social.addRelationship(Relationships.Child, person2);
            person2.social.addRelationship(relationship, person1);
        }
    }

    private assignSiblingRelationships(children: Person[]): void {
        for (let i = 0; i < children.length; i++) {
            for (let j = i + 1; j < children.length; j++) {
                const person1 = children[i];
                const person2 = children[j];
                
                if (person1 && person2) {
                    const person1Parents = person1.social.getParents();
                    const person2Parents = person2.social.getParents();

                    if (person1Parents.some(parent => person2Parents.includes(parent))) {
                        person1.social.addRelationship(Relationships.Sibling, person2);
                        person2.social.addRelationship(Relationships.Sibling, person1);
                    }
                }
            }
        }
    }

    private assignLeftoverSiblings(familyMembers: Person[]): void {
        const noRelationships: Person[] = familyMembers.filter(person => {
            const relationships = person.social.getRelationships();
            const hasRelationships = Object.keys(relationships).length > 0;

            return !hasRelationships;
        });

        const noParents: Person[] = familyMembers.filter(person => {
            const relationships = person.social.getRelationships();
            const hasRelationships = Object.keys(relationships).length > 0;
            const hasParents = person.social.getParents().length > 0;
            
            return !hasParents && hasRelationships;
        });
    
        noRelationships.forEach(person => {
            if (noParents.length > 0) {
                const sibling = noParents[Math.floor(Math.random() * noParents.length)];

                if (sibling) {
                    console.log("Siblings:", person.social.getFullName(), sibling.social.getFullName());
                    person.social.addRelationship(Relationships.Sibling, sibling);
                    sibling.social.addRelationship(Relationships.Sibling, person);
                }
            }
        });
    }

    getOverview(): FamilyOverview {
        const overview: FamilyOverview = {
            familyName: this.familyName,
            household: this.household,
            members: this.members.map(member => member.getOverview())
        };

        return overview;
    }
}
