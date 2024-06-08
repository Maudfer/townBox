import Road from 'game/Road';
import Tile from 'game/Tile';
import Building from 'game/Building';
import PathFinder from 'game/PathFinder';

import { radiansToDegrees } from 'util/Math';
import { directionToRadianRotation } from 'util/tools';

import { TilePosition, PixelPosition } from 'types/Position';
import { Image } from 'types/Phaser';
import { Direction, Axis } from 'types/Movement';

// Constants
const NORMAL_ACCELERATION = 0.001;
const NORMAL_TOP_SPEED = 0.150;

const CURVE_ACCELERATION = 0.002;
const CURVE_TOP_SPEED = 0.100;

const INITIAL_SPEED = 0.000;
const ROTATION_SPEED = 0.009;

export default class Vehicle {
    private x: number;
    private y: number;

    private depth: number;
    private acceleration: number; // Acceleration is also used as deceleration
    private speed: number;
    private topSpeed: number;
    private rotationSpeed: number;

    private currentTarget: PixelPosition | null;
    private currentTargetTile: Tile | null;
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
        this.acceleration = NORMAL_ACCELERATION;
        this.topSpeed = NORMAL_TOP_SPEED;
        this.speed = INITIAL_SPEED;
        this.rotationSpeed = ROTATION_SPEED;
        this.currentTarget = null;
        this.currentTargetTile = null;

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

        // Speed logic
        if (this.isNearCurve()) {
            this.topSpeed = CURVE_TOP_SPEED;
            this.acceleration = CURVE_ACCELERATION;
        } else {
            this.topSpeed = NORMAL_TOP_SPEED;
            this.acceleration = NORMAL_ACCELERATION;
        }

        this.speed = this.speed < 0 ? 0 : this.speed; // Prevent negative speed
        if (this.speed < this.topSpeed) {
            this.speed += this.acceleration;
        } else if (this.speed > this.topSpeed) {
            this.speed -= this.acceleration;
        }
        
        // Movement logic
        const movement = this.speed * timeDelta;
        if (this.movingAxis === Axis.X) {
            const movementX = movement * Math.sign(this.currentTarget.x - this.x);
            let potentialX = this.x + movementX;

            if (Math.abs(potentialX - this.currentTarget.x) < Math.abs(movementX)) {
                potentialX = this.currentTarget.x; // Snap directly to target if overshooting
            }

            this.x = potentialX;

        } else if (this.movingAxis === Axis.Y) {
            const movementY = movement * Math.sign(this.currentTarget.y - this.y);
            let potentialY = this.y + movementY;

            if (Math.abs(potentialY - this.currentTarget.y) < Math.abs(movementY)) {
                potentialY = this.currentTarget.y; // Snap directly to target if overshooting
            }

            this.y = potentialY;

        } else {
            throw new Error(`[Vehicle] Invalid moving axis: ${this.movingAxis}`);
        }

        this.updateDirection(this.movingAxis);
        this.updateDepth(currentTile);

        if (this.isCurrentTargetReached()) {
            this.setNextTarget(currentTile);
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
        this.currentTargetTile = nextTile;
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

    isNearCurve(): boolean {
        const nextTile = this.path[0];
        if (!this.currentTarget || !this.currentTargetTile || !nextTile) {
            return false;
        }

        // Determine if a curve is ahead
        const currentDirection = this.movingAxis;
        const nextDirection = (this.currentTargetTile.getCol() === nextTile.getCol()) ? Axis.Y : Axis.X;

        // If moving axis and the axis to the next tile are different, a curve is coming up
        if ((currentDirection !== nextDirection)) {
            return true;
        }

        return false;
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