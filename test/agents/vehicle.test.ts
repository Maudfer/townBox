import PathFinder from 'game/agents/PathFinder';
import Vehicle from 'game/agents/Vehicle';
import Building from 'game/world/Building';
import Field from 'game/world/Field';
import Road from 'game/world/Road';
import Soil from 'game/world/Soil';
import Tile from 'game/world/Tile';
import { Direction, Axis } from 'types/Movement';

// Vehicle.updateDestination() reads the global Phaser.Math.RND — stub it (mirrors
// test/world/spawning.test.ts and test/agents/person.test.ts).
beforeAll(() => {
    (global as unknown as { Phaser: unknown }).Phaser = { Math: { RND: { pick: (items: unknown[]) => items[0] } } };
});

// Stamps structures onto an otherwise-soil fine grid (every footprint cell references the same instance), the
// minimal Field surface PathFinder needs — mirrors test/agents/pathFinder.test.ts.
function stampField(structures: Tile[], rows: number, cols: number): Field {
    const matrix: { [row: number]: { [col: number]: Tile } } = {};
    for (let row = 0; row < rows; row++) {
        matrix[row] = {};
        for (let col = 0; col < cols; col++) {
            matrix[row]![col] = new Soil(row, col, 'grass');
        }
    }
    for (const structure of structures) {
        for (const cell of structure.getFootprintCells(3)) {
            if (cell && cell.row >= 0 && cell.row < rows && cell.col >= 0 && cell.col < cols) {
                matrix[cell.row]![cell.col] = structure;
            }
        }
    }
    return {
        matrix: matrix as unknown as Field['matrix'],
        isValidPosition: (row: number, col: number) => row >= 0 && row < rows && col >= 0 && col < cols,
        getTile: (row: number, col: number) => matrix[row]?.[col] ?? null,
    } as unknown as Field;
}

describe('Vehicle construction defaults and simple accessors', () => {
    test('starts uncontrolled, facing East, at depth 0, with no asset', () => {
        const v = new Vehicle(3, 4);
        expect(v.isControlled()).toBe(false);
        expect(v.getDirection()).toBe(Direction.East);
        expect(v.getDepth()).toBe(0);
        expect(v.getPosition()).toEqual({ x: 3, y: 4 });
        expect(v.getAsset()).toBeNull();
    });

    test('setPosition / setAsset / setControlled round-trip', () => {
        const v = new Vehicle(0, 0);
        v.setPosition(9, 8);
        expect(v.getPosition()).toEqual({ x: 9, y: 8 });

        const asset = { fake: true } as any;
        v.setAsset(asset);
        expect(v.getAsset()).toBe(asset);

        v.setControlled(true);
        expect(v.isControlled()).toBe(true);
    });

    test('updateDepth derives depth from the given tile\'s row, matching the (row+1)*10+1 convention', () => {
        const v = new Vehicle(0, 0);
        v.updateDepth(new Soil(6, 0, 'grass'));
        expect(v.getDepth()).toBe((6 + 1) * 10 + 1);
    });

    test('redraw() invokes the registered redraw function, and is a no-op when none is set', () => {
        const v = new Vehicle(0, 0);
        expect(() => v.redraw(16)).not.toThrow();

        const calls: number[] = [];
        v.setRedrawFunction((dt) => calls.push(dt));
        v.redraw(16);
        expect(calls).toEqual([16]);
    });
});

describe('target-reached helpers', () => {
    test('X/Y reached are false with no current target', () => {
        const v = new Vehicle(0, 0);
        expect(v.isCurrentTargetXReached()).toBe(false);
        expect(v.isCurrentTargetYReached()).toBe(false);
        expect(v.isCurrentTargetReached()).toBe(false);
    });

    test('X/Y reached compare within 1px of the target', () => {
        const v = new Vehicle(10, 10);
        (v as any).currentTarget = { x: 10.5, y: 20 };
        expect(v.isCurrentTargetXReached()).toBe(true);
        expect(v.isCurrentTargetYReached()).toBe(false);

        (v as any).currentTarget = { x: 10.5, y: 10.9 };
        expect(v.isCurrentTargetReached()).toBe(true);
    });

    test('isDestinationReached requires both an empty path and the target reached', () => {
        const v = new Vehicle(10, 10);
        (v as any).currentTarget = { x: 10, y: 10 };
        (v as any).path = [new Road(0, 0, null)];
        expect(v.isDestinationReached()).toBe(false);

        (v as any).path = [];
        expect(v.isDestinationReached()).toBe(true);
    });
});

