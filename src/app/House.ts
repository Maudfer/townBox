import Building from 'app/Building';
import Person from 'app/Person';
import Vehicle from 'app/Vehicle';

const MAX_RESIDENTS = 4;
const MAX_OCCUPANTS = 10;
const MAX_VEHICLES = 2;

export default class House extends Building {
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

        this.residents = [];
        this.occupants = [];
        this.garage = [];
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
}