import Person from '../src/app/game/Person';
import Vehicle from '../src/app/game/Vehicle';
import Building from '../src/app/game/Building';
import Road from '../src/app/game/Road';
import { TravelStep } from '../src/types/Travel';
import GameManager from '../src/app/game/GameManager';
import PathFinder from '../src/app/game/PathFinder';

describe('Person travel flow', () => {
  test('state machine advances', () => {
    const road = new Road(0, 0, 'road');
    const destBuilding = new Building(2, 2, null);
    const vehicle = new Vehicle(1, 1);

    const gameStub = {
      pixelToTilePosition: () => ({ row: 0, col: 0 }),
      field: { getTile: () => road },
      gridParams: { cells: { width: 1, height:1 }, bounds: {top:0,left:0,right:10,bottom:10} }
    } as unknown as GameManager;

    const pathFinder = { findPath: () => [] } as unknown as PathFinder;

    const person = new Person(0, 0);
    person.setGameManager(gameStub);
    person.setVehicle(vehicle);
    person.setDestination(destBuilding);
    person.setAsset({} as any);

    // Initial step should be exiting building
    expect((person as any).travelStep).toBe(TravelStep.ExitingBuilding);

    person.update(road, 0, new Set(), pathFinder);
    expect((person as any).travelStep).toBe(TravelStep.WalkingToCar);
    expect(person.isIndoors()).toBe(false);

    // Simulate arrival at car
    (person as any).travelStep = TravelStep.EnteringCar;
    person.update(road, 0, new Set(), pathFinder);
    expect((person as any).travelStep).toBe(TravelStep.Driving);

    // Simulate vehicle arrival
    (vehicle as any).isDestinationReached = () => true;
    person.update(road, 0, new Set(), pathFinder);
    expect((person as any).travelStep).toBe(TravelStep.ExitingCar);
  });

  test('arrival records the building, despawns the commute car, and returns to idle', () => {
    const road = new Road(0, 0, 'road');
    const destBuilding = new Building(2, 2, null);
    const vehicle = new Vehicle(1, 1);
    vehicle.setControlled(true);

    const removed: Vehicle[] = [];
    const gameStub = {
      pixelToTilePosition: () => ({ row: 0, col: 0 }),
      field: { getTile: () => road, removeVehicle: (v: Vehicle) => removed.push(v) },
      gridParams: { cells: { width: 1, height: 1 }, bounds: { top: 0, left: 0, right: 10, bottom: 10 } },
    } as unknown as GameManager;
    const pathFinder = { findPath: () => [] } as unknown as PathFinder;

    const person = new Person(0, 0);
    person.setGameManager(gameStub);
    person.setVehicle(vehicle);
    person.setDestination(destBuilding);
    person.setAsset({} as any);

    // Jump to the final step and run it.
    (person as any).travelStep = TravelStep.Arrived;
    person.update(road, 0, new Set(), pathFinder);

    expect(person.isIndoors()).toBe(true);
    expect(person.getCurrentBuilding()).toBe(destBuilding);
    expect(removed).toContain(vehicle); // car despawned from the field
    expect(person.getVehicle()).toBeNull();
    expect(person.isIdle()).toBe(true);
  });
});
