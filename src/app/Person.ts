import Road from 'app/Road';
import Tile from 'app/Tile';
import PathFinder from 'app/PathFinder';

import { TilePosition, PixelPosition } from 'types/Position';
import { CurbPoint } from 'types/Curb';
import { Image } from 'types/Phaser';
export default class Person {
    private x: number;
    private y: number;

    private depth: number;
    private speed: number;

    private currentTarget: CurbPoint | null;
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

        const deltaX = Math.abs(this.currentTarget.x - potentialX);
        const deltaY = Math.abs(this.currentTarget.y - potentialY);

        if (this.movingAxis === 'x') {
            this.x = potentialX;
            if (deltaX <= 1) {
                this.movingAxis = 'y';
            }
        } else if (this.movingAxis === 'y') {
            this.y = potentialY;
            if (deltaY <= 1) {
                this.movingAxis = 'x';
            }
        }

        this.updateDepth(currentTile);
    }

    setNextTarget(currentTile: Tile): void {
        if (!this.path.length) {
            return;
        }

        if (!currentTile || !(currentTile instanceof Road)) {
            return;
        }

        const currentTilePosition = currentTile.getPosition();
        if (!currentTilePosition) {
            return;
        }

        const nextTile = this.path.shift();
        if (!nextTile || !(nextTile instanceof Road)) {
            return;
        }
         
        const nextTilePosition = nextTile.getPosition();
        const curbs = nextTile.getCurb();
        if (!nextTilePosition || !curbs) {
            return;
        }

        // Determine which CurbPoint is going to be the next target
        let nextTarget;
        const currentPixelPosition = { x: this.x, y: this.y };

        // Moving North
        if (nextTilePosition.row < currentTilePosition.row) {
            nextTarget = currentTile.isRightSideOfRoad(currentPixelPosition) ? curbs.topRight : curbs.topLeft;
        }

        // Moving South
        if (nextTilePosition.row > currentTilePosition.row) {
            nextTarget = currentTile.isRightSideOfRoad(currentPixelPosition) ? curbs.bottomRight : curbs.bottomLeft;
        }

        // Moving East
        if (nextTilePosition.col > currentTilePosition.col) {
            nextTarget = currentTile.isTopSideOfTheRoad(currentPixelPosition) ? curbs.topRight : curbs.bottomRight;
        }

        // Moving West
        if (nextTilePosition.col < currentTilePosition.col) {
            nextTarget = currentTile.isTopSideOfTheRoad(currentPixelPosition) ? curbs.topLeft : curbs.bottomLeft;
        }

        if (!nextTarget) {
            console.warn("Could not determine direction to next tile", this, currentTile, nextTile);
            return;
        }

        this.currentTarget = nextTarget;

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

    isCurrentTargetReached(): boolean {
        if (!this.currentTarget) {
            return false;
        }

        const curretPixelPosition: PixelPosition = {x: this.x, y: this.y};
        const targetPixelPosition: CurbPoint = this.currentTarget;

        const deltaX = Math.abs(targetPixelPosition.x - curretPixelPosition.x);
        const deltaY = Math.abs(targetPixelPosition.y - curretPixelPosition.y);

        return (deltaX <= 1) && (deltaY <= 1);
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