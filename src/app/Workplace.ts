import Building from 'app/Building';
import Person from 'app/Person';
import Vehicle from 'app/Vehicle';

import { WorkplaceOverview } from 'types/Social';
import { JobPosition, JobRequirements } from 'types/Work';

const MAX_OCCUPANTS = 100;
const MAX_VEHICLES = 40;
const STARTING_POSITIONS = 10;

type PotentialJob = JobPosition | null;

export default class Workplace extends Building {
    private employees: Person[];
    private avaiableJobs: JobPosition[];

    private occupants: Person[];
    private garage: Vehicle[];

    private maxOccupants: number;
    private maxVehicles: number;

    constructor(row: number, col: number, assetName: string | null) {
        super(row, col, assetName);

        this.employees = [];
        this.avaiableJobs = [];

        this.maxOccupants = MAX_OCCUPANTS;
        this.maxVehicles = MAX_VEHICLES;

        this.occupants = [];
        this.garage = [];

        for (let i = 0; i < STARTING_POSITIONS; i++) {
            this.avaiableJobs.push({
                title: 'Constructor',
                salary: 1400,
                requirements: [
                    JobRequirements.ConstructionSkill,
                ],
            });
        }
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