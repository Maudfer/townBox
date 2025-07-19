import Road from 'game/Road';
import Tile from 'game/Tile';
import Building from 'game/Building';
import PathFinder from 'game/PathFinder';
import SocialLife from 'game/SocialLife';
import WorkLife from 'game/WorkLife';
import Vehicle from 'game/Vehicle';
import GameManager from 'game/GameManager';
import { TravelStep } from 'types/Travel';

import { TilePosition, PixelPosition } from 'types/Position';
import { Image } from 'types/Phaser';
import { Direction, Axis } from 'types/Movement';
import { FamilyTree, Node, Link } from 'types/FamilyTree';
import { Gender, RelationshipMap, PersonOverview, RelationshipMapOverview } from 'types/Social';

let Game: GameManager;

export default class Person {
    public social: SocialLife;
    public work: WorkLife;

    private x: number;
    private y: number;

    private depth: number;
    private speed: number;

    private currentTarget: PixelPosition | null;
    private direction: Direction;
    private movingAxis: Axis;
    private insideBuilding: boolean;

    private vehicle: Vehicle | null;
    private destinationBuilding: Building | null;
    private travelStep: TravelStep;

    private path: Tile[];
    private currentDestination: TilePosition;

    private asset: Image;
    private redrawFunction: ((timeDelta: number) => void) | null;

    constructor(x: number, y: number) {
        this.social = new SocialLife();
        this.work = new WorkLife();

        this.x = x;
        this.y = y;

        this.depth = 0;
        this.speed = 0.02;

        this.currentTarget = null;
        this.direction = Direction.East;
        this.movingAxis = Axis.X;
        this.insideBuilding = false;
        this.vehicle = null;
        this.destinationBuilding = null;
        this.travelStep = TravelStep.Idle;

        this.path = [];
        this.currentDestination = null;
        this.asset = null;

        this.redrawFunction = null;
    }

    setGameManager(gameManager: GameManager): void {
        Game = gameManager;
    }

    setVehicle(vehicle: Vehicle): void {
        this.vehicle = vehicle;
    }

    setDestination(building: Building): void {
        this.destinationBuilding = building;
        this.travelStep = TravelStep.ExitingBuilding;
    }

    setupCitizenship(firstName: string, familyName: string, age: number, gender: Gender): void {
        this.social.setFirstName(firstName);
        this.social.setFamilyName(familyName);
        this.social.setAge(age);
        this.social.setGender(gender);
    }

    walk(currentTile: Tile, timeDelta: number): void {
        if (this.insideBuilding || !this.asset || !this.currentTarget || !this.currentDestination /*|| !(currentTile instanceof Road)*/) {
            return;
        }

        const speedX = this.speed * Math.sign(this.currentTarget.x - this.x) * timeDelta;
        const speedY = this.speed * Math.sign(this.currentTarget.y - this.y) * timeDelta;

        const potentialX = this.x + speedX;
        const potentialY = this.y + speedY;

        if (this.movingAxis === Axis.X) {
            this.x = potentialX;
            this.direction = speedX > 0 ? Direction.East : Direction.West;
            if (this.isCurrentTargetXReached() && !this.isCurrentTargetYReached()) {
                this.movingAxis = Axis.Y;
            }
        } else if (this.movingAxis === Axis.Y) {
            this.y = potentialY;
            this.direction = speedY > 0 ? Direction.South : Direction.North;
            if (this.isCurrentTargetYReached() && !this.isCurrentTargetXReached()) {
                this.movingAxis = Axis.X;
            }
        }

        this.updateDepth(currentTile);

        if (this.isDestinationReached()) {
            this.currentTarget = null;
            this.currentDestination = null;
            return;
        }

        if (this.isCurrentTargetReached()) {
            this.setNextTarget(currentTile);
            return;
        }
    }

