import { fakerPT_BR } from '@faker-js/faker';

import GameManager from 'game/GameManager';
import House from 'game/House';
import Vehicle from 'game/Vehicle';
import Family from 'game/Family';

let Game: GameManager;
export default class City {    
    private name: string;
    private population: number;


    constructor(gameManager: GameManager) {
        Game = gameManager;

        this.name = fakerPT_BR.location.city();
        this.population = 0;

        Game.on("houseBuilt", { callback: this.setupHousehold, context: this });
        console.log('City created:', this.name);
    }

    public getName(): string {
        return this.name;
    }

    public setName(name: string): void {
        this.name = name;
    }

    public async setupHousehold(house: House): Promise<void> {
        if (!house) {
            throw new Error("Invalid house to setup household");
        }

        const family = new Family(house);
        const members = await family.autoGenerate(Game);

        this.population += members.length;

        console.log('Family spawned', family.getOverview());
        console.log('City population', this.population);
    }

    public setupCar(vehicle: Vehicle): void {
        console.log('Car spawning', vehicle);
    }
}


