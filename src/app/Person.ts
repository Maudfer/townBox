import Road from 'app/Road';
import Tile from 'app/Tile';
import PathFinder from 'app/PathFinder';

import { TilePosition, PixelPosition } from 'types/Position';
import { Image } from 'types/Phaser';

export default class Person {
    private x: number;
    private y: number;

    private depth: number;
    private speed: number;

    private currentTarget: Tile | null;
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

        if (this.isCurrentTargetReached()) {
            this.setNextTarget();
            return;
        }

        const nextCorner = this.determineNextCorner(currentTile, this.currentTarget);

        // TODO: implement timeDelta to make the movement frame-independent
        const speedX = this.speed * Math.sign(targetCenter.x - this.x); // * timeDelta;
        const speedY = this.speed * Math.sign(targetCenter.y - this.y); // * timeDelta;

        let potentialX = this.x + speedX;
        let potentialY = this.y + speedY;

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

    setNextTarget(): void {
        if (!this.path.length) {
            return;
        }

        const nextTile = this.path.shift();
        if (!nextTile) {
            return;
        }

        this.currentTarget = nextTile;
        const targetCenter = this.currentTarget.getCenter();
        if (!targetCenter) {
            return;
        }

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
            this.setNextTarget();
        }
    }

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

    isCurrentTargetReached(): boolean {
        if (!this.currentTarget) {
            return false;
        }

        const tileCenter = this.currentTarget.getCenter();
        if (!tileCenter) return false;

        // Calculate the bounds of the tile
        const tileLeftEdge = tileCenter.x - TILE_SIZE / 2;
        const tileRightEdge = tileCenter.x + TILE_SIZE / 2;
        const tileTopEdge = tileCenter.y - TILE_SIZE / 2;
        const tileBottomEdge = tileCenter.y + TILE_SIZE / 2;

        // Check if the person's position is within the bounds of the tile
        const isWithinHorizontalBounds = this.x >= tileLeftEdge && this.x <= tileRightEdge;
        const isWithinVerticalBounds = this.y >= tileTopEdge && this.y <= tileBottomEdge;

        return isWithinHorizontalBounds && isWithinVerticalBounds;
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