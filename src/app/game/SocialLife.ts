import Person from 'game/Person';
import House from 'game/House';
import Clock from 'game/Clock';

import { Gender, Genders, Relationship, Relationships, RelationshipMap, SocialInfo } from 'types/Social';
import { PersonId } from 'types/Genealogy';

type Home = House | null;

export default class SocialLife {
    // The clock is shared by all SocialLife views so age can derive from the live in-game date without each
    // person holding a GameManager/scene reference. Set once by GameManager when the clock is created.
    private static clock: Clock | null = null;

    static setClock(clock: Clock | null): void {
        SocialLife.clock = clock;
    }

    private home: Home;

    // Links this materialized person back to its genealogy pool record (null for manually created people).
    private personId: PersonId | null;

    private firstName: string;
    private familyName: string;
    private age: number;
    private birthTick: number | null;
    private gender: Gender;

    private relationships: RelationshipMap;

    constructor() {
        this.home = null;
        this.personId = null;

        this.firstName = "";
        this.familyName = "";
        this.age = -1;
        this.birthTick = null;
        this.gender = Genders.Male;

        this.relationships = {};
    }

    hasRelationship(relationship: Relationship): boolean {
        return !!this.relationships[relationship];
    }

    hasRelationshipWith(relationship: Relationship, person: Person): boolean {
        if (Array.isArray(this.relationships[relationship])) {
            return (this.relationships[relationship] as Person[]).includes(person);
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
                (this.relationships[relationship] as unknown as Person[]) = [];
            }

            if (Array.isArray(this.relationships[relationship])) {
                const alreadyExists = (this.relationships[relationship] as Person[]).includes(person);

                if (!alreadyExists) {
                    (this.relationships[relationship] as Person[]).push(person);
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
                const index = (this.relationships[relationship] as Person[]).indexOf(person);

                if (index !== -1) {
                    (this.relationships[relationship] as Person[]).splice(index, 1);
                }
            }
        }
    }

    queryRelationship(relationship: Relationship): Person[] | Person | null {
        return this.relationships[relationship] || null;
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

    setHome(home: House | null): void {
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

    setBirthTick(birthTick: number | null): void {
        this.birthTick = birthTick;
    }

    getBirthTick(): number | null {
        return this.birthTick;
    }

    setPersonId(personId: PersonId | null): void {
        this.personId = personId;
    }

    getPersonId(): PersonId | null {
        return this.personId;
    }

    setGender(gender: Gender): void {
        this.gender = gender;
    }

    // Age derives from the live clock when this person is backed by a genealogy birthTick; otherwise it
    // falls back to the stored age (e.g. manually created/test people without a birthTick).
    getAge(): number {
        if (this.birthTick !== null && SocialLife.clock) {
            const ticksPerYear = SocialLife.clock.getTicksPerYear();
            const age = Math.floor((SocialLife.clock.getCurrentTick() - this.birthTick) / ticksPerYear);
            return Math.max(0, age);
        }
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