    setNextTarget(currentTile: Tile): void {
        if (!this.path.length || !currentTile) {
            return;
        }

        const currentTilePosition = currentTile.getPosition();
        if (!currentTilePosition) {
            console.warn(`[Person] Can't set next target, current position not valid`, currentTilePosition);
            return;
        }

        const nextTile = this.path.shift();
        if (!nextTile) {
            return;
        }

        if (nextTile instanceof Building) {
            this.currentTarget = nextTile.getEntrance();
            return;
        }

        // If next tile is not a Building nor a Road, stay still
        if (!(nextTile instanceof Road)){
            console.warn(`[Person] Next tile is not a road`, nextTile);
            return;
        }
         
        const nextTilePosition = nextTile.getPosition();
        const curbs = nextTile.getCurb();
        if (!nextTilePosition || !curbs) {
            console.warn(`[Person] Could not determine next tile position or curbs`, nextTile, curbs);
            return;
        }

        // Determine which curb Point is going to be the next target
        const currentPixelPosition = { x: this.x, y: this.y };
        this.currentTarget = nextTile.getClosestCurbPoint(currentPixelPosition);
    }

    updateDestination(currentTile: Tile, destinations: Set<string>, pathFinder: PathFinder): void {
        if (this.currentDestination) {
            return;
        }

        if (!destinations.size) {
            return;
        }

        const destinationArray = Array.from(destinations);
        const destinationKey = Phaser.Math.RND.pick(destinationArray);
        const [destinationRow, destinationCol] = destinationKey.split('-').map(Number);
        if (!destinationRow || !destinationCol) {
            return;
        }

        this.currentDestination = { row: destinationRow, col: destinationCol };

        const currentTilePosition = {
            row: currentTile.getRow(),
            col: currentTile.getCol()
        };

        this.path = pathFinder.findPath(currentTilePosition, this.currentDestination);
        if (this.path?.length) {
            this.setNextTarget(currentTile);
        }
    }

    setDestinationTile(currentTile: Tile, destination: TilePosition, pathFinder: PathFinder): void {
        if (!destination) {
            return;
        }

        this.currentDestination = destination;

        const currentTilePosition = {
            row: currentTile.getRow(),
            col: currentTile.getCol()
        };

        this.path = pathFinder.findPath(currentTilePosition, this.currentDestination);
        if (this.path?.length) {
            this.setNextTarget(currentTile);
        }
    }

    isCurrentTargetXReached(): boolean {
        if (!this.currentTarget) {
            return false;
        }
        return Math.abs(this.currentTarget.x - this.x) < 1;
    }

    isCurrentTargetYReached(): boolean {
        if (!this.currentTarget) {
            return false;
        }
        return Math.abs(this.currentTarget.y - this.y) < 1;
    }

    isCurrentTargetReached(): boolean {
        return this.isCurrentTargetXReached() && this.isCurrentTargetYReached();
    }

    isDestinationReached(): boolean {
        return !this.path.length && this.isCurrentTargetReached();
    }

    private processTravel(currentTile: Tile, timeDelta: number, pathFinder: PathFinder): void {
        if (!this.destinationBuilding) {
            return;
        }

        switch (this.travelStep) {
            case TravelStep.ExitingBuilding:
                this.setIndoors(false);
                this.currentDestination = null;
                if (this.vehicle) {
                    const vehiclePos = this.vehicle.getPosition();
                    const vehicleTile = Game.pixelToTilePosition(vehiclePos);
                    if (vehicleTile) {
                        this.setDestinationTile(currentTile, vehicleTile, pathFinder);
                    }
                }
                this.travelStep = TravelStep.WalkingToCar;
                break;
            case TravelStep.WalkingToCar:
                this.walk(currentTile, timeDelta);
                if (this.isDestinationReached()) {
                    this.travelStep = TravelStep.EnteringCar;
                }
                break;
            case TravelStep.EnteringCar:
                // person enters vehicle
                if (this.vehicle) {
                    const vehicleTile = Game.pixelToTilePosition(this.vehicle.getPosition());
                    const destTile = this.destinationBuilding.getPosition();
                    if (vehicleTile && destTile) {
                        const tile = Game.field!.getTile(vehicleTile.row, vehicleTile.col);
                        if (tile) {
                            this.vehicle.setDestinationTile(tile, destTile, pathFinder);
                        }
                    }
                }
                this.travelStep = TravelStep.Driving;
                break;
            case TravelStep.Driving:
                if (this.vehicle && this.vehicle.isDestinationReached()) {
                    this.travelStep = TravelStep.ExitingCar;
                }
                break;
            case TravelStep.ExitingCar:
                // person exits vehicle
                if (this.vehicle) {
                    const carTilePos = Game.pixelToTilePosition(this.vehicle.getPosition());
                    if (carTilePos) {
                        const tile = Game.field!.getTile(carTilePos.row, carTilePos.col);
                        if (tile) {
                            const destTile = this.destinationBuilding.getPosition();
                            this.setDestinationTile(tile, destTile, pathFinder);
                        }
                    }
                }
                this.travelStep = TravelStep.WalkingToDestination;
                break;
            case TravelStep.WalkingToDestination:
                this.walk(currentTile, timeDelta);
                if (this.isDestinationReached()) {
                    this.travelStep = TravelStep.Arrived;
                }
                break;
            case TravelStep.Arrived:
                this.setIndoors(true);
                this.destinationBuilding = null;
                this.travelStep = TravelStep.Idle;
                break;
            default:
                break;
        }
    }

