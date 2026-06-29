import Building from 'game/Building';
import Person from 'game/Person';
import Vehicle from 'game/Vehicle';

import { Household } from 'types/Household';
import { FamilyTree, Node, Link } from 'types/FamilyTree';
import { HouseOverview, RelationshipMap } from 'types/Social';

const MAX_RESIDENTS = 8;
const MAX_OCCUPANTS = 10;
const MAX_VEHICLES = 2;

export default class House extends Building {
    private household: Household | null;
    private residents: Person[];

    private occupants: Person[];
    private garage: Vehicle[];

    private maxResidents: number;
    private maxOccupants: number;
    private maxVehicles: number;

    constructor(row: number, col: number, assetName: string | null) {
        super(row, col, assetName);

        this.maxResidents = MAX_RESIDENTS;
        this.maxOccupants = MAX_OCCUPANTS;
        this.maxVehicles = MAX_VEHICLES;

        this.household = null;
        this.residents = [];
        this.occupants = [];
        this.garage = [];
    }

    public setHousehold(household: Household): void {
        this.household = household;
    }

    // Detaches the household from this house — used on eviction (task 022), after which the house is vacant and
    // the (now homeless) household lives in the City's homeless registry.
    public clearHousehold(): void {
        this.household = null;
    }

    public getHousehold(): Household | null {
        return this.household;
    }

    // Display name for the household: the most common surname among its residents.
    public getHouseholdName(): string {
        const counts = new Map<string, number>();
        for (const resident of this.residents) {
            const surname = resident.social.getInfo().familyName;
            counts.set(surname, (counts.get(surname) ?? 0) + 1);
        }
        let best = '';
        let bestCount = 0;
        for (const [surname, count] of counts) {
            if (count > bestCount) {
                best = surname;
                bestCount = count;
            }
        }
        return best;
    }

    // Builds the family-tree graph from the current residents' relationships (links are kept within the
    // household). Cross-household trees derived from the genealogy pool are a later UI enhancement.
    public getFamilyTree(): FamilyTree {
        const nodes: Node[] = [];
        const links: Link[] = [];
        const personIndexMap = new Map<Person, number>();

        this.residents.forEach((person, index) => {
            personIndexMap.set(person, index);
            nodes.push({ name: person.social.getInfo().firstName });
        });

        this.residents.forEach((person, index) => {
            const relationships = person.social.getInfo().relationships;
            for (const key of Object.keys(relationships) as Array<keyof RelationshipMap>) {
                const related = relationships[key];
                if (!related) {
                    continue;
                }
                const relatedPeople = Array.isArray(related) ? related : [related];
                for (const relatedPerson of relatedPeople) {
                    const targetIndex = personIndexMap.get(relatedPerson);
                    if (targetIndex !== undefined) {
                        links.push({ source: index, target: targetIndex, label: key });
                    }
                }
            }
        });

        return { nodes, links };
    }

    public addResident(person: Person): void {
        if (this.residents.length >= this.maxResidents) {
            return;
        }
        this.residents.push(person);
    }

    public removeResident(person: Person): void {
        const index = this.residents.indexOf(person);
        if (index !== -1) {
            this.residents.splice(index, 1);
        }
    }

    public addOccupant(person: Person): void {
        if (this.occupants.length >= this.maxOccupants) {
            return;
        }
        this.occupants.push(person);
    }

    public removeOccupant(person: Person): void {
        const index = this.occupants.indexOf(person);
        if (index !== -1) {
            this.occupants.splice(index, 1);
        }
    }

    public addVehicle(vehicle: Vehicle): void {
        if (this.garage.length >= this.maxVehicles) {
            return;
        }
        this.garage.push(vehicle);
    }

    public removeVehicle(vehicle: Vehicle): void {
        const index = this.garage.indexOf(vehicle);
        if (index !== -1) {
            this.garage.splice(index, 1);
        }
    }

    public getResidents(): Person[] {
        return this.residents;
    }

    public getOccupants(): Person[] {
        return this.occupants;
    }

    public getVehicles(): Vehicle[] {
        return this.garage;
    }

    public getOverview(): HouseOverview {
        return {
            maxResidents: this.maxResidents,
            maxOccupants: this.maxOccupants,
            maxVehicles: this.maxVehicles,
        };
    }
}