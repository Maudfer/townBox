import GameManager from 'game/GameManager';
import PathFinder from 'game/agents/PathFinder';
import Vehicle from 'game/agents/Vehicle';
import SocialLife from 'game/population/SocialLife';
import WorkLife from 'game/population/WorkLife';
import Building from 'game/world/Building';
import Road from 'game/world/Road';
import Tile from 'game/world/Tile';
import { FamilyTree, Node, Link } from 'types/FamilyTree';
import { Direction, Axis } from 'types/Movement';
import { Image } from 'types/Phaser';
import { TilePosition, PixelPosition } from 'types/Position';
import { Gender, RelationshipMap, PersonOverview, RelationshipMapOverview } from 'types/Social';
import { TravelStep } from 'types/Travel';

let Game: GameManager;

export default class Person {
    public social: SocialLife;
    public work: WorkLife;

    private x: number;
    private y: number;

    private depth: number;
    private speed: number;

    private currentTarget: PixelPosition | null;
    private direction: Direction;
    private movingAxis: Axis;
    private insideBuilding: boolean;

    private vehicle: Vehicle | null;
    private destinationBuilding: Building | null;
    // The building the person is currently in/at (home or workplace). Null is treated as "at home". Set on
    // arrival; drives the commute scheduler's home<->work decisions (task 006).
    private currentBuilding: Building | null;
    private travelStep: TravelStep;

    private path: Tile[];
    private currentDestination: TilePosition;

    // Free-roaming flag: only debug-spawned test people wander to random buildings. Materialized residents
    // never wander — they move only with purpose (the commute, task 006). Off by default (task 016).
    private wander: boolean;

    private asset: Image;
    private redrawFunction: ((timeDelta: number) => void) | null;

    constructor(x: number, y: number) {
        this.social = new SocialLife();
        this.work = new WorkLife();

        this.x = x;
        this.y = y;

        this.depth = 0;
        this.speed = 0.02;

        this.currentTarget = null;
        this.direction = Direction.East;
        this.movingAxis = Axis.X;
        this.insideBuilding = false;
        this.vehicle = null;
        this.destinationBuilding = null;
        this.currentBuilding = null;
        this.travelStep = TravelStep.Idle;

        this.path = [];
        this.currentDestination = null;
        this.wander = false;
        this.asset = null;

        this.redrawFunction = null;
    }

    // Marks this person as a free-roaming test entity (debug spawns only). Residents are never wanderers.
    enableWander(): void {
        this.wander = true;
    }

    setGameManager(gameManager: GameManager): void {
        Game = gameManager;
    }

    setVehicle(vehicle: Vehicle): void {
        // A live link never gets silently overwritten (W8 / proposal simulation-aliveness-3 P0-2.1): the
        // audit found 148 orphaned commute cars in a month — every mid-flight re-plan minted one. The old
        // car is properly despawned (occupant cleared so no phantom driver) before the new link lands.
        if (this.vehicle && this.vehicle !== vehicle) {
            if (this.vehicle.isOccupied()) {
                this.vehicle.disembark();
            }
            this.vehicle.setControlled(false);
            Game.field?.removeVehicle(this.vehicle);
        }
        this.vehicle = vehicle;
    }

    getVehicle(): Vehicle | null {
        return this.vehicle;
    }

    // Coherent travel abort (W8 / P0-2.3): called when the intent driving this trip dies (transition
    // cancelled, instance interrupted). The body stops WHERE IT IS instead of finishing a stale trip into
    // a building nobody asked for; a boarded person steps out at the car's position; the car despawns.
    abortTravel(): void {
        if (this.travelStep === TravelStep.Idle) {
            return;
        }
        if (this.vehicle) {
            // Boarded (EnteringCar → Driving): the person is "inside" the car — step out where it stands.
            if (this.vehicle.isOccupied()) {
                const carPosition = this.vehicle.getPosition();
                if (carPosition) {
                    this.x = carPosition.x;
                    this.y = carPosition.y;
                }
                this.vehicle.disembark();
                this.setIndoors(false);
            }
            this.vehicle.setControlled(false);
            Game.field?.removeVehicle(this.vehicle);
            this.vehicle = null;
        }
        this.destinationBuilding = null;
        this.path = [];
        this.currentDestination = null;
        this.travelStep = TravelStep.Idle;
    }

    setDirection(direction: Direction): void {
        this.direction = direction;
    }

    setDestination(building: Building): void {
        this.destinationBuilding = building;
        this.travelStep = TravelStep.ExitingBuilding;
    }

    getCurrentBuilding(): Building | null {
        return this.currentBuilding;
    }

