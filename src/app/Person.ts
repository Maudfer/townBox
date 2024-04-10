import Road from 'app/Road';
import Tile from 'app/Tile';
import Building from 'app/Building';
import PathFinder from 'app/PathFinder';

import { TilePosition, PixelPosition } from 'types/Position';
import { Image } from 'types/Phaser';
import { Direction } from 'types/Movement';
export default class Person {
    private x: number;
    private y: number;

    private depth: number;
    private speed: number;

    private currentTarget: PixelPosition | null;
    private direction: Direction;
    private movingAxis: 'x' | 'y';

    private path: Tile[];
    private currentDestination: TilePosition;

    private asset: Image;

    private redrawFunction: (() => void) | null;

    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;

        this.depth = 0;
        this.speed = 0.05;

        this.currentTarget = null;
        this.direction = Direction.East;
        this.movingAxis = 'x';

        this.path = [];
        this.currentDestination = null;
        this.asset = null;

        this.redrawFunction = null;
    }

    walk(currentTile: Tile, timeDelta: number): void {
        if (!this.asset || !this.currentTarget || !(currentTile instanceof Road)) {
            return;
        }

        // If current target is reached, set next target and wait for next walk cycle
        if (this.isCurrentTargetReached()) {
            this.setNextTarget(currentTile);
            return;
        }

        // If current target is not reached, check if we have a target at all
        if (!this.currentTarget) {
            return;
        }

        const speedX = this.speed * Math.sign(this.currentTarget.x - this.x) * timeDelta;
        const speedY = this.speed * Math.sign(this.currentTarget.y - this.y) * timeDelta;

        const potentialX = this.x + speedX;
        const potentialY = this.y + speedY;

        if (this.movingAxis === 'x') {
            this.x = potentialX;
            this.direction = speedX > 0 ? Direction.East : Direction.West;
            
            if (this.isCurrentTargetXReached()) {
                this.movingAxis = 'y';
            }
        } else if (this.movingAxis === 'y') {
            this.y = potentialY;
            this.direction = speedY > 0 ? Direction.South : Direction.North;
            if (this.isCurrentTargetYReached()) {
                this.movingAxis = 'x';
            }
        }

        this.updateDepth(currentTile);
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

    setRedrawFunction(redrawFunction: () => void): void {
        this.redrawFunction = redrawFunction;
    }

    getDirection(): Direction {
        return this.direction;
    }

    redraw(): void {
        if (this.redrawFunction) {
            this.redrawFunction();
        }
    }

    getMovingAxis(): string {
        return this.movingAxis;
    }
}