    update(currentTile: Tile, timeDelta: number, destinations: Set<string>, pathFinder: PathFinder): void {
        if (this.destinationBuilding) {
            this.processTravel(currentTile, timeDelta, pathFinder);
        } else {
            this.walk(currentTile, timeDelta);
            this.updateDestination(currentTile, destinations, pathFinder);
        }
    }

    updateDepth(currentTile: Tile): void {
        const row = currentTile.getRow();
        this.depth = ((row + 1) * 10) + 1;
    }

    getDepth(): number {
        return this.depth;
    }

    getPosition(): PixelPosition {
        return { x: this.x, y: this.y };
    }

    setPosition(x: number, y: number): void {
        this.x = x;
        this.y = y;
    }

    getAsset(): Image | null {
        return this.asset;
    }

    setAsset(asset: Image): void {
        this.asset = asset;
    }

    setRedrawFunction(redrawFunction: (timeDelta: number) => void): void {
        this.redrawFunction = redrawFunction;
    }

    getDirection(): Direction {
        return this.direction;
    }

    setIndoors(insideBuilding: boolean): void {
        this.insideBuilding = insideBuilding;
    }

    isIndoors(): boolean {
        return this.insideBuilding;
    }

    redraw(timeDelta: number): void {
        if (this.redrawFunction) {
            this.redrawFunction(timeDelta);
        }
    }

    getFamilyTree(): FamilyTree {
        const person: Person = this;
        const nodes: Node[] = [];
        const links: Link[] = [];
        const personIndexMap = new Map<Person, number>();
    
        function processPerson(p: Person) {
            if (personIndexMap.has(p)) {
                return;
            }
    
            const index = nodes.length;
            personIndexMap.set(p, index);
    
            const name = p.social.getInfo().firstName;
            nodes.push({ name });
    
            const relationships = p.social.getInfo().relationships;
    
            for (const key of Object.keys(relationships) as Array<keyof RelationshipMap>) {
                const relationship = relationships[key];
    
                if (!relationship) {
                    continue;
                }
    
                if (Array.isArray(relationship)) {
                    for (const relatedPerson of relationship) {
                        processPerson(relatedPerson);
    
                        const sourceIndex = index;
                        const targetIndex = personIndexMap.get(relatedPerson)!;
                        links.push({
                            source: sourceIndex,
                            target: targetIndex,
                            label: key,
                        });
                    }
                } else {
                    processPerson(relationship);
    
                    const sourceIndex = index;
                    const targetIndex = personIndexMap.get(relationship)!;
                    links.push({
                        source: sourceIndex,
                        target: targetIndex,
                        label: key,
                    });
                }
            }
        }
    
        processPerson(person);
        return { nodes, links };
    }

    getOverview(): PersonOverview {
        const socialInfo = this.social.getInfo();

        const relationshipMapOverview: RelationshipMapOverview = {};
        
        for (const key in socialInfo.relationships) {
            const relationship = key as keyof RelationshipMap;
            const relatedPeople = socialInfo.relationships[relationship];

            if (!relatedPeople) {
                continue;
            }
    
            // For relationships which accept array values such as children and sbiling, we create an array overview
            if (Array.isArray(relatedPeople)) {
                relationshipMapOverview[relationship] = relatedPeople.map(person => person.social.getFullName()).join(', ');
            } else{
                relationshipMapOverview[relationship] = relatedPeople.social.getFullName();
            }
        }

        const overview: PersonOverview = {
            firstName: socialInfo.firstName,
            familyName: socialInfo.familyName,
            age: socialInfo.age,
            gender: socialInfo.gender,
            relationships: relationshipMapOverview,
        };

        return overview;
    }

    toString(): string {
        return this.social.getFullName();
    }
}