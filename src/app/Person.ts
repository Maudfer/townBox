import Road from 'app/Road';
import Tile from 'app/Tile';
import PathFinder from 'app/PathFinder';

import { TilePosition, PixelPosition } from 'types/Position';
import { Image } from 'types/Phaser';

enum Direction {
    North = "north",
    South = "south",
    East = "east",
    West = "west",
}

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
        if (!this.currentTarget || !(currentTile instanceof Road) || !this.asset) {
            return;
        }

        if (this.isCurrentTargetReached(currentTile)) {
            this.setNextTarget();
            return;
        }

        if (!this.currentTarget) {
            return;
        }

        // TODO: implement timeDelta to make the movement frame-independent
        const speedX = this.speed * Math.sign(this.currentTarget.x - this.x); // * timeDelta;
        const speedY = this.speed * Math.sign(this.currentTarget.y - this.y); // * timeDelta;

        let potentialX = this.x + speedX;
        let potentialY = this.y + speedY;

        /*
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
        */

        this.updateDepth(currentTile);
    }

    setNextTarget(): void {
        if (!this.path.length) {
            return;
        }

        const nextTile = this.path.shift();
        if (!nextTile) {
            return;
        }

        const directionToNextTile = getDirectionToNextTile(currentTile, nextTile);
    
        switch (directionToNextTile) {
            case Direction.North:
                // Example: If moving north and the current target is on the right side, head towards topRight corner.
                // This assumes you have logic in place to know which side of the road the person is on.
                return this.isOnRightSideOfRoad(currentTile) ? currentTile.corners.topRight : currentTile.corners.topLeft;
            case Direction.South:
                return this.isOnRightSideOfRoad(currentTile) ? currentTile.corners.bottomRight : currentTile.corners.bottomLeft;
            case Direction.East:
                return this.isMovingUpward() ? currentTile.corners.topRight : currentTile.corners.bottomRight;
            case Direction.West:
                return this.isMovingUpward() ? currentTile.corners.topLeft : currentTile.corners.bottomLeft;
            default:
                // Default case if direction is somehow not determined; consider how best to handle this.
                return currentTile.corners.bottomRight;
        }

        // Decide whether to move in x or y direction based on the closer axis to the target
        /*
        const deltaX = Math.abs(targetCenter.x - this.x);
        const deltaY = Math.abs(targetCenter.y - this.y);

        this.movingAxis = deltaX > deltaY ? 'x' : 'y';
        */
    }

    getDirectionToNextTile(currentTile: Tile, nextTile: Tile): Direction {
        if (nextTile.row < currentTile.row) return Direction.North;
        if (nextTile.row > currentTile.row) return Direction.South;
        if (nextTile.col > currentTile.col) return Direction.East;
        if (nextTile.col < currentTile.col) return Direction.West;
        throw new Error("Next tile is not adjacent to current tile");
    }

    determineNextCurbPoint(currentTile: Road, nextTile: Road): CurbPoint {

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
            this.setNextTarget();
        }
    }

    /*
    isCurrentTargetXReached(): boolean {
        if (!this.currentTarget) {
            return false;
        }

        const targetPixelPosition = this.currentTarget.getCenter();
        if (!targetPixelPosition) {
            return false;
        }

        const targetX = targetPixelPosition.x;
        const distance = Math.abs(this.x - targetX);
        return distance < 1;
    }

    isCurrentTargetYReached(): boolean {
        if (!this.currentTarget) {
            return false;
        }

        const targetPixelPosition = this.currentTarget.getCenter();
        if (!targetPixelPosition) {
            return false;
        }

        const targetY = targetPixelPosition.y;
        const distance = Math.abs(this.y - targetY);
        return distance < 1;
    }
    */

    isCurrentTargetReached(currentTile: Tile): boolean {
        if (!this.currentTarget) {
            return false;
        }

        if(!currentTile) {
            return false;
        }

        const targetTilePosition = this.currentTarget.getPosition();
        const currentTilePosition = currentTile.getPosition();

        if (!targetTilePosition || !currentTilePosition) {
            return false;
        }

        const isSameRow = targetTilePosition.row === currentTilePosition.row;
        const isSameCol = targetTilePosition.col === currentTilePosition.col;

        return isSameRow && isSameCol;
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
}