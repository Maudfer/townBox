import GameManager from 'game/GameManager';
import PathFinder from 'game/agents/PathFinder';
import Person from 'game/agents/Person';
import Vehicle from 'game/agents/Vehicle';
import Building from 'game/world/Building';
import Road from 'game/world/Road';
import Soil from 'game/world/Soil';
import { Direction } from 'types/Movement';
import { Genders, Relationships } from 'types/Social';
import { TravelStep } from 'types/Travel';

// Person.updateDestination()/Vehicle.updateDestination() read the global Phaser.Math.RND — stub it so the
// wander path is exercisable in node (mirrors test/world/spawning.test.ts).
beforeAll(() => {
    (global as unknown as { Phaser: unknown }).Phaser = { Math: { RND: { pick: (items: unknown[]) => items[0] } } };
});

function makePerson(name: string, age = 30): Person {
    const p = new Person(0, 0);
    p.setupCitizenship(name, 'Family', age, Genders.Male);
    return p;
}

describe('Person construction defaults and simple accessors', () => {
    test('starts idle, outdoors, with no vehicle/building and default facing', () => {
        const p = new Person(5, 7);
        expect(p.isIdle()).toBe(true);
        expect(p.isIndoors()).toBe(false);
        expect(p.getVehicle()).toBeNull();
        expect(p.getCurrentBuilding()).toBeNull();
        expect(p.getDirection()).toBe(Direction.East);
        expect(p.getDepth()).toBe(0);
        expect(p.getPosition()).toEqual({ x: 5, y: 7 });
        expect(p.getAsset()).toBeNull();
    });

    test('setPosition / setDirection / setAsset / setVehicle / setCurrentBuilding round-trip', () => {
        const p = new Person(0, 0);
        p.setPosition(11, 22);
        expect(p.getPosition()).toEqual({ x: 11, y: 22 });

        p.setDirection(Direction.North);
        expect(p.getDirection()).toBe(Direction.North);

        const asset = { fake: true } as any;
        p.setAsset(asset);
        expect(p.getAsset()).toBe(asset);

        const vehicle = new Vehicle(0, 0);
        p.setVehicle(vehicle);
        expect(p.getVehicle()).toBe(vehicle);

        const building = new Building(1, 1, null);
        p.setCurrentBuilding(building);
        expect(p.getCurrentBuilding()).toBe(building);
        p.setCurrentBuilding(null);
        expect(p.getCurrentBuilding()).toBeNull();
    });

    test('setGameManager wires the shared GameManager (no observable state, just must not throw)', () => {
        const p = new Person(0, 0);
        expect(() => p.setGameManager({} as unknown as GameManager)).not.toThrow();
    });

    test('enableWander flips the private wander flag on', () => {
        const p = new Person(0, 0);
        expect((p as unknown as { wander: boolean }).wander).toBe(false);
        p.enableWander();
        expect((p as unknown as { wander: boolean }).wander).toBe(true);
    });

    test('setIndoors / isIndoors round-trip', () => {
        const p = new Person(0, 0);
        p.setIndoors(true);
        expect(p.isIndoors()).toBe(true);
        p.setIndoors(false);
        expect(p.isIndoors()).toBe(false);
    });

    test('updateDepth derives depth from the given tile\'s row, matching the (row+1)*10+1 convention', () => {
        const p = new Person(0, 0);
        p.updateDepth(new Soil(6, 0, 'grass'));
        expect(p.getDepth()).toBe((6 + 1) * 10 + 1);
    });

    test('redraw() invokes the registered redraw function, and is a no-op when none is set', () => {
        const p = new Person(0, 0);
        expect(() => p.redraw(16)).not.toThrow(); // no function registered yet

        const calls: number[] = [];
        p.setRedrawFunction((dt) => calls.push(dt));
        p.redraw(16);
        expect(calls).toEqual([16]);
    });

    test('isIdle is false while a destination is set, even before travelStep advances', () => {
        const p = new Person(0, 0);
        p.setDestination(new Building(0, 0, null));
        expect(p.isIdle()).toBe(false);
    });
});

