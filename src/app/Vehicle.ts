import Road from 'app/Road';
import Tile from 'app/Tile';
import Building from 'app/Building';
import PathFinder from 'app/PathFinder';

import { radiansToDegrees } from 'util/math';
import { directionToRadianRotation } from 'util/tools';

import { TilePosition, PixelPosition } from 'types/Position';
import { Image } from 'types/Phaser';
import { Direction, Axis } from 'types/Movement';

export default class Vehicle {
    private x: number;
    private y: number;

    private depth: number;
    private speed: number;
    private rotationSpeed: number;

    private currentTarget: PixelPosition | null;
    private direction: Direction;
    private movingAxis: Axis;

    private path: Tile[];
    private currentDestination: TilePosition;

    private asset: Image;

    private redrawFunction: ((timeDelta: number) => void) | null;

    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;

        this.depth = 0;
        this.speed = 0.1;
        this.rotationSpeed = 0.007;

        this.currentTarget = null;
        this.direction = Direction.East;
        this.movingAxis = Axis.X;

        this.path = [];
        this.currentDestination = null;
        this.asset = null;

        this.redrawFunction = null;
    }

    drive(currentTile: Tile, timeDelta: number): void {
        if (!this.asset || !this.currentTarget || !(currentTile instanceof Road)) {
            return;
        }
        
        this.updatePosition(this.movingAxis, timeDelta);
        this.updateDirection(this.movingAxis);
        this.updateDepth(currentTile);

        if (this.isCurrentTargetReached()) {
            this.setNextTarget(currentTile);
        }
    }

    updatePosition(axis: Axis, timeDelta: number): void {
        if (!this.currentTarget) {
            return;
        }

        const speed = this.speed * timeDelta;
        if (axis === Axis.X) {
            const speedX = speed * Math.sign(this.currentTarget.x - this.x);
            let potentialX = this.x + speedX;

            if (Math.abs(potentialX - this.currentTarget.x) < Math.abs(speedX)) {
                potentialX = this.currentTarget.x; // Snap directly to target if overshooting
            }

            this.x = potentialX;

        } else if (axis === Axis.Y) {
            const speedY = speed * Math.sign(this.currentTarget.y - this.y);
            let potentialY = this.y + speedY;

            if (Math.abs(potentialY - this.currentTarget.y) < Math.abs(speedY)) {
                potentialY = this.currentTarget.y; // Snap directly to target if overshooting
            }

            this.y = potentialY;

        } else {
            throw new Error(`[Vehicle] Invalid moving axis: ${axis}`);
        }
    }

    updateDirection(axis: Axis): void {
        if (!this.currentTarget) {
            return;
        }

        if (axis === Axis.X) {
            const doesPositionMatchTarget = this.x !== this.currentTarget.x;
            const potentialDirection = this.x < this.currentTarget.x ? Direction.East : Direction.West;

            this.direction = doesPositionMatchTarget ? potentialDirection : this.direction;
    
            if (this.isCurrentTargetXReached()) {
                this.movingAxis = !this.isCurrentTargetYReached() ? Axis.Y : this.movingAxis;
                this.direction = this.isCurrentTargetYReached() ? Direction.NULL : this.direction;
            }

        } else if (axis === Axis.Y) {
            const doesPositionMatchTargetY = this.y !== this.currentTarget.y;
            const potentialDirectionY = this.y < this.currentTarget.y ? Direction.South : Direction.North;
            
            this.direction = doesPositionMatchTargetY ? potentialDirectionY : this.direction;
    
            if (this.isCurrentTargetYReached()) {
                this.movingAxis = !this.isCurrentTargetXReached() ? Axis.X : this.movingAxis;
                this.direction = this.isCurrentTargetXReached() ? Direction.NULL : this.direction;
            }

        } else {
            throw new Error(`[Vehicle] Invalid moving axis: ${axis}`);
        }
    }

    setNextTarget(currentTile: Tile): void {
        if (!this.path.length || !currentTile) {
            return;
        }

        const currentTilePosition = currentTile.getPosition();
        if (!currentTilePosition) {
            console.warn(`[Vehicle] Can't set next target, current position not valid`, currentTilePosition);
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
        if (!(nextTile instanceof Road)) {
            console.warn(`[Vehicle] Next tile is not a road`, nextTile);
            return;
        }

        const nextTilePosition = nextTile.getPosition();
        const lanes = nextTile.getLane();
        if (!nextTilePosition || !lanes) {
            console.warn(`[Vehicle] Could not determine next tile position or lanes`, nextTile, lanes);
            return;
        }

        // Get direction of nextTile relative to currentTile
        const relativeDirection = currentTile.getRelativeDirection(nextTile);
        if (!relativeDirection) {
            console.warn(`[Vehicle] Could not determine relative tile direction`, currentTile, nextTile);
            return;
        }

        // Determine which lane entry Point is going to be the next target
        this.currentTarget = nextTile.getLaneEntryPoint(relativeDirection);
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

    curve(currentRotation: number, timeDelta: number): number {
        if (this.direction === Direction.NULL) {
            return currentRotation;
        }
        const desiredRotation = directionToRadianRotation(this.direction);

        // Normalize currentRotation to be within -pi to pi
        currentRotation = (currentRotation % (2 * Math.PI) + (2 * Math.PI)) % (2 * Math.PI);
        if (currentRotation > Math.PI) {
            currentRotation -= 2 * Math.PI;
        }

        // If currentRotation is already the desiredRotation, no need to recalculate
        if (currentRotation === desiredRotation) {
            return currentRotation;
        }

        // Calculate the shortest rotation direction
        let rotationDelta = desiredRotation - currentRotation;
        if (rotationDelta > Math.PI) {
            rotationDelta -= 2 * Math.PI;
        } else if (rotationDelta < -Math.PI) {
            rotationDelta += 2 * Math.PI;
        }

        // Snap to desiredRotation if rotationDelta too large, we can't have a single curve more than 180 degrees
        const snapThreshold = 180;
        if (radiansToDegrees(rotationDelta) >= snapThreshold) {
            return desiredRotation;
        }

        // Calculate newRotation according to rotation speed and normalize it to be within -pi to pi
        const rotationDirection = Math.sign(rotationDelta);
        const rotationAmount = Math.min(Math.abs(rotationDelta), this.rotationSpeed * timeDelta) * rotationDirection;
        const newRotation = ((currentRotation + rotationAmount) + 2 * Math.PI) % (2 * Math.PI);

        return newRotation;
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

    redraw(timeDelta: number): void {
        if (this.redrawFunction) {
            this.redrawFunction(timeDelta);
        }
    }
}