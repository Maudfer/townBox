import { fakerPT_BR } from '@faker-js/faker';

import GameManager from 'game/GameManager';
import Person from 'game/Person';
import House from 'game/House';

import { FamilyTree, Node, Link } from 'types/FamilyTree';
import { Gender, Genders, Relationship, Relationships, RelationshipMap, FamilyOverview } from 'types/Social';

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
        let numberOfPeople = Math.floor(Math.random() * (MAX_FAMILY_MEMBERS - MIN_FAMILY_MEMBERS + 1)) + MIN_FAMILY_MEMBERS;

        const gender = Math.random() > 0.5 ? Genders.Male : Genders.Female;
        const age = Math.floor(Math.random() * (MAX_AGE - ADULT_AGE + 1)) + ADULT_AGE;
        const name = fakerPT_BR.person.firstName(gender);

        numberOfPeople--;
        const firstPerson = await this.createPerson(gameManager, age, gender, name);

        await this.generateBaseRelationships(gameManager, firstPerson, numberOfPeople);
        this.assignExtendedRelationships();

        return this.members;
    }

    private async generateBaseRelationships(gameManager: GameManager, person: Person, leafDistance: number): Promise<void> {
        const personAge = person.social.getAge();
        const personGender = person.social.getGender();
    
        if (personAge < ADULT_AGE) return;
        if (leafDistance <= 0) return;
    
        // Spouse creation
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
    
        // Children creation
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

    assignExtendedRelationships(): void {
        const parentMap = new Map<Person, Person[]>();
        const childrenMap = new Map<Person, Person[]>();

        // Build parentMap and childrenMap
        for (const person of this.members) {
            const parents: Person[] = [];

            const father = person.social.queryRelationship(Relationships.Father) as Person | null;
            const mother = person.social.queryRelationship(Relationships.Mother) as Person | null;

            if (father) {
                parents.push(father);
                if (!childrenMap.has(father)) childrenMap.set(father, []);
                childrenMap.get(father)!.push(person);
            }

            if (mother) {
                parents.push(mother);
                if (!childrenMap.has(mother)) childrenMap.set(mother, []);
                childrenMap.get(mother)!.push(person);
            }

            if (parents.length > 0) {
                parentMap.set(person, parents);
            }
        }

        // Assign siblings
        for (const person of this.members) {
            const siblings = new Set<Person>();
            const parents = parentMap.get(person) || [];

            for (const parent of parents) {
                const siblingsFromParent = childrenMap.get(parent) || [];
                for (const sibling of siblingsFromParent) {
                    if (sibling !== person) {
                        siblings.add(sibling);
                    }
                }
            }

            for (const sibling of siblings) {
                person.social.addRelationship(Relationships.Sibling, sibling);
                sibling.social.addRelationship(Relationships.Sibling, person);
            }
        }

        // Assign grandparents
        for (const person of this.members) {
            const grandparents = new Set<Person>();
            const parents = parentMap.get(person) || [];

            for (const parent of parents) {
                const grandparentsOfParent = parentMap.get(parent) || [];
                for (const grandparent of grandparentsOfParent) {
                    grandparents.add(grandparent);
                }
            }

            for (const grandparent of grandparents) {
                const grandparentGender = grandparent.social.getGender();
                const grandparentRelationship = grandparentGender === Genders.Male ? Relationships.Grandfather : Relationships.Grandmother;

                person.social.addRelationship(grandparentRelationship, grandparent);
                grandparent.social.addRelationship(Relationships.Grandchild, person);
            }
        }

        // Assign uncles and aunts
        for (const person of this.members) {
            const unclesAndAunts = new Set<Person>();
            const parents = parentMap.get(person) || [];

            for (const parent of parents) {
                const parentSiblings = parent.social.queryRelationship(Relationships.Sibling) as Person[] | null;
                if (parentSiblings) {
                    for (const uncleAunt of parentSiblings) {
                        // Redundant but safe check
                        if (uncleAunt !== parent) { 
                            unclesAndAunts.add(uncleAunt);
                        }
                    }
                }
            }

            for (const uncleAunt of unclesAndAunts) {
                const personGender = person.social.getGender();
                const gender = uncleAunt.social.getGender();
                const relationship = gender === Genders.Male ? Relationships.Uncle : Relationships.Aunt;

                person.social.addRelationship(relationship, uncleAunt);
                uncleAunt.social.addRelationship(this.inverseRelationship(relationship, personGender), person);
            }
        }

        // Assign nieces and nephews
        for (const person of this.members) {
            const niecesAndNephews = new Set<Person>();
            const siblings = person.social.queryRelationship(Relationships.Sibling) as Person[] | null;

            if (siblings) {
                for (const sibling of siblings) {
                    const siblingChildren = childrenMap.get(sibling) || [];
                    for (const child of siblingChildren) {
                        niecesAndNephews.add(child);
                    }
                }
            }

            for (const nieceNephew of niecesAndNephews) {
                const personGender = person.social.getGender();
                const gender = nieceNephew.social.getGender();
                const relationship = gender === Genders.Male ? Relationships.Nephew : Relationships.Niece;

                person.social.addRelationship(relationship, nieceNephew);
                nieceNephew.social.addRelationship(this.inverseRelationship(relationship, personGender), person);
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

    getFamilyTree(): FamilyTree {
        const nodes: Node[] = [];
        const links: Link[] = [];
        const personIndexMap = new Map<Person, number>();

        // Build nodes
        this.members.forEach((person, index) => {
            personIndexMap.set(person, index);
            nodes.push({ name: person.social.getInfo().firstName });
        });

        // Build links
        this.members.forEach((person, index) => {
            const relationships = person.social.getInfo().relationships;

            for (const key of Object.keys(relationships) as Array<keyof RelationshipMap>) {
                const related = relationships[key];

                if (!related) {
                    continue;
                }

                if (Array.isArray(related)) {
                    related.forEach((relatedPerson) => {
                        const targetIndex = personIndexMap.get(relatedPerson);
                        if (targetIndex !== undefined) {
                            links.push({
                                source: index,
                                target: targetIndex,
                                label: key,
                            });
                        }
                    });
                } else {
                    const targetIndex = personIndexMap.get(related);
                    if (targetIndex !== undefined) {
                        links.push({
                            source: index,
                            target: targetIndex,
                            label: key,
                        });
                    }
                }
            }
        });

        return { nodes, links };
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
