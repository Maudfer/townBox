import Building from 'game/Building';
import Person from 'game/Person';
import Vehicle from 'game/Vehicle';

import { WorkplaceOverview } from 'types/Social';
import { JobPosition } from 'types/Work';
import { BusinessInstance } from 'types/Business';

const MAX_OCCUPANTS = 100;
const MAX_VEHICLES = 40;

type PotentialJob = JobPosition | null;

export default class Workplace extends Building {
    private employees: Person[];
    private avaiableJobs: JobPosition[];
    private business: BusinessInstance | null;

    private occupants: Person[];
    private garage: Vehicle[];

    private maxOccupants: number;
    private maxVehicles: number;

    constructor(row: number, col: number, assetName: string | null) {
        super(row, col, assetName);

        this.employees = [];
        this.avaiableJobs = [];
        this.business = null;

        this.maxOccupants = MAX_OCCUPANTS;
        this.maxVehicles = MAX_VEHICLES;

        this.occupants = [];
        this.garage = [];

        // Jobs are no longer seeded here: a business (and its open positions) is generated on the
        // `workplaceBuilt` event by City.setupBusiness (Engine A), or restored from a save. See docs/tasks/013.
    }

    // Assigns a generated/restored business: stores its identity and opens all of its positions for hiring.
    // (Open/filled reconciliation across save/load gains slot identity in phase 013d, when hiring becomes an
    // event; for now all of the instance's positions are treated as open.)
    public setBusiness(business: BusinessInstance): void {
        this.business = business;
        this.avaiableJobs = [...business.positions];
    }

    public getBusiness(): BusinessInstance | null {
        return this.business;
    }

    public hire(person: Person): PotentialJob {
        if(!person){
            console.error(person);
            throw new Error('Person is not valid for hire');
        }

        const skills = person.work.getSkills();
        if (skills.length === 0) {
            return null;
        }

        const job = this.avaiableJobs.find(job => {
            return job.requirements.every(requirement => {
                return skills.includes(requirement);
            });
        });

        if (job) {
            this.employees.push(person);
            return job;
        }

        return null;
    }

    public layoff(person: Person): PotentialJob {
        if(!person){
            console.error(person);
            throw new Error('Person is not valid for layoff');
        }

        const currentJob = person.work.getJob();
        if (!currentJob) {
            return null;
        }

        const index = this.employees.indexOf(person);
        if (index !== -1) {
            this.employees.splice(index, 1);
        }

        this.avaiableJobs.push(currentJob);
        return currentJob;
    }

    public getEmployees(): Person[] {
        return this.employees;
    }

    public addEmployee(person: Person): void {
        this.employees.push(person);
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

    public getOccupants(): Person[] {
        return this.occupants;
    }

    public getVehicles(): Vehicle[] {
        return this.garage;
    }

    public getOverview(): WorkplaceOverview {
        return {
            maxOccupants: this.maxOccupants,
            maxVehicles: this.maxVehicles,
            occupants: this.occupants.map(occupant => occupant.getOverview()),
            employees: this.employees.map(employee => employee.getOverview()),
        };
    }
}