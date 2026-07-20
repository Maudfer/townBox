import type Person from 'game/agents/Person';
import PathFinder from 'game/agents/PathFinder';
import Building from 'game/world/Building';
import Road from 'game/world/Road';
import Tile from 'game/world/Tile';
import { Direction, Axis } from 'types/Movement';
import { Image } from 'types/Phaser';
import { TilePosition, PixelPosition } from 'types/Position';
import { radiansToDegrees } from 'util/Math';
import { directionToRadianRotation } from 'util/tools';

// Constants
const NORMAL_ACCELERATION = 0.001;
const NORMAL_TOP_SPEED = 0.150;

const CURVE_ACCELERATION = 0.002;
const CURVE_TOP_SPEED = 0.100;

const INITIAL_SPEED = 0.000;
const ROTATION_SPEED = 0.009;

// Budget-consuming drive tunables (V11 / aliveness-4 M8), mirroring Person's.
const VEHICLE_MOVE_EPSILON = 1e-6;
const VEHICLE_DRIVE_ITERATION_LIMIT = 10000;

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

    // When true, the vehicle is driven by a commuter's travel state machine and must NOT pick its own random
    // destination (Field skips updateDestination for it). Test/idle cars stay false and wander.
    private controlled: boolean;

    // Occupants (task 130 ridesharing): the people physically inside — one DRIVER (whose presence lets the
    // car move) plus passengers. board() at EnteringCar / joinRide, disembark() at ExitingCar; drive() gates
    // on a driver being aboard. A car can't move driverless (task 008). The debug V-key test car carries an
    // implicit `debugDriver` so the wander demo still works with no real occupants. Person is a type-only
    // import (erased at compile) so storing the refs doesn't create a runtime Person↔Vehicle cycle.
    private occupants: Person[] = [];
    private driver: Person | null = null;
    private debugDriver: boolean;
    // Max seats — a group ride beyond this needs a second car (task 130).
    static readonly SEAT_CAPACITY = 4;

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
        this.controlled = false;
        this.occupants = [];
        this.driver = null;
        this.debugDriver = false;
        this.asset = null;

        this.redrawFunction = null;
    }

    setControlled(controlled: boolean): void {
        this.controlled = controlled;
    }

    isControlled(): boolean {
        return this.controlled;
    }

    // Boarding/disembarking (task 008 commute spec + task 130 ridesharing): drive() refuses to move a
    // driverless car. The first boarder is the driver unless `asDriver` says otherwise; a shared ride boards
    // the driver first (asDriver), then passengers (asDriver=false).
    board(person: Person, asDriver = false): void {
        if (!this.occupants.includes(person)) {
            this.occupants.push(person);
        }
        if (asDriver || (this.driver === null && this.occupants.length === 1)) {
            this.driver = person;
        }
    }

    disembark(person: Person): void {
        this.occupants = this.occupants.filter(occupant => occupant !== person);
        if (this.driver === person) {
            this.driver = null;
        }
    }

    // True while anyone is aboard (backward-compatible name). Distinct from hasDriver() — a car with only
    // passengers and no driver is occupied but can't move (the W8 occupied-driverless invariant guards it).
    isOccupied(): boolean {
        return this.occupants.length > 0;
    }

    hasDriver(): boolean {
        return this.driver !== null || this.debugDriver;
    }

    getDriver(): Person | null {
        return this.driver;
    }

    getOccupants(): readonly Person[] {
        return this.occupants;
    }

    isAboard(person: Person): boolean {
        return this.occupants.includes(person);
    }

    seatsAvailable(): number {
        return Vehicle.SEAT_CAPACITY - this.occupants.length;
    }

    setDebugDriver(debugDriver: boolean): void {
        this.debugDriver = debugDriver;
    }

    drive(currentTile: Tile, timeDelta: number): void {
        // Cars cannot move without a DRIVER (task 008 commute spec + task 130) — the driver boards at
        // EnteringCar and steps out at ExitingCar; the debug V-key test car carries an implicit test driver.
        // And cars only drive on ROADS: they spawn and park on the street, never inside a footprint.
        if (!this.asset || !this.currentTarget || !this.hasDriver() || !(currentTile instanceof Road)) {
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

        // Budget-consuming drive (V11 / aliveness-4 M8): the same fix walkers got — spend the frame's travel
        // across as many lane segments as it covers, clamped per axis so nothing overshoots. Acceleration is
        // resolved ONCE per frame above (unchanged physics); only the position advancement loops. At 1×/10×
        // the budget is small and this runs one iteration (identical to the old single-step); only large
        // 50×/hitch deltas iterate, so a commute car keeps up with the clock instead of stranding budget at
        // every lane waypoint (the old code moved one axis, snapped to target, and RETURNED — falling behind).
        let budget = this.speed * timeDelta;
        let guard = 0;
        while (budget > VEHICLE_MOVE_EPSILON && this.currentTarget && guard++ < VEHICLE_DRIVE_ITERATION_LIMIT) {
            const axisBefore = this.movingAxis;
            let stepMagnitude = 0;
            if (this.movingAxis === Axis.X) {
                const deltaX = this.currentTarget.x - this.x;
                const stepX = Math.sign(deltaX) * Math.min(Math.abs(deltaX), budget);
                this.x += stepX;
                stepMagnitude = Math.abs(stepX);
            } else if (this.movingAxis === Axis.Y) {
                const deltaY = this.currentTarget.y - this.y;
                const stepY = Math.sign(deltaY) * Math.min(Math.abs(deltaY), budget);
                this.y += stepY;
                stepMagnitude = Math.abs(stepY);
            } else {
                throw new Error(`[Vehicle] Invalid moving axis: ${this.movingAxis}`);
            }

            budget -= stepMagnitude;
            this.updateDirection(this.movingAxis); // handles the axis switch on reaching a target
            this.updateDepth(currentTile);

            if (this.isCurrentTargetReached()) {
                if (this.isDestinationReached()) {
                    break; // at the final lane target, path empty — the travel machine takes over
                }
                this.setNextTarget(currentTile);
                if (!this.currentTarget || this.isCurrentTargetReached()) {
                    break; // no further advance possible this frame
                }
                continue;
            }
            // Mid-segment with the budget spent (or an axis with no distance and no switch pending) → stop.
            if (stepMagnitude < VEHICLE_MOVE_EPSILON && this.movingAxis === axisBefore) {
                break;
            }
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

        let nextTile = this.path.shift();
        // A car starting on a road footprint gets that same footprint as the path's first element (the
        // reconstructed path only excludes the start CELL, not other cells of the start structure). Skip it —
        // getRelativeDirection(current → same tile) is undefined and would leave the car targetless.
        while (nextTile === currentTile && this.path.length) {
            nextTile = this.path.shift();
        }
        if (!nextTile || nextTile === currentTile) {
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

    setDestinationTile(currentTile: Tile, destination: TilePosition, pathFinder: PathFinder): void {
        if (!destination || this.currentDestination) {
            return;
        }

        this.currentDestination = destination;

        const currentTilePosition = {
            row: currentTile.getRow(),
            col: currentTile.getCol()
        };

        const path = pathFinder.findPath(currentTilePosition, this.currentDestination);
        this.path = path;
        // Whether the whole route lies on the road segment the car is already parked on: either the path
        // collapsed to just that segment (a same-segment destination — setNextTarget skips same-tile entries,
        // which would leave the car targetless), or A* returned [] because the destination IS the cell we are
        // on. A genuinely unreachable destination ([] with a DIFFERENT target cell) is deliberately excluded —
        // that stays targetless rather than falsely signalling arrival.
        const alreadyOnDestinationSegment =
            (path.length > 0 && path.every(tile => tile === currentTile))
            || (path.length === 0
                && destination.row === currentTilePosition.row
                && destination.col === currentTilePosition.col);

        if (path.length) {
            this.setNextTarget(currentTile);
        }
        if (!this.currentTarget && alreadyOnDestinationSegment) {
            // Arrive in place (task-012 live-verification fix): the car is already on the destination's road;
            // drive() detects arrival immediately and the traveller walks the last stretch.
            this.currentTarget = { x: this.x, y: this.y };
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

    isDestinationReached(): boolean {
        return !this.path.length && this.isCurrentTargetReached();
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
        // The spawn/despawn race (W8 / P0-2.2): same-tick spawn+removal destroys getAsset() === null and
        // the sprite lands afterwards, orphaned outside the vehicle list. See Person.setAsset.
        if (this.removedFromField) {
            asset?.destroy();
            return;
        }
        this.asset = asset;
    }

    markRemoved(): void {
        this.removedFromField = true;
    }

    private removedFromField = false;

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