describe('getOverview() / toString() / getFamilyTree()', () => {
    test('getOverview summarizes identity plus single- and array-valued relationships as display strings', () => {
        const alice = makePerson('Alice');
        const dad = makePerson('Dad');
        const sib1 = makePerson('Sib1');
        const sib2 = makePerson('Sib2');

        alice.social.addRelationship(Relationships.Father, dad);
        alice.social.addRelationship(Relationships.Sibling, sib1);
        alice.social.addRelationship(Relationships.Sibling, sib2);

        const overview = alice.getOverview();

        expect(overview.firstName).toBe('Alice');
        expect(overview.familyName).toBe('Family');
        expect(overview.age).toBe(30);
        expect(overview.gender).toBe(Genders.Male);
        expect(overview.relationships[Relationships.Father]).toBe('Dad Family');
        expect(overview.relationships[Relationships.Sibling]).toBe('Sib1 Family, Sib2 Family');
    });

    test('toString returns the full name', () => {
        const alice = makePerson('Alice');
        expect(alice.toString()).toBe('Alice Family');
    });

    test('getFamilyTree walks relationships into nodes/links without looping forever on cyclic (spouse) relationships', () => {
        const alice = makePerson('Alice');
        const bob = makePerson('Bob');
        const child = makePerson('Child');

        alice.social.addRelationship(Relationships.Spouse, bob);
        bob.social.addRelationship(Relationships.Spouse, alice);
        alice.social.addRelationship(Relationships.Child, child);
        bob.social.addRelationship(Relationships.Child, child);

        const tree = alice.getFamilyTree();

        expect(tree.nodes).toEqual([{ name: 'Alice' }, { name: 'Bob' }, { name: 'Child' }]);
        expect(tree.links).toEqual([
            { source: 1, target: 0, label: Relationships.Spouse }, // bob -> alice, visited while alice recurses into bob
            { source: 1, target: 2, label: Relationships.Child },  // bob -> child
            { source: 0, target: 1, label: Relationships.Spouse }, // alice -> bob
            { source: 0, target: 2, label: Relationships.Child },  // alice -> child
        ]);
    });

    test('getFamilyTree on a person with no relationships is a single node with no links', () => {
        const solo = makePerson('Solo');
        expect(solo.getFamilyTree()).toEqual({ nodes: [{ name: 'Solo' }], links: [] });
    });
});

describe('target-reached helpers', () => {
    test('isCurrentTargetXReached/YReached are false with no current target', () => {
        const p = new Person(0, 0);
        expect(p.isCurrentTargetXReached()).toBe(false);
        expect(p.isCurrentTargetYReached()).toBe(false);
        expect(p.isCurrentTargetReached()).toBe(false);
    });

    test('X/Y reached compare within 1px of the target', () => {
        const p = new Person(10, 10);
        (p as any).currentTarget = { x: 10.5, y: 20 };
        expect(p.isCurrentTargetXReached()).toBe(true);
        expect(p.isCurrentTargetYReached()).toBe(false);
        expect(p.isCurrentTargetReached()).toBe(false);

        (p as any).currentTarget = { x: 10.5, y: 10.9 };
        expect(p.isCurrentTargetReached()).toBe(true);
    });

    test('isDestinationReached requires both an empty path and the target reached', () => {
        const p = new Person(10, 10);
        (p as any).currentTarget = { x: 10, y: 10 };
        (p as any).path = [new Road(0, 0, null)];
        expect(p.isDestinationReached()).toBe(false); // path not empty yet

        (p as any).path = [];
        expect(p.isDestinationReached()).toBe(true);
    });
});

describe('walk() guard clauses skip movement entirely', () => {
    const road = new Road(0, 0, 'road');

    test('does nothing while indoors', () => {
        const p = new Person(10, 10);
        p.setAsset({} as any);
        (p as any).currentTarget = { x: 50, y: 50 };
        (p as any).currentDestination = { row: 1, col: 1 };
        p.setIndoors(true);

        p.walk(road, 100);

        expect(p.getPosition()).toEqual({ x: 10, y: 10 });
    });

    test('does nothing without an asset', () => {
        const p = new Person(10, 10);
        (p as any).currentTarget = { x: 50, y: 50 };
        (p as any).currentDestination = { row: 1, col: 1 };

        p.walk(road, 100);

        expect(p.getPosition()).toEqual({ x: 10, y: 10 });
    });

    test('does nothing without a current target', () => {
        const p = new Person(10, 10);
        p.setAsset({} as any);
        (p as any).currentDestination = { row: 1, col: 1 };

        p.walk(road, 100);

        expect(p.getPosition()).toEqual({ x: 10, y: 10 });
    });

    test('does nothing without a current destination', () => {
        const p = new Person(10, 10);
        p.setAsset({} as any);
        (p as any).currentTarget = { x: 50, y: 50 };

        p.walk(road, 100);

        expect(p.getPosition()).toEqual({ x: 10, y: 10 });
    });
});

