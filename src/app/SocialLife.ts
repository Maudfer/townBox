import Person from 'app/Person';
import House from 'app/House';

import { Gender, Genders, Relationship, Relationships, RelationshipList, SocialInfo } from 'types/Social';

type Home = House | null;

export default class SocialLife{
    private home: Home;

    private firstName: string;
    private familyName: string;
    private age: number;
    private gender: Gender;

    private relationships: RelationshipList;

    constructor() {
        this.home = null;

        this.firstName = "";
        this.familyName = "";
        this.age = 0;
        this.gender = Genders.Male;
        
        this.relationships = {};
    }

    addRelationship(relationship: Relationship, person: Person): void {
        if (relationship === Relationships.Father || relationship === Relationships.Mother) {
            if (this.relationships[relationship]?.length) {
                console.warn(`Person already has a ${relationship}`, person);
                // Already has a father/mother, so we skip adding another one
                return;
            }
        }
        if (!this.relationships[relationship]) {
            this.relationships[relationship] = [];
        }
        this.relationships[relationship]?.push(person);
    }

    getFullName(): string {
        return `${this.firstName} ${this.familyName}`;
    }

    getHome(): Home {
        return this.home;
    }

    setHome(home: House): void {
        this.home = home;
    }

    setFirstName(firstName: string): void {
        this.firstName = firstName;
    }

    setFamilyName(familyName: string): void {
        this.familyName = familyName;
    }

    setAge(age: number): void {
        this.age = age;
    }

    setGender(gender: Gender): void {
        this.gender = gender;
    }

    getInfo(): SocialInfo {
        return {
            firstName: this.firstName,
            familyName: this.familyName,
            age: this.age,
            gender: this.gender,
            relationships: this.relationships,
        }
    }

    toString(): string {
        return `${this.getFullName()}, Age: ${this.age}, Gender: ${this.gender}`;
    }
}