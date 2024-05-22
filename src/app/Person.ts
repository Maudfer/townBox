import Road from 'app/Road';
import Tile from 'app/Tile';
import Building from 'app/Building';
import PathFinder from 'app/PathFinder';
import SocialLife from 'app/SocialLife';

import { TilePosition, PixelPosition } from 'types/Position';
import { Image } from 'types/Phaser';
import { Direction, Axis } from 'types/Movement';
import { Gender, Relationship, PersonOverview, RelationshipOverview } from 'types/Social';

export default class Person {
    public social: SocialLife;

    private x: number;
    private y: number;

    private depth: number;
    private speed: number;

    private currentTarget: PixelPosition | null;
    private direction: Direction;
    private movingAxis: Axis;
    private insideBuilding: boolean;

    private path: Tile[];
    private currentDestination: TilePosition;

    private asset: Image;
    private redrawFunction: ((timeDelta: number) => void) | null;

    constructor(x: number, y: number) {
        this.social = new SocialLife();

        this.x = x;
        this.y = y;

        this.depth = 0;
        this.speed = 0.02;

        this.currentTarget = null;
        this.direction = Direction.East;
        this.movingAxis = Axis.X;
        this.insideBuilding = false;

        this.path = [];
        this.currentDestination = null;
        this.asset = null;

        this.redrawFunction = null;
    }

    setupCitizenship(firstName: string, familyName: string, age: number, gender: Gender): void {
        this.social.setFirstName(firstName);
        this.social.setFamilyName(familyName);
        this.social.setAge(age);
        this.social.setGender(gender);
    }

    walk(currentTile: Tile, timeDelta: number): void {
        if (this.insideBuilding || !this.asset || !this.currentTarget || !(currentTile instanceof Road)) {
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

        if (this.isCurrentTargetReached()) {
            this.setNextTarget(currentTile);
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
        if (!destinations.size) {
            return;
        }
        if (this.currentDestination) {
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

    getOverview(): PersonOverview {
        const socialInfo = this.social.getInfo();

        const relationshipOverview: RelationshipOverview = {};

        // iterate through socialInfo.relationships object and convert Person[] to string[]
        for (const key in socialInfo.relationships) {
            const relationship = key as Relationship;
            const people = socialInfo.relationships[relationship];

            if(!relationshipOverview[relationship]){
                relationshipOverview[relationship] = [];
            }

            if (people) {
                relationshipOverview[relationship] = people.map(person => person.social.getFullName());
            }
        }

        const overview: PersonOverview = {
            firstName: socialInfo.firstName,
            familyName: socialInfo.familyName,
            age: socialInfo.age,
            gender: socialInfo.gender,
            relationships: relationshipOverview,
        };

        return overview;
    }

    toString(): string {
        return this.social.getFullName();
    }
}