    // The current travel-state-machine step. Read by the integration test harness (task 008) to assert commute
    // progression (ExitingBuilding → WalkingToCar → … → Arrived) without reaching into private state.
    getTravelStep(): TravelStep {
        return this.travelStep;
    }

    setCurrentBuilding(building: Building | null): void {
        this.currentBuilding = building;
    }

    // Not currently on a commute (available to be dispatched home/to work).
    isIdle(): boolean {
        return this.travelStep === TravelStep.Idle && this.destinationBuilding === null;
    }

    setupCitizenship(firstName: string, familyName: string, age: number, gender: Gender): void {
        this.social.setFirstName(firstName);
        this.social.setFamilyName(familyName);
        this.social.setAge(age);
        this.social.setGender(gender);
    }

    // Moves the person one axis-step toward the current target. Returns true ONLY on the frame it detects
    // final arrival at the destination (path exhausted + target reached). Callers must observe arrival through
    // this return value: walk() clears currentTarget/currentDestination the instant it arrives, so a caller
    // re-querying isDestinationReached() afterwards would read the already-wiped state and see a false negative
    // (the bug that stalled the WalkingToCar/WalkingToDestination travel steps).
    walk(currentTile: Tile, timeDelta: number): boolean {
        if (this.insideBuilding || !this.asset || !this.currentTarget || !this.currentDestination /*|| !(currentTile instanceof Road)*/) {
            return false;
        }

        const speedX = this.speed * Math.sign(this.currentTarget.x - this.x) * timeDelta;
        const speedY = this.speed * Math.sign(this.currentTarget.y - this.y) * timeDelta;

        const potentialX = this.x + speedX;
        const potentialY = this.y + speedY;

        if (this.movingAxis === Axis.X) {
            this.x = potentialX;
            this.direction = speedX > 0 ? Direction.East : Direction.West;
            if (this.isCurrentTargetXReached() && !this.isCurrentTargetYReached()) {
                this.movingAxis = Axis.Y;
            }
        } else if (this.movingAxis === Axis.Y) {
            this.y = potentialY;
            this.direction = speedY > 0 ? Direction.South : Direction.North;
            if (this.isCurrentTargetYReached() && !this.isCurrentTargetXReached()) {
                this.movingAxis = Axis.X;
            }
        }

        this.updateDepth(currentTile);

        if (this.isDestinationReached()) {
            this.currentTarget = null;
            this.currentDestination = null;
            return true;
        }

        if (this.isCurrentTargetReached()) {
            this.setNextTarget(currentTile);
            return false;
        }

        return false;
    }

