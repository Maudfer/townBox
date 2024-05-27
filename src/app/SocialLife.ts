import Person from 'app/Person';
import House from 'app/House';

import { Gender, Genders, Relationship, Relationships, RelationshipMap, SocialInfo } from 'types/Social';

type Home = House | null;

export default class SocialLife {
    private home: Home;

    private firstName: string;
    private familyName: string;
    private age: number;
    private gender: Gender;

    private relationships: RelationshipMap;

    constructor() {
        this.home = null;

        this.firstName = "";
        this.familyName = "";
        this.age = -1;
        this.gender = Genders.Male;

        this.relationships = {};
    }

    hasRelationship(relationship: Relationship): boolean {
        return !!this.relationships[relationship];
    }

    hasRelationshipWith(relationship: Relationship, person: Person): boolean {
        if (Array.isArray(this.relationships[relationship])) {
            return this.relationships[relationship].includes(person);
        } else {
            return this.relationships[relationship] === person;
        }
    }

    addRelationship(relationship: Relationship, person: Person): void {
        const singlePersonRelationships = [
            Relationships.Father, 
            Relationships.Mother, 
            Relationships.Spouse,
        ];

        if (singlePersonRelationships.includes(relationship)) {
            (this.relationships[relationship] as Person) = person; // Direct assignment for single-value relationships
        } else {

            if (!this.relationships[relationship]) {
                // Below conversion is needed, but we know it's safe because of the singlePersonRelationships check
                (this.relationships[relationship] as unknown as Person[]) = [];
            }

            if (Array.isArray(this.relationships[relationship])) {
                const alreadyExists = this.relationships[relationship].includes(person);

                if (!alreadyExists) {
                    this.relationships[relationship].push(person);
                }
            }
        }
    }

    removeRelationship(relationship: keyof RelationshipMap, person: Person): void {
        if (relationship === Relationships.Father || relationship === Relationships.Mother) {
            if (this.relationships[relationship] === person) {
                delete this.relationships[relationship]; // Remove the single-value relationship
            }
        } else {
            if (Array.isArray(this.relationships[relationship])) {
                const index = this.relationships[relationship].indexOf(person);

                if (index !== -1) {
                    this.relationships[relationship].splice(index, 1);
                }
            }
        }
    }

    queryRelationships(queriedRelationships: Relationship[]): Person[] {
        const relatedPeople: Person[] = [];

        for (const relationship of queriedRelationships) {
            if (this.relationships[relationship]) {
                if (Array.isArray(this.relationships[relationship])) {
                    relatedPeople.push(...this.relationships[relationship]);
                } else {
                    relatedPeople.push(this.relationships[relationship]);
                }
            }
        }

        return relatedPeople;
    }

    queryRelationship(relationship: Relationship): Person[] | Person {
        const relatedPeople: Person[] = [];

        if (this.relationships[relationship]) {
            if (Array.isArray(this.relationships[relationship])) {
                relatedPeople.push(...this.relationships[relationship]);
            } else {
                return this.relationships[relationship];
            }
        }

        return relatedPeople;
    }

    getParents(): Person[] {
        const parents: Person[] = [];
        if (this.relationships[Relationships.Father]) {
            parents.push(this.relationships[Relationships.Father]);
        }
        if (this.relationships[Relationships.Mother]) {
            parents.push(this.relationships[Relationships.Mother]);
        }
        return parents;
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

    getAge(): number {
        return this.age;
    }

    getGender(): Gender {
        return this.gender;
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
}
