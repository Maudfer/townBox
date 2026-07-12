import Person from 'game/agents/Person';
import Vehicle from 'game/agents/Vehicle';
import House from 'game/world/House';
import { Household, HouseholdArrangements } from 'types/Household';
import { Genders, Relationships } from 'types/Social';

function makePerson(firstName: string, familyName: string): Person {
    const person = new Person(0, 0);
    person.social.setFirstName(firstName);
    person.social.setFamilyName(familyName);
    person.social.setGender(Genders.Male);
    return person;
}

function makeHousehold(overrides: Partial<Household> = {}): Household {
    return {
        id: 'household-1',
        houseKey: '5-5',
        headId: '1',
        memberIds: ['1'],
        arrangement: HouseholdArrangements.Nuclear,
        ...overrides,
    };
}

describe('House', () => {
    test('household is null until set, and clearable (task 022 eviction)', () => {
        const house = new House(5, 5, null);
        expect(house.getHousehold()).toBeNull();

        const household = makeHousehold();
        house.setHousehold(household);
        expect(house.getHousehold()).toBe(household);

        house.clearHousehold();
        expect(house.getHousehold()).toBeNull();
    });

    describe('getHouseholdName', () => {
        test('returns an empty string with no residents', () => {
            const house = new House(0, 0, null);
            expect(house.getHouseholdName()).toBe('');
        });

        test('returns the most common surname among residents', () => {
            const house = new House(0, 0, null);
            house.addResident(makePerson('Alice', 'Smith'));
            house.addResident(makePerson('Bob', 'Smith'));
            house.addResident(makePerson('Cara', 'Jones'));

            expect(house.getHouseholdName()).toBe('Smith');
        });
    });

    describe('resident management (capacity MAX_RESIDENTS = 8)', () => {
        test('addResident/removeResident and getResidents', () => {
            const house = new House(0, 0, null);
            const alice = makePerson('Alice', 'Smith');
            const bob = makePerson('Bob', 'Smith');

            house.addResident(alice);
            house.addResident(bob);
            expect(house.getResidents()).toEqual([alice, bob]);

            house.removeResident(alice);
            expect(house.getResidents()).toEqual([bob]);

            // Removing someone not present is a no-op.
            house.removeResident(alice);
            expect(house.getResidents()).toEqual([bob]);
        });

        test('addResident is capped at 8', () => {
            const house = new House(0, 0, null);
            for (let i = 0; i < 10; i++) {
                house.addResident(makePerson(`Person${i}`, 'Family'));
            }
            expect(house.getResidents()).toHaveLength(8);
        });
    });

    describe('occupant management (capacity MAX_OCCUPANTS = 10)', () => {
        test('addOccupant/removeOccupant and getOccupants', () => {
            const house = new House(0, 0, null);
            const alice = makePerson('Alice', 'Smith');

            house.addOccupant(alice);
            expect(house.getOccupants()).toEqual([alice]);

            house.removeOccupant(alice);
            expect(house.getOccupants()).toEqual([]);

            // Removing someone not present is a no-op.
            expect(() => house.removeOccupant(alice)).not.toThrow();
        });

        test('addOccupant is capped at 10', () => {
            const house = new House(0, 0, null);
            for (let i = 0; i < 12; i++) {
                house.addOccupant(makePerson(`Occupant${i}`, 'Family'));
            }
            expect(house.getOccupants()).toHaveLength(10);
        });
    });

    describe('garage management (capacity MAX_VEHICLES = 2)', () => {
        test('addVehicle/removeVehicle and getVehicles', () => {
            const house = new House(0, 0, null);
            const car = new Vehicle(0, 0);

            house.addVehicle(car);
            expect(house.getVehicles()).toEqual([car]);

            house.removeVehicle(car);
            expect(house.getVehicles()).toEqual([]);

            // Removing a vehicle not present is a no-op.
            expect(() => house.removeVehicle(car)).not.toThrow();
        });

        test('addVehicle is capped at 2', () => {
            const house = new House(0, 0, null);
            house.addVehicle(new Vehicle(0, 0));
            house.addVehicle(new Vehicle(0, 0));
            house.addVehicle(new Vehicle(0, 0));
            expect(house.getVehicles()).toHaveLength(2);
        });
    });

    describe('getFamilyTree', () => {
        test('builds nodes for every resident and links from single- and array-valued relationships', () => {
            const house = new House(0, 0, null);
            const parent = makePerson('Pat', 'Smith');
            const child = makePerson('Cody', 'Smith');
            const sibling = makePerson('Sam', 'Smith');

            parent.social.addRelationship(Relationships.Child, child);
            child.social.addRelationship(Relationships.Father, parent);
            child.social.addRelationship(Relationships.Sibling, sibling);
            sibling.social.addRelationship(Relationships.Sibling, child);

            house.addResident(parent);
            house.addResident(child);
            house.addResident(sibling);

            const tree = house.getFamilyTree();

            expect(tree.nodes).toEqual([{ name: 'Pat' }, { name: 'Cody' }, { name: 'Sam' }]);
            expect(tree.links).toEqual(
                expect.arrayContaining([
                    { source: 0, target: 1, label: Relationships.Child },
                    { source: 1, target: 0, label: Relationships.Father },
                    { source: 1, target: 2, label: Relationships.Sibling },
                    { source: 2, target: 1, label: Relationships.Sibling },
                ])
            );
        });

        test('ignores relationships pointing outside the household', () => {
            const house = new House(0, 0, null);
            const resident = makePerson('Resident', 'Smith');
            const outsider = makePerson('Outsider', 'Jones');
            resident.social.addRelationship(Relationships.Sibling, outsider);

            house.addResident(resident);

            const tree = house.getFamilyTree();
            expect(tree.nodes).toEqual([{ name: 'Resident' }]);
            expect(tree.links).toEqual([]);
        });

        test('an empty household yields an empty tree', () => {
            const house = new House(0, 0, null);
            expect(house.getFamilyTree()).toEqual({ nodes: [], links: [] });
        });
    });

    test('getOverview reports the capacity constants', () => {
        const house = new House(0, 0, null);
        expect(house.getOverview()).toEqual({
            maxResidents: 8,
            maxOccupants: 10,
            maxVehicles: 2,
        });
    });
});