describe('walk(): real per-frame movement', () => {
    test('real per-frame movement drives a WalkingToDestination step past arrival to Arrived (no manual travelStep poking)', () => {
        // A walking commute (no vehicle): ExitingBuilding -> WalkingToDestination, then real per-frame walk()
        // movement alone must carry the step to Arrived. This is the regression guard: walk() clears its
        // target/destination the instant it arrives, so if processTravel re-queried isDestinationReached()
        // afterwards it would read the wiped state, never see arrival, and stall in WalkingToDestination.
        const currentTile = new Road(2, 2, 'road');
        const destRoad = new Road(3, 3, null);
        destRoad.calculateCurb({ width: 48, height: 48 }, { x: 168, y: 168 }); // curb corners near 148/188
        const destBuilding = new Building(5, 5, null);

        const gameStub = {
            pixelToTilePosition: () => ({ row: 3, col: 3 }),
            field: { getTile: () => destRoad, removeVehicle: () => undefined },
        } as unknown as GameManager;
        const pathFinder = { findPath: () => [destRoad] } as unknown as PathFinder;

        const p = new Person(0, 0);
        p.setGameManager(gameStub);
        p.setAsset({} as any);
        p.setDestination(destBuilding); // no vehicle -> walking commute

        p.update(currentTile, 0, new Set(), pathFinder); // ExitingBuilding -> WalkingToDestination
        expect((p as any).travelStep).toBe(TravelStep.WalkingToDestination);
        expect((p as any).currentTarget).not.toBeNull();
        const target = { ...(p as any).currentTarget };

        // Drive real movement only — no manual travelStep assignment — until the step advances or we time out.
        let iterations = 0;
        while ((p as any).travelStep === TravelStep.WalkingToDestination && iterations < 2000) {
            p.update(currentTile, 50, new Set(), pathFinder);
            iterations++;
        }

        // The observable win: arrival detected during real walk() movement actually advanced the travel step.
        expect(iterations).toBeLessThan(2000); // advanced, not stalled/timed out
        expect((p as any).travelStep).toBe(TravelStep.Arrived);
        // And it genuinely walked onto the target curb (within the < 1px "reached" threshold) to get there.
        const finalPosition = p.getPosition()!;
        expect(Math.abs(finalPosition.x - target.x)).toBeLessThan(1);
        expect(Math.abs(finalPosition.y - target.y)).toBeLessThan(1);
        expect(p.getDepth()).toBe((currentTile.getRow() + 1) * 10 + 1);
    });

    // Regression (task-008 integration suite): stepping out of the commute car parked at the DESTINATION's
    // own entrance means start tile == goal tile, so A* rightly returns an empty path — but with no
    // currentTarget, walk() could neither move nor detect arrival, and the traveller froze one step from
    // the door forever. setDestinationTile now targets the current position when the traveller is already
    // standing on the destination structure, so the next walk() reports arrival.
    test('completes a walk whose destination is the structure the person is already standing on', () => {
        const destBuilding = new Building(4, 4, null); // the person stands on this very building
        destBuilding.calculateEntrance({ width: 48, height: 48 }, { x: 216, y: 216 }); // entrance (216, 235)
        const gameStub = {
            pixelToTilePosition: () => ({ row: 4, col: 4 }),
            field: { getTile: () => destBuilding, removeVehicle: () => undefined },
        } as unknown as GameManager;
        // The REAL pathfinder contract for start == goal: an empty path.
        const pathFinder = { findPath: () => [] } as unknown as PathFinder;

        const p = new Person(168, 168);
        p.setGameManager(gameStub);
        p.setAsset({} as any);
        p.setDestination(destBuilding); // no vehicle -> walking commute straight to the destination

        p.update(destBuilding, 0, new Set(), pathFinder); // ExitingBuilding -> WalkingToDestination
        expect((p as any).travelStep).toBe(TravelStep.WalkingToDestination);

        let iterations = 0;
        while ((p as any).travelStep === TravelStep.WalkingToDestination && iterations < 2000) {
            p.update(destBuilding, 50, new Set(), pathFinder);
            iterations++;
        }

        expect(iterations).toBeLessThan(2000); // advanced, not stalled
        expect((p as any).travelStep).toBe(TravelStep.Arrived);
        // The last leg is genuinely walked: the person ends at the building's ENTRANCE (within the < 1px
        // arrival threshold), keeping their position coherent for the return commute.
        const finalPosition = p.getPosition()!;
        const entrance = destBuilding.getEntrance()!;
        expect(Math.abs(finalPosition.x - entrance.x)).toBeLessThan(1);
        expect(Math.abs(finalPosition.y - entrance.y)).toBeLessThan(1);
    });

    test('real per-frame movement drives a WalkingToCar step past arrival to EnteringCar (no manual travelStep poking)', () => {
        // Same regression guard on the vehicle commute path: WalkingToCar must advance to EnteringCar off real
        // walk() movement alone.
        const homeTile = new Road(2, 2, 'road');
        const vehicleRoad = new Road(3, 3, null);
        vehicleRoad.calculateCurb({ width: 48, height: 48 }, { x: 168, y: 168 });
        const vehicle = new Vehicle(168, 168);
        const destBuilding = new Building(5, 5, null);

        const gameStub = {
            pixelToTilePosition: () => ({ row: 3, col: 3 }),
            field: { getTile: () => vehicleRoad, removeVehicle: () => undefined },
        } as unknown as GameManager;
        const pathFinder = { findPath: () => [vehicleRoad] } as unknown as PathFinder;

        const p = new Person(0, 0);
        p.setGameManager(gameStub);
        p.setVehicle(vehicle);
        p.setAsset({} as any);
        p.setDestination(destBuilding);

        p.update(homeTile, 0, new Set(), pathFinder); // ExitingBuilding -> WalkingToCar
        expect((p as any).travelStep).toBe(TravelStep.WalkingToCar);

        let iterations = 0;
        while ((p as any).travelStep === TravelStep.WalkingToCar && iterations < 2000) {
            p.update(homeTile, 50, new Set(), pathFinder);
            iterations++;
        }

        expect(iterations).toBeLessThan(2000); // advanced, not stalled
        expect((p as any).travelStep).toBe(TravelStep.EnteringCar);
    });

    test('moves along X first, then Y, when the target is diagonal (matches the constructor default Axis.X)', () => {
        const road = new Road(0, 0, 'road');
        const p = new Person(0, 0);
        p.setAsset({} as any);
        (p as any).currentTarget = { x: 100, y: 100 };
        (p as any).currentDestination = { row: 9, col: 9 };
        (p as any).path = [];

        p.walk(road, 10); // speed 0.02 * 10 = 0.2 movement this tick

        expect((p as any).x).toBeCloseTo(0.2);
        expect((p as any).y).toBe(0); // Y axis untouched until X is reached
        expect(p.getDirection()).toBe(Direction.East);
    });
});