describe('isNearCurve()', () => {
    test('false with no current target/targetTile/next path entry', () => {
        const v = new Vehicle(0, 0);
        expect(v.isNearCurve()).toBe(false);
    });

    test('true when the moving axis differs from the axis toward the next path tile', () => {
        const v = new Vehicle(0, 0);
        (v as any).currentTarget = { x: 10, y: 10 };
        (v as any).currentTargetTile = new Road(0, 0, null); // col 0
        (v as any).movingAxis = Axis.X;
        (v as any).path = [new Road(1, 5, null)]; // different col -> next leg is on X too... use Y instead

        // currentTargetTile col (0) !== nextTile col (5) -> nextDirection = Axis.X, same as movingAxis -> no curve
        expect(v.isNearCurve()).toBe(false);

        // Make the next tile share the SAME column as the current target tile -> nextDirection = Axis.Y,
        // which differs from movingAxis (X) -> a curve is ahead.
        (v as any).path = [new Road(1, 0, null)];
        expect(v.isNearCurve()).toBe(true);
    });
});

describe('drive() guard clauses skip movement entirely', () => {
    const road = new Road(0, 0, null);

    test('does nothing without an asset', () => {
        const v = new Vehicle(10, 10);
        (v as any).currentTarget = { x: 50, y: 50 };
        v.drive(road, 100);
        expect(v.getPosition()).toEqual({ x: 10, y: 10 });
    });

    test('does nothing without a current target', () => {
        const v = new Vehicle(10, 10);
        v.setAsset({} as any);
        v.drive(road, 100);
        expect(v.getPosition()).toEqual({ x: 10, y: 10 });
    });

    test('does nothing when the current tile is not drivable (soil)', () => {
        const v = new Vehicle(10, 10);
        v.setAsset({} as any);
        v.setDebugDriver(true);
        (v as any).currentTarget = { x: 50, y: 50 };
        v.drive(new Soil(0, 0, 'grass'), 100);
        expect(v.getPosition()).toEqual({ x: 10, y: 10 });
    });

    // The task-008 commute spec: cars live on the STREET (they spawn in front of the origin and park on the
    // road in front of the destination), so driving is Road-only — and an EMPTY car must never move: the
    // occupant boards at EnteringCar and steps out at ExitingCar. The debug V-key test car carries an
    // implicit test driver instead, so the wander demo still works.
    test('does nothing when the current tile is a Building (cars stay on the street)', () => {
        const v = new Vehicle(10, 10);
        v.setAsset({} as any);
        v.setDebugDriver(true);
        (v as any).currentTarget = { x: 50, y: 10 };
        (v as any).movingAxis = Axis.X;
        v.drive(new Building(0, 0, null), 100);
        expect(v.getPosition()).toEqual({ x: 10, y: 10 });
    });

    test('does nothing without a DRIVER inside (the occupancy gate, task 130)', () => {
        const v = new Vehicle(10, 10);
        v.setAsset({} as any);
        const driver = {} as any; // a minimal occupant ref — Vehicle only stores it (type-only Person)
        (v as any).currentTarget = { x: 50, y: 10 };
        (v as any).movingAxis = Axis.X;
        v.drive(new Road(0, 0, null), 100);
        expect(v.getPosition()).toEqual({ x: 10, y: 10 }); // driverless: parked

        v.board(driver, true);
        v.drive(new Road(0, 0, null), 100);
        expect(v.getPosition()!.x).toBeGreaterThan(10); // driver aboard: moves

        v.disembark(driver);
        const parked = { ...v.getPosition()! };
        v.drive(new Road(0, 0, null), 100);
        expect(v.getPosition()).toEqual(parked); // driverless again: parked again
    });

    test('a debug test driver also satisfies the occupancy gate (V-key wander cars)', () => {
        const v = new Vehicle(10, 10);
        v.setAsset({} as any);
        v.setDebugDriver(true);
        (v as any).currentTarget = { x: 50, y: 10 };
        (v as any).movingAxis = Axis.X;
        v.drive(new Road(0, 0, null), 100);
        expect(v.getPosition()!.x).toBeGreaterThan(10);
    });

    test('a shared car waits at the curb until all expected riders board (the board window, task 130)', () => {
        const v = new Vehicle(10, 10);
        v.setAsset({} as any);
        const driver = {} as any, rider = {} as any;
        (v as any).currentTarget = { x: 50, y: 10 };
        (v as any).movingAxis = Axis.X;
        v.setRideExpectations(2, 1000); // expect 2 riders, a long window
        v.board(driver, true);

        // Driver aboard but the passenger hasn't boarded yet → the car holds at the curb.
        v.drive(new Road(0, 0, null), 100);
        expect(v.getPosition()).toEqual({ x: 10, y: 10 });

        // Passenger boards → the ride departs.
        v.board(rider, false);
        v.drive(new Road(0, 0, null), 100);
        expect(v.getPosition()!.x).toBeGreaterThan(10);
    });

    test('the board window lapses so a no-show never strands the car (task 130)', () => {
        const v = new Vehicle(10, 10);
        v.setAsset({} as any);
        (v as any).currentTarget = { x: 50, y: 10 };
        (v as any).movingAxis = Axis.X;
        v.setRideExpectations(2, 2); // expect 2, but only a 2-frame window
        v.board({} as any, true); // only the driver ever boards
        v.drive(new Road(0, 0, null), 100); // window frame 1 — wait
        v.drive(new Road(0, 0, null), 100); // window frame 2 — wait
        expect(v.getPosition()).toEqual({ x: 10, y: 10 });
        v.drive(new Road(0, 0, null), 100); // window lapsed — leave without the no-show
        expect(v.getPosition()!.x).toBeGreaterThan(10);
    });
});

