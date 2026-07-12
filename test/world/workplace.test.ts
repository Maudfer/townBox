import Person from 'game/agents/Person';
import Vehicle from 'game/agents/Vehicle';
import Workplace from 'game/world/Workplace';
import { BusinessInstance } from 'types/Business';
import { JobPosition } from 'types/Work';

function makeJob(title: string, requirements: string[] = []): JobPosition {
    return {
        title,
        salary: 1000,
        requirements,
        shiftStart: 9 * 60,
        shiftEnd: 17 * 60,
    };
}

function makeBusiness(positions: JobPosition[]): BusinessInstance {
    return {
        blueprintKey: 'supermarket',
        name: 'Test Co',
        lineOfWork: 'Super Market',
        size: positions.length,
        positions,
    };
}

function makePerson(firstName: string): Person {
    const person = new Person(0, 0);
    person.social.setFirstName(firstName);
    person.social.setFamilyName('Test');
    return person;
}

describe('Workplace', () => {
    test('calculateDepth is (row + 1) * 10 (inherited from Building)', () => {
        const workplace = new Workplace(4, 0, null);
        expect(workplace.calculateDepth()).toBe(50);
    });

    test('has no business and no open positions until one is assigned', () => {
        const workplace = new Workplace(0, 0, null);
        expect(workplace.getBusiness()).toBeNull();
        expect(workplace.getOpenPositions()).toEqual([]);
    });

    test('setBusiness opens every position in the generated business for hiring', () => {
        const workplace = new Workplace(0, 0, null);
        const clerk = makeJob('Clerk');
        const manager = makeJob('Manager');
        const business = makeBusiness([clerk, manager]);

        workplace.setBusiness(business);

        expect(workplace.getBusiness()).toBe(business);
        expect(workplace.getOpenPositions()).toEqual([clerk, manager]);
    });

    describe('vacancy/re-occupancy bookkeeping (task 037)', () => {
        test('vacantMonths defaults to 0 and is settable', () => {
            const workplace = new Workplace(0, 0, null);
            expect(workplace.getVacantMonths()).toBe(0);
            workplace.setVacantMonths(3);
            expect(workplace.getVacantMonths()).toBe(3);
        });

        test('businessGenerations defaults to 0 and is settable', () => {
            const workplace = new Workplace(0, 0, null);
            expect(workplace.getBusinessGenerations()).toBe(0);
            workplace.setBusinessGenerations(2);
            expect(workplace.getBusinessGenerations()).toBe(2);
        });
    });

    describe('hire', () => {
        test('throws for a falsy person', () => {
            const workplace = new Workplace(0, 0, null);
            workplace.setBusiness(makeBusiness([makeJob('Clerk')]));
            const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
             
            expect(() => workplace.hire(null as any)).toThrow('Person is not valid for hire');
            errorSpy.mockRestore();
        });

        test('hires into the first position the candidate can fill, removing it from open positions', () => {
            const workplace = new Workplace(0, 0, null);
            const clerk = makeJob('Clerk', ['selling']);
            const manager = makeJob('Manager', ['leadership']);
            workplace.setBusiness(makeBusiness([clerk, manager]));

            const person = makePerson('Alice');
            const canFill = (requirements: string[]) => requirements.includes('leadership');
            const job = workplace.hire(person, canFill);

            expect(job).toBe(manager);
            expect(workplace.getOpenPositions()).toEqual([clerk]);
            expect(workplace.getEmployees()).toEqual([person]);
        });

        test('returns null when no open position matches', () => {
            const workplace = new Workplace(0, 0, null);
            workplace.setBusiness(makeBusiness([makeJob('Clerk', ['selling'])]));

            const person = makePerson('Bob');
            const job = workplace.hire(person, () => false);

            expect(job).toBeNull();
            expect(workplace.getEmployees()).toEqual([]);
            expect(workplace.getOpenPositions()).toHaveLength(1);
        });

        test('defaults canFill to always-true when omitted', () => {
            const workplace = new Workplace(0, 0, null);
            const clerk = makeJob('Clerk');
            workplace.setBusiness(makeBusiness([clerk]));

            const person = makePerson('Cara');
            expect(workplace.hire(person)).toBe(clerk);
        });
    });

    describe('layoff', () => {
        test('throws for a falsy person', () => {
            const workplace = new Workplace(0, 0, null);
            const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
             
            expect(() => workplace.layoff(null as any)).toThrow('Person is not valid for layoff');
            errorSpy.mockRestore();
        });

        test('returns null when the person has no job', () => {
            const workplace = new Workplace(0, 0, null);
            const person = makePerson('Dana');
            expect(workplace.layoff(person)).toBeNull();
        });

        test('removes the employee and re-opens their position', () => {
            const workplace = new Workplace(0, 0, null);
            const clerk = makeJob('Clerk');
            workplace.setBusiness(makeBusiness([clerk]));

            const person = makePerson('Eli');
            const hiredJob = workplace.hire(person)!;
            person.work.setJob(hiredJob);

            expect(workplace.getEmployees()).toEqual([person]);
            expect(workplace.getOpenPositions()).toEqual([]);

            const returnedJob = workplace.layoff(person);

            expect(returnedJob).toBe(hiredJob);
            expect(workplace.getEmployees()).toEqual([]);
            expect(workplace.getOpenPositions()).toEqual([hiredJob]);
        });

        test('still returns the job even if the person was not tracked as an employee', () => {
            const workplace = new Workplace(0, 0, null);
            const person = makePerson('Fay');
            person.work.setJob(makeJob('Ghost Clerk'));

            const job = workplace.layoff(person);
            expect(job).toEqual(makeJob('Ghost Clerk'));
            expect(workplace.getOpenPositions()).toEqual([makeJob('Ghost Clerk')]);
        });
    });

    describe('expandPositions (task 020 growth)', () => {
        test('no-ops when there is no business yet', () => {
            const workplace = new Workplace(0, 0, null);
            expect(() => workplace.expandPositions(2, [makeJob('Clerk')], [makeJob('Clerk')])).not.toThrow();
            expect(workplace.getBusiness()).toBeNull();
        });

        test('grows the establishment and appends the newly opened positions', () => {
            const workplace = new Workplace(0, 0, null);
            const clerk = makeJob('Clerk');
            const business = makeBusiness([clerk]);
            workplace.setBusiness(business);

            const manager = makeJob('Manager');
            workplace.expandPositions(2, [clerk, manager], [manager]);

            expect(business.size).toBe(2);
            expect(business.positions).toEqual([clerk, manager]);
            expect(workplace.getOpenPositions()).toEqual([clerk, manager]);
        });
    });

    describe('shrinkPositions (task 076 shrink-via-layoffs)', () => {
        test('no-ops when there is no business yet', () => {
            const workplace = new Workplace(0, 0, null);
            expect(workplace.shrinkPositions(1, [makeJob('Clerk')])).toEqual([]);
        });

        test('keeps employees the shrunk business still has capacity for and lays off the rest', () => {
            const workplace = new Workplace(0, 0, null);
            const clerk1 = makeJob('Clerk');
            const clerk2 = makeJob('Clerk');
            const manager = makeJob('Manager');
            workplace.setBusiness(makeBusiness([clerk1, clerk2, manager]));

            const clerkA = makePerson('ClerkA');
            const clerkB = makePerson('ClerkB');
            const managerPerson = makePerson('Manager');
            clerkA.work.setJob(workplace.hire(clerkA)!);
            clerkB.work.setJob(workplace.hire(clerkB)!);
            managerPerson.work.setJob(workplace.hire(managerPerson)!);

            expect(workplace.getEmployees()).toHaveLength(3);

            // Shrink to just one clerk slot + the manager slot: one of the two clerks must go.
            const shrunkClerk = makeJob('Clerk');
            const shrunkManager = makeJob('Manager');
            const laidOff = workplace.shrinkPositions(2, [shrunkClerk, shrunkManager]);

            expect(laidOff).toHaveLength(1);
            expect(laidOff[0]!.work.getJob()?.title).toBe('Clerk');
            expect(workplace.getEmployees()).toHaveLength(2);
            // Remaining capacity (none, since both slots are filled by kept employees) becomes open positions.
            expect(workplace.getOpenPositions()).toEqual([]);
            expect(workplace.getBusiness()!.size).toBe(2);
            expect(workplace.getBusiness()!.positions).toEqual([shrunkClerk, shrunkManager]);
        });

        test('leftover capacity not consumed by kept employees becomes open positions', () => {
            const workplace = new Workplace(0, 0, null);
            const clerk = makeJob('Clerk');
            workplace.setBusiness(makeBusiness([clerk]));

            const clerkPerson = makePerson('Clerk');
            clerkPerson.work.setJob(workplace.hire(clerkPerson)!);

            // Shrink to a business that still has a clerk + a brand-new janitor slot: the janitor slot has
            // no employee to claim it, so it should come back as open.
            const shrunkClerk = makeJob('Clerk');
            const janitor = makeJob('Janitor');
            const laidOff = workplace.shrinkPositions(2, [shrunkClerk, janitor]);

            expect(laidOff).toEqual([]);
            expect(workplace.getEmployees()).toEqual([clerkPerson]);
            expect(workplace.getOpenPositions()).toEqual([janitor]);
        });
    });

    test('closeBusiness clears the business and returns every laid-off employee', () => {
        const workplace = new Workplace(0, 0, null);
        const clerk = makeJob('Clerk');
        workplace.setBusiness(makeBusiness([clerk]));

        const person = makePerson('Gil');
        person.work.setJob(workplace.hire(person)!);

        const laidOff = workplace.closeBusiness();

        expect(laidOff).toEqual([person]);
        expect(workplace.getBusiness()).toBeNull();
        expect(workplace.getEmployees()).toEqual([]);
        expect(workplace.getOpenPositions()).toEqual([]);
    });

    test('addEmployee tracks an employee directly (restore-from-save path)', () => {
        const workplace = new Workplace(0, 0, null);
        const person = makePerson('Hal');
        workplace.addEmployee(person);
        expect(workplace.getEmployees()).toEqual([person]);
    });

    describe('occupant management (capacity MAX_OCCUPANTS = 100)', () => {
        test('addOccupant/removeOccupant and getOccupants', () => {
            const workplace = new Workplace(0, 0, null);
            const person = makePerson('Ivy');

            workplace.addOccupant(person);
            expect(workplace.getOccupants()).toEqual([person]);

            workplace.removeOccupant(person);
            expect(workplace.getOccupants()).toEqual([]);

            expect(() => workplace.removeOccupant(person)).not.toThrow();
        });

        test('addOccupant is capped at 100', () => {
            const workplace = new Workplace(0, 0, null);
            for (let i = 0; i < 101; i++) {
                workplace.addOccupant(makePerson(`Occupant${i}`));
            }
            expect(workplace.getOccupants()).toHaveLength(100);
        });
    });

    describe('garage management (capacity MAX_VEHICLES = 40)', () => {
        test('addVehicle/removeVehicle and getVehicles', () => {
            const workplace = new Workplace(0, 0, null);
            const car = new Vehicle(0, 0);

            workplace.addVehicle(car);
            expect(workplace.getVehicles()).toEqual([car]);

            workplace.removeVehicle(car);
            expect(workplace.getVehicles()).toEqual([]);

            expect(() => workplace.removeVehicle(car)).not.toThrow();
        });

        test('addVehicle is capped at 40', () => {
            const workplace = new Workplace(0, 0, null);
            for (let i = 0; i < 41; i++) {
                workplace.addVehicle(new Vehicle(0, 0));
            }
            expect(workplace.getVehicles()).toHaveLength(40);
        });
    });

    test('getOverview reports capacities plus occupant/employee overviews', () => {
        const workplace = new Workplace(0, 0, null);
        const clerk = makeJob('Clerk');
        workplace.setBusiness(makeBusiness([clerk]));

        const employee = makePerson('Jan');
        employee.work.setJob(workplace.hire(employee)!);

        const overview = workplace.getOverview();
        expect(overview.maxOccupants).toBe(100);
        expect(overview.maxVehicles).toBe(40);
        expect(overview.occupants).toEqual([]);
        expect(overview.employees).toEqual([employee.getOverview()]);
    });
});