describe('setNextTarget()', () => {
    test('does nothing with an empty path', () => {
        const p = new Person(0, 0);
        (p as any).path = [];
        p.setNextTarget(new Road(0, 0, 'r'));
        expect((p as any).currentTarget).toBeNull();
    });

    test('targets a building entrance when the next path tile is a Building', () => {
        const building = new Building(2, 2, null);
        building.calculateEntrance({ width: 48, height: 48 }, { x: 100, y: 100 });
        const p = new Person(0, 0);
        (p as any).path = [building];

        p.setNextTarget(new Road(0, 0, 'r'));

        expect((p as any).currentTarget).toEqual(building.getEntrance());
    });

    test('targets the closest road curb when the next path tile is a Road', () => {
        const road = new Road(1, 1, null);
        road.calculateCurb({ width: 48, height: 48 }, { x: 100, y: 100 });
        const p = new Person(4, 4);
        (p as any).path = [road];

        p.setNextTarget(new Road(0, 0, 'r'));

        expect((p as any).currentTarget).toEqual(road.getClosestCurbPoint({ x: 4, y: 4 }));
    });

    test('warns and stops when the next tile is neither a Building nor a Road', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const soil = new Soil(0, 0, 'grass');
        const p = new Person(0, 0);
        (p as any).path = [soil];

        p.setNextTarget(new Road(0, 0, 'r'));

        expect((p as any).currentTarget).toBeNull();
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    test('warns and stops when the next Road tile has no curb computed yet', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const bareRoad = new Road(1, 1, null); // calculateCurb() never called
        const p = new Person(0, 0);
        (p as any).path = [bareRoad];

        p.setNextTarget(new Road(0, 0, 'r'));

        expect((p as any).currentTarget).toBeNull();
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});

describe('setDestinationTile()', () => {
    test('does nothing when destination is null', () => {
        const p = new Person(0, 0);
        const pathFinder = { findPath: jest.fn() } as unknown as PathFinder;

        p.setDestinationTile(new Road(0, 0, 'r'), null, pathFinder);

        expect((p as any).currentDestination).toBeNull();
        expect(pathFinder.findPath).not.toHaveBeenCalled();
    });

    test('sets currentDestination and the first target when the pathfinder returns a path', () => {
        const road = new Road(0, 1, null);
        road.calculateCurb({ width: 48, height: 48 }, { x: 72, y: 24 });
        const p = new Person(0, 0);
        const pathFinder = { findPath: () => [road] } as unknown as PathFinder;

        p.setDestinationTile(new Road(0, 0, 'r'), { row: 0, col: 1 }, pathFinder);

        expect((p as any).currentDestination).toEqual({ row: 0, col: 1 });
        expect((p as any).currentTarget).toEqual(road.getClosestCurbPoint({ x: 0, y: 0 }));
    });

    test('sets currentDestination but leaves the target untouched when the pathfinder returns no path', () => {
        const p = new Person(0, 0);
        const pathFinder = { findPath: () => [] } as unknown as PathFinder;

        p.setDestinationTile(new Road(0, 0, 'r'), { row: 5, col: 5 }, pathFinder);

        expect((p as any).currentDestination).toEqual({ row: 5, col: 5 });
        expect((p as any).currentTarget).toBeNull();
    });
});

describe('updateDestination() — debug wander destination pick', () => {
    test('does nothing when a destination is already set', () => {
        const p = new Person(0, 0);
        (p as any).currentDestination = { row: 9, col: 9 };
        const pathFinder = { findPath: jest.fn() } as unknown as PathFinder;

        p.updateDestination(new Road(0, 0, 'r'), new Set(['1-1']), pathFinder);

        expect((p as any).currentDestination).toEqual({ row: 9, col: 9 });
        expect(pathFinder.findPath).not.toHaveBeenCalled();
    });

    test('does nothing when there are no destinations to pick from', () => {
        const p = new Person(0, 0);
        const pathFinder = { findPath: jest.fn() } as unknown as PathFinder;

        p.updateDestination(new Road(0, 0, 'r'), new Set(), pathFinder);

        expect((p as any).currentDestination).toBeNull();
        expect(pathFinder.findPath).not.toHaveBeenCalled();
    });

    test('a destination on row/col 0 is silently skipped (0 is falsy in the guard check)', () => {
        const p = new Person(0, 0);
        const pathFinder = { findPath: jest.fn() } as unknown as PathFinder;

        p.updateDestination(new Road(0, 0, 'r'), new Set(['0-3']), pathFinder);

        expect((p as any).currentDestination).toBeNull();
        expect(pathFinder.findPath).not.toHaveBeenCalled();
    });

    test('picks a destination, computes a path and sets the first target', () => {
        const road = new Road(0, 0, 'r');
        road.calculateCurb({ width: 48, height: 48 }, { x: 24, y: 24 });
        const p = new Person(0, 0);
        const pathFinder = { findPath: () => [road] } as unknown as PathFinder;

        p.updateDestination(road, new Set(['5-5']), pathFinder);

        expect((p as any).currentDestination).toEqual({ row: 5, col: 5 });
        expect((p as any).currentTarget).not.toBeNull();
    });
});

describe('processTravel() edge cases (via update()/direct cast)', () => {
    function gameStub(road: Road): GameManager {
        return {
            pixelToTilePosition: () => ({ row: 0, col: 0 }),
            field: { getTile: () => road, removeVehicle: () => undefined },
        } as unknown as GameManager;
    }

    test('is a no-op when called directly with no destinationBuilding set', () => {
        const road = new Road(0, 0, 'road');
        const p = new Person(0, 0);
        p.setGameManager(gameStub(road));
        const pathFinder = { findPath: () => [] } as unknown as PathFinder;

        expect(() => (p as any).processTravel(road, 0, pathFinder)).not.toThrow();
        expect((p as any).travelStep).toBe(TravelStep.Idle);
    });

    test('an unknown travelStep hits the default branch and changes nothing', () => {
        const road = new Road(0, 0, 'road');
        const destBuilding = new Building(2, 2, null);
        const p = new Person(0, 0);
        p.setGameManager(gameStub(road));
        p.setDestination(destBuilding);
        (p as any).travelStep = 'bogus-step';
        const pathFinder = { findPath: () => [] } as unknown as PathFinder;

        expect(() => p.update(road, 0, new Set(), pathFinder)).not.toThrow();
        expect((p as any).travelStep).toBe('bogus-step');
    });

    test('ExitingBuilding without a vehicle goes straight to WalkingToDestination (the walking/minor commute)', () => {
        const road = new Road(0, 0, 'road');
        const destBuilding = new Building(2, 2, null);
        const p = new Person(0, 0);
        p.setGameManager(gameStub(road));
        p.setDestination(destBuilding); // no setVehicle() call
        p.setAsset({} as any);

        expect((p as any).travelStep).toBe(TravelStep.ExitingBuilding);

        p.update(road, 0, new Set(), { findPath: () => [] } as unknown as PathFinder);

        expect((p as any).travelStep).toBe(TravelStep.WalkingToDestination);
        expect(p.isIndoors()).toBe(false);
        expect(p.getVehicle()).toBeNull();
    });
});

describe('update() dispatch when idle (no destinationBuilding)', () => {
    test('walks in place and does not wander when wander is disabled', () => {
        const road = new Road(0, 0, 'road');
        const p = new Person(0, 0);
        const pathFinder = { findPath: () => [road] } as unknown as PathFinder;

        p.update(road, 16, new Set(['5-5']), pathFinder);

        expect((p as any).currentDestination).toBeNull();
    });

    test('picks a wander destination when wander is enabled', () => {
        const road = new Road(0, 0, 'road');
        road.calculateCurb({ width: 48, height: 48 }, { x: 24, y: 24 });
        const p = new Person(0, 0);
        p.enableWander();
        const pathFinder = { findPath: () => [road] } as unknown as PathFinder;

        p.update(road, 16, new Set(['5-5']), pathFinder);

        expect((p as any).currentDestination).toEqual({ row: 5, col: 5 });
    });
});

describe('processTravel(): WalkingToCar / WalkingToDestination case bodies invoke real walk()', () => {
    test('WalkingToCar calls walk() toward the assigned vehicle', () => {
        const homeTile = new Road(0, 0, 'road');
        const vehicleRoad = new Road(1, 1, null);
        vehicleRoad.calculateCurb({ width: 48, height: 48 }, { x: 72, y: 72 });
        const vehicle = new Vehicle(72, 72);
        const destBuilding = new Building(5, 5, null);

        const gameStub = {
            pixelToTilePosition: () => ({ row: 1, col: 1 }),
            field: { getTile: () => vehicleRoad, removeVehicle: () => undefined },
        } as unknown as GameManager;
        const pathFinder = { findPath: () => [vehicleRoad] } as unknown as PathFinder;

        const person = new Person(0, 0);
        person.setGameManager(gameStub);
        person.setVehicle(vehicle);
        person.setAsset({} as any);
        person.setDestination(destBuilding);

        person.update(homeTile, 0, new Set(), pathFinder); // ExitingBuilding -> WalkingToCar
        expect((person as any).travelStep).toBe(TravelStep.WalkingToCar);
        expect((person as any).currentTarget).not.toBeNull();

        // Executes the WalkingToCar case body (a real walk() call plus the arrival check) without throwing.
        expect(() => person.update(homeTile, 50, new Set(), pathFinder)).not.toThrow();
    });

    test('WalkingToDestination calls walk() toward the destination building (walking commute, no vehicle)', () => {
        const currentTile = new Road(0, 0, 'road');
        const destRoad = new Road(1, 1, null);
        destRoad.calculateCurb({ width: 48, height: 48 }, { x: 72, y: 72 });
        const destBuilding = new Building(5, 5, null);

        const gameStub = {
            pixelToTilePosition: () => ({ row: 1, col: 1 }),
            field: { getTile: () => destRoad, removeVehicle: () => undefined },
        } as unknown as GameManager;
        const pathFinder = { findPath: () => [destRoad] } as unknown as PathFinder;

        const person = new Person(0, 0);
        person.setGameManager(gameStub);
        person.setAsset({} as any);
        person.setDestination(destBuilding); // no setVehicle() -> walking commute

        person.update(currentTile, 0, new Set(), pathFinder); // ExitingBuilding -> WalkingToDestination
        expect((person as any).travelStep).toBe(TravelStep.WalkingToDestination);
        expect((person as any).currentTarget).not.toBeNull();

        // Executes the WalkingToDestination case body (a real walk() call plus the arrival check).
        expect(() => person.update(currentTile, 50, new Set(), pathFinder)).not.toThrow();
    });
});