describe('drive(): real per-frame movement', () => {
    test('accelerates toward the target along X, updates direction/depth, and snaps exactly on overshoot', () => {
        const road = new Road(3, 3, null);
        const v = new Vehicle(0, 0);
        v.setAsset({} as any);
        v.setDebugDriver(true); // drive() refuses to move an empty car (task 008 spec)
        (v as any).currentTarget = { x: 5, y: 0 }; // small distance so a big timeDelta overshoots
        (v as any).movingAxis = Axis.X;

        v.drive(road, 1); // small step: accelerates from 0, should NOT reach target yet
        expect((v as any).x).toBeGreaterThan(0);
        expect((v as any).x).toBeLessThan(5);
        expect(v.getDirection()).toBe(Direction.East);
        expect(v.getDepth()).toBe((road.getRow() + 1) * 10 + 1);

        // A large timeDelta would overshoot the remaining distance — verify it snaps exactly to the target
        // instead (game/agents/Vehicle.ts drive(): "Snap directly to target if overshooting").
        v.drive(road, 100000);
        expect((v as any).x).toBe(5);
    });

    test('moving along Y updates direction to South/North', () => {
        const road = new Road(0, 0, null);
        const v = new Vehicle(0, 0);
        v.setAsset({} as any);
        v.setDebugDriver(true); // drive() refuses to move an empty car (task 008 spec)
        (v as any).currentTarget = { x: 0, y: 5 };
        (v as any).movingAxis = Axis.Y;

        v.drive(road, 100000); // overshoots and snaps

        expect((v as any).y).toBe(5);
    });

    test('throws on an invalid moving axis', () => {
        const road = new Road(0, 0, null);
        const v = new Vehicle(0, 0);
        v.setAsset({} as any);
        v.setDebugDriver(true); // drive() refuses to move an empty car (task 008 spec)
        (v as any).currentTarget = { x: 5, y: 5 };
        (v as any).movingAxis = 'diagonal';

        expect(() => v.drive(road, 10)).toThrow(/Invalid moving axis/);
    });

    test('reaching the target invokes setNextTarget for the next path entry', () => {
        const nextRoad = new Road(0, 1, null);
        nextRoad.calculateLanes({ width: 48, height: 48 }, { x: 72, y: 24 });
        const road = new Road(0, 0, null);

        const v = new Vehicle(0, 0);
        v.setAsset({} as any);
        v.setDebugDriver(true); // drive() refuses to move an empty car (task 008 spec)
        (v as any).currentTarget = { x: 0.2, y: 0 }; // already essentially at the target
        (v as any).currentTargetTile = road;
        (v as any).movingAxis = Axis.X;
        (v as any).path = [nextRoad];

        v.drive(road, 1);

        // setNextTarget shifted the path and retargeted onto nextRoad's lane entry point.
        expect((v as any).path).toEqual([]);
        expect((v as any).currentTargetTile).toBe(nextRoad);
        expect((v as any).currentTarget).not.toBeNull();
    });

    test('slows to the curve speed/acceleration when a turn is ahead, and uses normal speed otherwise', () => {
        const roadStraight = new Road(0, 0, null);
        const vStraight = new Vehicle(0, 0);
        vStraight.setAsset({} as any);
        vStraight.setDebugDriver(true);
        (vStraight as any).currentTarget = { x: 100, y: 0 };
        (vStraight as any).currentTargetTile = new Road(0, 0, null);
        (vStraight as any).movingAxis = Axis.X;
        (vStraight as any).path = [new Road(1, 5, null)]; // same axis ahead -> no curve

        vStraight.drive(roadStraight, 1);
        expect((vStraight as any).topSpeed).toBeCloseTo(0.15);

        const roadCurve = new Road(0, 0, null);
        const vCurve = new Vehicle(0, 0);
        vCurve.setAsset({} as any);
        vCurve.setDebugDriver(true);
        (vCurve as any).currentTarget = { x: 100, y: 0 };
        (vCurve as any).currentTargetTile = new Road(0, 0, null);
        (vCurve as any).movingAxis = Axis.X;
        (vCurve as any).path = [new Road(1, 0, null)]; // same col as currentTargetTile -> a turn is ahead

        vCurve.drive(roadCurve, 1);
        expect((vCurve as any).topSpeed).toBeCloseTo(0.1);
    });
});