    setNextTarget(currentTile: Tile): void {
        if (!this.path.length || !currentTile) {
            return;
        }

        const currentTilePosition = currentTile.getPosition();
        if (!currentTilePosition) {
            console.warn(`[Person] Can't set next target, current position not valid`, currentTilePosition);
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
        if (!(nextTile instanceof Road)){
            console.warn(`[Person] Next tile is not a road`, nextTile);
            return;
        }
         
        const nextTilePosition = nextTile.getPosition();
        const curbs = nextTile.getCurb();
        if (!nextTilePosition || !curbs) {
            console.warn(`[Person] Could not determine next tile position or curbs`, nextTile, curbs);
            return;
        }

        // Determine which curb Point is going to be the next target
        const currentPixelPosition = { x: this.x, y: this.y };
        this.currentTarget = nextTile.getClosestCurbPoint(currentPixelPosition);
    }

    updateDestination(currentTile: Tile, destinations: Set<string>, pathFinder: PathFinder): void {
        if (this.currentDestination) {
            return;
        }

        if (!destinations.size) {
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
        if (!destination) {
            return;
        }

        this.currentDestination = destination;

        const currentTilePosition = {
            row: currentTile.getRow(),
            col: currentTile.getCol()
        };

        this.path = pathFinder.findPath(currentTilePosition, this.currentDestination);
        if (this.path?.length) {
            this.setNextTarget(currentTile);
            return;
        }

        // Already there: the destination is the structure we are standing on (e.g. stepping out of the
        // commute car parked at the destination's own entrance — start tile == goal tile, so A* rightly
        // returns an empty path). Without a currentTarget, walk() can neither move nor detect arrival and
        // the travel step stalls forever (found by the task-008 integration suite). Target the building's
        // entrance — walking the real last leg keeps the person's position coherent for the NEXT commute
        // (the return trip starts from these pixels) — falling back to where we stand.
        if (currentTile.getIdentifier() === `${destination.row}-${destination.col}`) {
            const entrance = currentTile instanceof Building ? currentTile.getEntrance() : null;
            this.currentTarget = entrance ?? { x: this.x, y: this.y };
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

    isDestinationReached(): boolean {
        return !this.path.length && this.isCurrentTargetReached();
    }

    private processTravel(currentTile: Tile, timeDelta: number, pathFinder: PathFinder): void {
        if (!this.destinationBuilding) {
            return;
        }

        switch (this.travelStep) {
            case TravelStep.ExitingBuilding:
                this.setIndoors(false);
                // Leaving means LEFT (W8): keeping the stale reference made LiveWorld's immediate-arrival
                // check (`currentBuilding === destination`) treat a person mid-street as already back home
                // — an instant false arrival for any return trip requested while walking.
                this.currentBuilding = null;
                this.currentDestination = null;
                if (this.vehicle) {
                    const vehiclePos = this.vehicle.getPosition();
                    const vehicleTile = Game.pixelToTilePosition(vehiclePos);
                    if (vehicleTile) {
                        this.setDestinationTile(currentTile, vehicleTile, pathFinder);
                    }
                    this.travelStep = TravelStep.WalkingToCar;
                } else {
                    // Walking commute (task 058): no car — path straight to the destination on foot over the
                    // pedestrian network (curbs/crosswalks). Minors commute this way (children don't drive).
                    const destTile = this.destinationBuilding.getPosition();
                    if (destTile) {
                        this.setDestinationTile(currentTile, destTile, pathFinder);
                    }
                    this.travelStep = TravelStep.WalkingToDestination;
                }
                break;
            case TravelStep.WalkingToCar:
                // walk() reports arrival directly: re-querying isDestinationReached() here would read the
                // state walk() just cleared on arrival and stall this step forever (the arrival false-negative).
                if (this.walk(currentTile, timeDelta)) {
                    this.travelStep = TravelStep.EnteringCar;
                }
                break;
            case TravelStep.EnteringCar:
                // The person boards: their sprite vanishes into the car (task 008 commute spec), the car gains
                // its occupant (drive() refuses to move an empty car), and the car is routed to the STREET in
                // front of the destination — cars stop on the road, never inside a footprint (anchor fallback
                // for legacy/test worlds with no adjacent road).
                if (this.vehicle) {
                    this.vehicle.board();
                    this.setIndoors(true);
                    const vehicleTile = Game.pixelToTilePosition(this.vehicle.getPosition());
                    const destTile = Game.field?.getAdjacentRoadTile(this.destinationBuilding)
                        ?? this.destinationBuilding.getPosition();
                    if (vehicleTile && destTile) {
                        const tile = Game.field!.getTile(vehicleTile.row, vehicleTile.col);
                        if (tile) {
                            this.vehicle.setDestinationTile(tile, destTile, pathFinder);
                        }
                    }
                }
                this.travelStep = TravelStep.Driving;
                break;
            case TravelStep.Driving:
                if (this.vehicle && this.vehicle.isDestinationReached()) {
                    this.travelStep = TravelStep.ExitingCar;
                }
                break;
            case TravelStep.ExitingCar:
                // The person steps out where the car parked (task 008 commute spec): position syncs to the
                // car, the sprite reappears, the car loses its occupant (an empty parked car can't move), and
                // the last leg to the destination entrance is walked from the street.
                if (this.vehicle) {
                    const carPosition = this.vehicle.getPosition();
                    if (carPosition) {
                        this.x = carPosition.x;
                        this.y = carPosition.y;
                    }
                    this.vehicle.disembark();
                    this.setIndoors(false);
                    const carTilePos = Game.pixelToTilePosition(this.vehicle.getPosition());
                    if (carTilePos) {
                        const tile = Game.field!.getTile(carTilePos.row, carTilePos.col);
                        if (tile) {
                            const destTile = this.destinationBuilding.getPosition();
                            this.setDestinationTile(tile, destTile, pathFinder);
                        }
                    }
                }
                this.travelStep = TravelStep.WalkingToDestination;
                break;
            case TravelStep.WalkingToDestination:
                // Same arrival contract as WalkingToCar: trust walk()'s return, not a post-hoc
                // isDestinationReached() read of the state it wiped on arrival.
                if (this.walk(currentTile, timeDelta)) {
                    this.travelStep = TravelStep.Arrived;
                }
                break;
            case TravelStep.Arrived:
                this.setIndoors(true);
                // Record where we now are (home or workplace) for the commute scheduler.
                this.currentBuilding = this.destinationBuilding;
                // Park-and-despawn the commute car: drop it from the field and clear the link so no sprite or
                // update entry leaks.
                if (this.vehicle) {
                    Game.field?.removeVehicle(this.vehicle);
                    this.vehicle.setControlled(false);
                    this.vehicle = null;
                }
                this.destinationBuilding = null;
                this.travelStep = TravelStep.Idle;
                break;
            default:
                break;
        }
    }

    // Ambulatory (task 093 / E1): while the person's active continuous action is authored `ambulatory`
    // (a walk, a jog), they visibly roam the street network — the wander machinery, temporarily. Transient
    // (derived each in-game minute from the Brain status by City); never serialized.
    private ambulatory = false;

    setAmbulatory(ambulatory: boolean): void {
        this.ambulatory = ambulatory;
    }

    isAmbulatory(): boolean {
        return this.ambulatory;
    }

    update(currentTile: Tile, timeDelta: number, destinations: Set<string>, pathFinder: PathFinder): void {
        if (this.destinationBuilding) {
            this.processTravel(currentTile, timeDelta, pathFinder);
        } else {
            this.walk(currentTile, timeDelta);
            // Debug test people wander; residents stay put until dispatched (commute, task 006) — unless
            // their current activity is ambulatory (task 093): joggers jog, strollers stroll, visibly.
            if (this.wander || this.ambulatory) {
                this.updateDestination(currentTile, destinations, pathFinder);
            }
        }
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

    getPixelPosition(): { x: number; y: number } {
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
        // The spawn/despawn race (W8 / P0-2.2): sprite attachment rides an async bus handler, so a
        // same-tick removal can run BEFORE the sprite exists — destroy() hits null and the sprite lands
        // afterwards as a ghost in no list. A removed entity destroys any late-arriving sprite on contact.
        if (this.removedFromField) {
            asset?.destroy();
            return;
        }
        this.asset = asset;
    }

    // Marks this person as removed from the field (Field.removePerson): any sprite attached after this
    // point self-destroys instead of ghosting.
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

    setIndoors(insideBuilding: boolean): void {
        this.insideBuilding = insideBuilding;
    }

    isIndoors(): boolean {
        return this.insideBuilding;
    }

    redraw(timeDelta: number): void {
        if (this.redrawFunction) {
            this.redrawFunction(timeDelta);
        }
    }

    getFamilyTree(): FamilyTree {
        const nodes: Node[] = [];
        const links: Link[] = [];
        const personIndexMap = new Map<Person, number>();
    
        function processPerson(p: Person) {
            if (personIndexMap.has(p)) {
                return;
            }
    
            const index = nodes.length;
            personIndexMap.set(p, index);
    
            const name = p.social.getInfo().firstName;
            nodes.push({ name });
    
            const relationships = p.social.getInfo().relationships;
    
            for (const key of Object.keys(relationships) as Array<keyof RelationshipMap>) {
                const relationship = relationships[key];
    
                if (!relationship) {
                    continue;
                }
    
                if (Array.isArray(relationship)) {
                    for (const relatedPerson of relationship) {
                        processPerson(relatedPerson);
    
                        const sourceIndex = index;
                        const targetIndex = personIndexMap.get(relatedPerson)!;
                        links.push({
                            source: sourceIndex,
                            target: targetIndex,
                            label: key,
                        });
                    }
                } else {
                    processPerson(relationship);
    
                    const sourceIndex = index;
                    const targetIndex = personIndexMap.get(relationship)!;
                    links.push({
                        source: sourceIndex,
                        target: targetIndex,
                        label: key,
                    });
                }
            }
        }
    
        processPerson(this);
        return { nodes, links };
    }

    getOverview(): PersonOverview {
        const socialInfo = this.social.getInfo();

        const relationshipMapOverview: RelationshipMapOverview = {};
        
        for (const key in socialInfo.relationships) {
            const relationship = key as keyof RelationshipMap;
            const relatedPeople = socialInfo.relationships[relationship];

            if (!relatedPeople) {
                continue;
            }
    
            // For relationships which accept array values such as children and sbiling, we create an array overview
            if (Array.isArray(relatedPeople)) {
                relationshipMapOverview[relationship] = relatedPeople.map(person => person.social.getFullName()).join(', ');
            } else{
                relationshipMapOverview[relationship] = relatedPeople.social.getFullName();
            }
        }

        const overview: PersonOverview = {
            firstName: socialInfo.firstName,
            familyName: socialInfo.familyName,
            age: socialInfo.age,
            gender: socialInfo.gender,
            relationships: relationshipMapOverview,
        };

        return overview;
    }

    toString(): string {
        return this.social.getFullName();
    }
}