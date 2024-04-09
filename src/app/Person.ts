import Road from 'app/Road';
import Tile from 'app/Tile';
import Building from 'app/Building';
import PathFinder from 'app/PathFinder';

import { TilePosition, PixelPosition } from 'types/Position';
import { Point } from 'types/Tile';
import { Image } from 'types/Phaser';
export default class Person {
    private x: number;
    private y: number;

    private depth: number;
    private speed: number;

    private currentTarget: Point | null;
    private movingAxis: 'x' | 'y';

    private path: Tile[];
    private currentDestination: TilePosition;

    private asset: Image;

    private redrawFunction: (() => void) | null;

    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;

        this.depth = 0;
        this.speed = 1;

        this.currentTarget = null;
        this.movingAxis = 'x';

        this.path = [];
        this.currentDestination = null;
        this.asset = null;

        this.redrawFunction = null;
    }

    walk(currentTile: Tile, _: number): void {
        if (!this.currentTarget || !(currentTile instanceof Road)) {
            return;
        }

        if (!this.asset) {
            return;
        }

        // If current target (CurbPoint) is reached, set next target and wait for next walk cycle
        if (this.isCurrentTargetReached()) {
            this.setNextTarget(currentTile);
            return;
        }

        // If current target is not reached, check if we have a target at all
        if (!this.currentTarget) {
            return;
        }

        // TODO: implement timeDelta to make the movement frame-independent
        const speedX = this.speed * Math.sign(this.currentTarget.x - this.x); // * timeDelta;
        const speedY = this.speed * Math.sign(this.currentTarget.y - this.y); // * timeDelta;

        const potentialX = this.x + speedX;
        const potentialY = this.y + speedY;

        if (this.movingAxis === 'x') {
            this.x = potentialX;
            if (this.isCurrentTargetXReached()) {
                this.movingAxis = 'y';
            }
        } else if (this.movingAxis === 'y') {
            this.y = potentialY;
            if (this.isCurrentTargetYReached()) {
                this.movingAxis = 'x';
            }
        }

        this.updateDepth(currentTile);
    }

    setNextTarget(currentTile: Tile): void {
        if (!this.path.length) {
            return;
        }

        if (!currentTile) {
            console.warn(`[Person] Current tile is not valid for setting next target`, currentTile);
            return;
        }

        const currentTilePosition = currentTile.getPosition();
        if (!currentTilePosition) {
            console.warn(`[Person] Can't set next target, current position not valid`, currentTilePosition);
            return;
        }

        const nextTile = this.path.shift();
        if (!nextTile) {
            console.warn(`[Person] Could not get next tile from path`, nextTile);
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
            console.log(`Could not determine next tile position or curbs`, nextTile, curbs);
            return;
        }

        // Determine which CurbPoint is going to be the next target
        let nextTarget;
        const currentPixelPosition = { x: this.x, y: this.y };

        // Moving North
        if (nextTilePosition.row < currentTilePosition.row) {
            console.log(`Moving North, isRightSideOfRoad = ${currentTile.isRightSideOfRoad(currentPixelPosition) ? 'topRight' : 'topLeft'}`);
            nextTarget = currentTile.isRightSideOfRoad(currentPixelPosition) ? curbs.bottomRight : curbs.bottomLeft;
        }

        // Moving South
        if (nextTilePosition.row > currentTilePosition.row) {
            console.log(`Moving South, isRightSideOfRoad = ${currentTile.isRightSideOfRoad(currentPixelPosition) ? 'bottomRight' : 'bottomLeft'}`);
            nextTarget = currentTile.isRightSideOfRoad(currentPixelPosition) ? curbs.topRight : curbs.topLeft;
        }

        // Moving East
        if (nextTilePosition.col > currentTilePosition.col) {
            console.log(`Moving East, isTopSideOfTheRoad = ${currentTile.isTopSideOfTheRoad(currentPixelPosition) ? 'topRight' : 'bottomRight'}`);
            nextTarget = currentTile.isTopSideOfTheRoad(currentPixelPosition) ? curbs.topLeft : curbs.bottomLeft;
        }

        // Moving West
        if (nextTilePosition.col < currentTilePosition.col) {
            console.log(`Moving West, isTopSideOfTheRoad = ${currentTile.isTopSideOfTheRoad(currentPixelPosition) ? 'topLeft' : 'bottomLeft'}`);
            nextTarget = currentTile.isTopSideOfTheRoad(currentPixelPosition) ? curbs.topRight : curbs.bottomRight;
        }

        if (!nextTarget) {
            console.warn("Could not determine direction to next tile", this, currentTile, nextTile);
            return;
        }

        this.currentTarget = nextTarget;
        console.log(`--------------------------------------`);

        // Decide whether to move in x or y direction based on the closer axis to the target
        /*
        const deltaX = Math.abs(targetCenter.x - this.x);
        const deltaY = Math.abs(targetCenter.y - this.y);

        this.movingAxis = deltaX > deltaY ? 'x' : 'y';
        */
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

    redraw(): void {
        if (this.redrawFunction) {
            this.redrawFunction();
        }
    }

    getMovingAxis(): string {
        return this.movingAxis;
    }
}