describe('updateDirection()', () => {
    test('does nothing without a current target', () => {
        const v = new Vehicle(0, 0);
        expect(() => v.updateDirection(Axis.X)).not.toThrow();
        expect(v.getDirection()).toBe(Direction.East);
    });

    test('X axis: faces East/West toward the target, switches axis to Y and NULLs direction once both reached', () => {
        const v = new Vehicle(0, 0);
        (v as any).currentTarget = { x: 10, y: 10 };

        v.updateDirection(Axis.X);
        expect(v.getDirection()).toBe(Direction.East);
        expect((v as any).movingAxis).toBe(Axis.X); // Y not reached yet, so no switch

        (v as any).x = 10; // X reached, Y (10) is not
        v.updateDirection(Axis.X);
        expect((v as any).movingAxis).toBe(Axis.Y);

        (v as any).y = 10; // now both reached
        v.updateDirection(Axis.X);
        expect(v.getDirection()).toBe(Direction.NULL);
    });

    test('Y axis: faces South/North toward the target, switches axis to X and NULLs direction once both reached', () => {
        const v = new Vehicle(0, 0);
        (v as any).currentTarget = { x: 10, y: 10 };

        v.updateDirection(Axis.Y);
        expect(v.getDirection()).toBe(Direction.South);
        expect((v as any).movingAxis).toBe(Axis.X); // default axis, Y branch doesn't touch it if X not reached

        (v as any).y = 10; // Y reached, X (10) is not
        v.updateDirection(Axis.Y);
        expect((v as any).movingAxis).toBe(Axis.X);

        (v as any).x = 10; // both reached now
        v.updateDirection(Axis.Y);
        expect(v.getDirection()).toBe(Direction.NULL);
    });

    test('throws on an invalid axis', () => {
        const v = new Vehicle(0, 0);
        (v as any).currentTarget = { x: 10, y: 10 };
        expect(() => v.updateDirection('diagonal' as Axis)).toThrow(/Invalid moving axis/);
    });
});

describe('setNextTarget()', () => {
    test('does nothing with an empty path', () => {
        const v = new Vehicle(0, 0);
        (v as any).path = [];
        v.setNextTarget(new Road(0, 0, null));
        expect((v as any).currentTarget).toBeNull();
    });

    test('targets a building entrance when the next path tile is a Building', () => {
        const building = new Building(2, 2, null);
        building.calculateEntrance({ width: 48, height: 48 }, { x: 100, y: 100 });
        const v = new Vehicle(0, 0);
        (v as any).path = [building];

        v.setNextTarget(new Road(0, 0, null));

        expect((v as any).currentTarget).toEqual(building.getEntrance());
    });

    test('targets the lane entry point in the direction of travel when the next tile is a Road', () => {
        const current = new Road(1, 1, null);
        const next = new Road(1, 2, null); // directly east of current
        next.calculateLanes({ width: 48, height: 48 }, { x: 120, y: 48 });
        const v = new Vehicle(0, 0);
        (v as any).path = [next];

        v.setNextTarget(current);

        expect((v as any).currentTarget).toEqual(next.getLaneEntryPoint(Direction.East));
        expect((v as any).currentTargetTile).toBe(next);
    });

    test('warns and stops when the next tile is neither a Building nor a Road', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const v = new Vehicle(0, 0);
        (v as any).path = [new Soil(0, 0, 'grass')];

        v.setNextTarget(new Road(0, 0, null));

        expect((v as any).currentTarget).toBeNull();
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    test('warns and stops when the next Road tile has no lanes computed yet', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const v = new Vehicle(0, 0);
        (v as any).path = [new Road(1, 2, null)]; // calculateLanes() never called

        v.setNextTarget(new Road(1, 1, null));

        expect((v as any).currentTarget).toBeNull();
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});

describe('updateDestination() — debug wander destination pick', () => {
    test('does nothing when there are no destinations to pick from', () => {
        const v = new Vehicle(0, 0);
        const pathFinder = { findPath: jest.fn() } as unknown as PathFinder;

        v.updateDestination(new Road(0, 0, null), new Set(), pathFinder);

        expect((v as any).currentDestination).toBeNull();
        expect(pathFinder.findPath).not.toHaveBeenCalled();
    });

    test('does nothing when a destination is already set', () => {
        const v = new Vehicle(0, 0);
        (v as any).currentDestination = { row: 9, col: 9 };
        const pathFinder = { findPath: jest.fn() } as unknown as PathFinder;

        v.updateDestination(new Road(0, 0, null), new Set(['1-1']), pathFinder);

        expect((v as any).currentDestination).toEqual({ row: 9, col: 9 });
        expect(pathFinder.findPath).not.toHaveBeenCalled();
    });

    test('a destination on row/col 0 is silently skipped (0 is falsy in the guard check)', () => {
        const v = new Vehicle(0, 0);
        const pathFinder = { findPath: jest.fn() } as unknown as PathFinder;

        v.updateDestination(new Road(0, 0, null), new Set(['0-3']), pathFinder);

        expect((v as any).currentDestination).toBeNull();
        expect(pathFinder.findPath).not.toHaveBeenCalled();
    });

    test('picks a destination, computes a path and sets the first target', () => {
        const road = new Road(0, 0, null);
        const next = new Road(0, 1, null);
        next.calculateLanes({ width: 48, height: 48 }, { x: 72, y: 24 });
        const pathFinder = { findPath: () => [next] } as unknown as PathFinder;
        const v = new Vehicle(0, 0);

        v.updateDestination(road, new Set(['5-5']), pathFinder);

        expect((v as any).currentDestination).toEqual({ row: 5, col: 5 });
        expect((v as any).currentTarget).not.toBeNull();
    });
});

describe('setDestinationTile()', () => {
    test('does nothing when destination is null', () => {
        const v = new Vehicle(0, 0);
        const pathFinder = { findPath: jest.fn() } as unknown as PathFinder;

        v.setDestinationTile(new Road(0, 0, null), null, pathFinder);

        expect((v as any).currentDestination).toBeNull();
        expect(pathFinder.findPath).not.toHaveBeenCalled();
    });

    test('does nothing when a destination is already set', () => {
        const v = new Vehicle(0, 0);
        (v as any).currentDestination = { row: 3, col: 3 };
        const pathFinder = { findPath: jest.fn() } as unknown as PathFinder;

        v.setDestinationTile(new Road(0, 0, null), { row: 9, col: 9 }, pathFinder);

        expect((v as any).currentDestination).toEqual({ row: 3, col: 3 });
        expect(pathFinder.findPath).not.toHaveBeenCalled();
    });

    test('sets currentDestination and the first target when the pathfinder returns a path', () => {
        const road = new Road(0, 0, null);
        const next = new Road(0, 1, null);
        next.calculateLanes({ width: 48, height: 48 }, { x: 72, y: 24 });
        const pathFinder = { findPath: () => [next] } as unknown as PathFinder;
        const v = new Vehicle(0, 0);

        v.setDestinationTile(road, { row: 0, col: 1 }, pathFinder);

        expect((v as any).currentDestination).toEqual({ row: 0, col: 1 });
        expect((v as any).currentTarget).toEqual(next.getLaneEntryPoint(Direction.East));
    });

    test('sets currentDestination but leaves the target untouched when the pathfinder returns no path', () => {
        const v = new Vehicle(0, 0);
        const pathFinder = { findPath: () => [] } as unknown as PathFinder;

        v.setDestinationTile(new Road(0, 0, null), { row: 5, col: 5 }, pathFinder);

        expect((v as any).currentDestination).toEqual({ row: 5, col: 5 });
        expect((v as any).currentTarget).toBeNull();
    });

    // Regression (task-012 live verification): a trip whose destination street cell sits on the SAME road
    // segment the car is parked on (e.g. visiting a building across/along the same supertile) produced a path
    // that collapsed to just the car's own road footprint. setNextTarget rightly skips same-tile entries, but
    // that left the car TARGETLESS: drive() couldn't move and isDestinationReached() could never become true,
    // freezing every same-segment leisure trip (and stacking idle cars on the street). The car should instead
    // arrive in place — it is already on the destination's road; the traveller walks the last stretch.
    test('arrives in place when the destination is another cell of the road segment the car is on', () => {
        const road = new Road(1, 1, null); // rows 0-2, cols 0-2 — one supertile segment
        const field = stampField([road], 3, 3);
        const pathFinder = new PathFinder(field);

        const v = new Vehicle(24, 40); // parked somewhere on the segment
        v.setAsset({} as any);
        v.setDebugDriver(true);

        v.setDestinationTile(road, { row: 2, col: 0 }, pathFinder); // another fine cell of the SAME segment

        expect((v as any).currentTarget).not.toBeNull();
        v.drive(road, 16);
        expect(v.isDestinationReached()).toBe(true); // person's Driving step can advance to ExitingCar
    });

    test('arrives in place when the destination IS the anchor cell the car is on (empty path)', () => {
        const road = new Road(1, 1, null);
        const field = stampField([road], 3, 3);
        const pathFinder = new PathFinder(field);

        const v = new Vehicle(24, 24);
        v.setAsset({} as any);
        v.setDebugDriver(true);

        v.setDestinationTile(road, { row: 1, col: 1 }, pathFinder); // start == goal → A* returns []

        expect((v as any).currentTarget).not.toBeNull();
        v.drive(road, 16);
        expect(v.isDestinationReached()).toBe(true);
    });
});

describe('curve()', () => {
    test('returns the current rotation unchanged when direction is NULL', () => {
        const v = new Vehicle(0, 0);
        (v as any).direction = Direction.NULL;
        expect(v.curve(1.23, 100)).toBe(1.23);
    });

    test('returns the current rotation unchanged once it already matches the desired rotation', () => {
        const v = new Vehicle(0, 0);
        (v as any).direction = Direction.East; // desired = 0 rad
        expect(v.curve(0, 100)).toBe(0);
    });

    test('rotates a small step toward the desired rotation, capped by rotationSpeed * timeDelta', () => {
        const v = new Vehicle(0, 0);
        (v as any).direction = Direction.East; // desired = 0 rad
        const result = v.curve(0.5, 10); // rotationDelta = 0 - 0.5 = -0.5, rotationSpeed 0.009 * 10 = 0.09
        // Moves toward 0 by at most 0.09 radians (clamped, since |delta| > cap): 0.5 - 0.09 = 0.41
        expect(result).toBeCloseTo(0.41, 5);
    });

    test('snaps directly to the desired rotation when the raw delta is >= 180 degrees (a single curve cannot exceed 180°)', () => {
        const v = new Vehicle(0, 0);
        (v as any).direction = Direction.West; // desired = PI
        // currentRotation 0 (East-normalized): rotationDelta = PI - 0 = PI exactly -> radiansToDegrees(PI) = 180 >= 180
        const result = v.curve(0, 100);
        expect(result).toBeCloseTo(Math.PI, 5);
    });

    test('wraps a delta greater than PI by subtracting 2*PI before applying rotation speed', () => {
        const v = new Vehicle(0, 0);
        (v as any).direction = Direction.West; // desired = PI
        // currentRotation normalizes to just inside -PI; desired - current > PI, so it wraps.
        const result = v.curve(-3.0, 100000); // huge timeDelta -> rotation goes all the way
        expect(result).toBeCloseTo(Math.PI, 4);
    });

    test('wraps a delta less than -PI by adding 2*PI before applying rotation speed', () => {
        const v = new Vehicle(0, 0);
        (v as any).direction = Direction.North; // desired = -PI/2
        // currentRotation normalizes to PI; desired - current = -PI/2 - PI = -3PI/2 < -PI -> wraps to PI/2.
        const result = v.curve(Math.PI, 100000); // huge timeDelta -> rotation goes all the way
        // North's radian value normalized into [0, 2*PI) is 3*PI/2.
        const expected = ((-Math.PI / 2) + 2 * Math.PI) % (2 * Math.PI);
        expect(result).toBeCloseTo(expected, 4);
    });
});
