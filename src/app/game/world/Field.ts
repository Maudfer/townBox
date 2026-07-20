import GameManager from 'game/GameManager';
import PathFinder from 'game/agents/PathFinder';
import Person from 'game/agents/Person';
import Vehicle from 'game/agents/Vehicle';
import Building from 'game/world/Building';
import House from 'game/world/House';
import Road from 'game/world/Road';
import Soil from 'game/world/Soil';
import Tile from 'game/world/Tile';
import Workplace from 'game/world/Workplace';
import { Tool } from 'types/Cursor';
import { UpdateEvent, BuildEvent } from 'types/Events';
import { NeighborMap } from 'types/Neighbor';
import { PixelPosition, TilePosition } from 'types/Position';

type TileMatrix = {
    [row: number]: {
        [col: number]: Tile;
    };
};

type PlacementResult = {
    position: TilePosition;
    valid: boolean;
};

// How far (in tiles) the cursor may sit from a valid road-side placement and still soft-snap to it. Beyond this
// the building placement is considered invalid.
// Much softer building snap (W9 / proposal simulation-aliveness-3): a candidate only captures the cursor
// when it sits within the closest HALF of an adjacent tile (≤ 1.5 tiles) — the old 4-tile radius yanked
// previews to spots the player never pointed at. Loop bounds stay at 2; the Euclidean gate below enforces
// the 1.5-tile capture distance.
const BUILDING_SNAP_RADIUS_TILES = 2;
const BUILDING_SNAP_CAPTURE_TILES = 1.5;

// How close (in world pixels) the Select cursor must be to a person sprite to pick it (task 026).
const SELECT_RADIUS_PX = 12;

// Gathering-venue blueprints (task 128 / street wander graph): the curb in front of one of these is a
// LOITER NODE — an ambulatory walk prefers to end there ("went to sit by the park") instead of at an
// arbitrary road anchor. The set is the leisure/civic-gathering venues from json/venues.json — places
// people plausibly congregate — deliberately excluding shops/offices/homes (destinations, not hangouts).
const GATHERING_BLUEPRINTS = new Set<string>([
    'park', 'beach', 'bar', 'cafe', 'restaurant', 'cinema', 'gym', 'sports_complex', 'library', 'church',
]);

let Game: GameManager;

export default class Field {
    private rows: number;
    private cols: number;

    private people: Person[];
    private vehicles: Vehicle[];
    private destinations: Set<string>;
    // Road anchors (V2 / aliveness-4): the roam targets for ambulatory street life, so a walk wanders the
    // streets and ends mid-block instead of terminating at a building entrance (the entrance-cluster fix).
    private roadAnchors: Set<string> = new Set();
    // Loiter nodes (task 128): the subset of road anchors sitting in front of a gathering venue (park/beach/
    // bar/…). An ambulatory walk PREFERS these, so people congregate at plausible spots rather than drifting
    // to arbitrary curb. Recomputed lazily behind a dirty flag — the gathering-building set changes only on
    // build/teardown/business-assignment, all of which mark it stale.
    private loiterAnchors: Set<string> = new Set();
    private loiterDirty = true;
    private pathFinder: PathFinder;

    public matrix: TileMatrix;

    constructor(gameManager: GameManager, rows: number, cols: number) {
        Game = gameManager;

        this.rows = rows;
        this.cols = cols;

        this.people = [];
        this.vehicles = [];
        this.destinations = new Set();
        this.pathFinder = new PathFinder(this);

        // The matrix is the fine tile grid. A structure (soil/road/building) spans a square footprint of
        // footprintTiles x footprintTiles tiles, and every cell in that footprint references the same instance.
        const footprintTiles = Game.gridParams.footprint.tiles;

        this.matrix = {};
        for (let row = 0; row < this.rows; row++) {
            this.matrix[row] = {};
        }

        // Fill the world with grass footprints. Each footprint is anchored on its centre tile and stamped across
        // all of its cells, then drawn once.
        for (let anchorRow = Math.floor(footprintTiles / 2); anchorRow < this.rows; anchorRow += footprintTiles) {
            for (let anchorCol = Math.floor(footprintTiles / 2); anchorCol < this.cols; anchorCol += footprintTiles) {
                const tile = new Soil(anchorRow, anchorCol, "grass");
                this.stampFootprint(tile);
                Game.emit("tileSpawned", tile);
            }
        }

        Game.on("tileClicked", { callback: this.handleTileClick, context: this });
        Game.on("personSpawnRequest", { callback: this.spawnPerson, context: this });
        // The debug V-key spawn (task 016): the test car carries an implicit test driver so the occupancy gate
        // (cars can't move without a person inside — task 008 spec) doesn't freeze the wander demo.
        Game.on("vehicleSpawnRequest", { callback: (position: PixelPosition) => {
            const vehicle = this.spawnVehicle(position);
            vehicle.setDebugDriver(true);
            return vehicle;
        }, context: this });
        Game.on("update", { callback: this.update, context: this });
    }

    update(event: UpdateEvent): void {
        // Movement runs on SIM time, not wall time (LP-2 / proposal simulation-aliveness-2 P0-5): the debug
        // time-throttle (task 117) scales the clock by timeScale, and movement must scale identically or a
        // 16× session makes every commute consume 16× its in-game duration — arrival-gated behavior (work
        // starts, school runs, dispatch, collection rounds) silently degrades. Larger per-frame deltas are
        // safe for the axis-clamped walkers; vehicles may corner slightly rougher at 16× — a debug-view
        // trade accepted over a desynced sim.
        // First-class time (W10): the SAME capped-and-scaled delta the clock consumes — movement and time
        // can never diverge, and a hitch (or pause) stalls both together.
        const timeDelta = Game.effectiveTimeDelta?.(event.timeDelta) ?? event.timeDelta;
        if (timeDelta <= 0) {
            return; // paused — the world holds still coherently
        }
        this.people.forEach((person: Person) => {
            const currentPixelPosition = person.getPosition();
            if (currentPixelPosition === null) {
                return;
            }

            const currentTilePosition = Game.pixelToTilePosition(currentPixelPosition);
            if (currentTilePosition === null) {
                return;
            }

            const currentTile = this.getTile(currentTilePosition.row, currentTilePosition.col);
            if (currentTile === null) {
                return;
            }

            // Ambulatory street life (V2) roams the ROADS (ends mid-block); debug-wander test people keep
            // the building-destination behaviour. A road-less world falls back to building destinations.
            const ambulatory = person.isAmbulatory?.() && this.roadAnchors.size > 0;
            const roamTargets = ambulatory ? this.roadAnchors : this.destinations;
            // A seeded, loiter-biased wander for ambulatory residents (task 128): the pick is deterministic
            // per (worldSeed, tick, person) and prefers a gathering-venue curb when one is reachable. Debug
            // test people (no wanderContext) keep the legacy unseeded building wander.
            const wanderContext = ambulatory
                ? {
                    loiter: this.getLoiterAnchors(),
                    seed: Game.population?.getState()?.worldSeed ?? 0,
                    tick: Game.clock?.getCurrentTick() ?? 0,
                }
                : undefined;
            person.update(currentTile, timeDelta, roamTargets, this.pathFinder, wanderContext);
            person.redraw(timeDelta);
        });

        this.vehicles.forEach((vehicle: Vehicle) => {
            const currentPixelPosition = vehicle.getPosition();
            if (currentPixelPosition === null) {
                return;
            }

            const currentTilePosition = Game.pixelToTilePosition(currentPixelPosition);
            if (currentTilePosition === null) {
                return;
            }

            const currentTile = this.getTile(currentTilePosition.row, currentTilePosition.col);
            if (currentTile === null) {
                return;
            }

            vehicle.drive(currentTile, timeDelta);
            // Commute cars are driven by their owner's travel state machine; only un-owned (test/idle) cars
            // pick a random destination to wander to.
            if (!vehicle.isControlled()) {
                vehicle.updateDestination(currentTile, this.destinations, this.pathFinder);
            }
            vehicle.redraw(timeDelta);
        });
    }

    handleTileClick(event: BuildEvent): void {
        const tileDictionary: { [key in Tool]: ((event: BuildEvent) => void) | null } = {
            [Tool.Road]: this.build,
            [Tool.Soil]: this.build,
            [Tool.House]: this.build,
            [Tool.Work]: this.build,
            // Select is routed through Field.selectAt (pixel-based, people-aware) from MainScene, not tileClicked.
            [Tool.Select]: null,
            [Tool.Bulldoze]: this.bulldoze,
            [Tool.Construction]: null, // the menu arms house/work — never a direct build tool (task 108)
        };

        const tileHandler = tileDictionary[event.tool as Tool];
        if (tileHandler) {
            tileHandler.call(this, event);
        } else {
            throw new Error(`Invalid tool to handle click '${event.tool}' on tile ${event.position?.row}-${event.position?.col}`);
        }
    }

    // The Select tool's universal inspector pick (task 026): a person sprite under the cursor takes priority,
    // otherwise the structure at that tile. Emits the matching selection event for the HUD to open a window.
    selectAt(pixelPosition: PixelPosition): void {
        if (pixelPosition === null) {
            return;
        }

        const person = this.findPersonAt(pixelPosition);
        if (person) {
            Game.emit("PersonSelected", person);
            return;
        }

        const tilePosition = Game.pixelToTilePosition(pixelPosition);
        if (tilePosition === null) {
            return;
        }
        const tile = this.getTile(tilePosition.row, tilePosition.col);
        if (tile instanceof House) {
            Game.emit("HouseSelected", tile);
        } else if (tile instanceof Workplace) {
            Game.emit("WorkplaceSelected", tile);
        }
    }

    // The nearest visible (not indoors) person within SELECT_RADIUS_PX of the pixel, or null. People are
    // sprites tracked outside the tile matrix, so selection hit-tests their live positions.
    findPersonAt(pixelPosition: PixelPosition): Person | null {
        if (pixelPosition === null) {
            return null;
        }
        let best: Person | null = null;
        let bestDistanceSq = SELECT_RADIUS_PX * SELECT_RADIUS_PX;
        for (const person of this.people) {
            if (person.isIndoors()) {
                continue;
            }
            const position = person.getPosition();
            if (position === null) {
                continue;
            }
            const dx = position.x - pixelPosition.x;
            const dy = position.y - pixelPosition.y;
            const distanceSq = dx * dx + dy * dy;
            if (distanceSq <= bestDistanceSq) {
                bestDistanceSq = distanceSq;
                best = person;
            }
        }
        return best;
    }

    bulldoze(event: BuildEvent): void {
        let tilePosition = event.position;
        if (tilePosition === null) {
            return;
        }

        // Authoritative anchor resolve (W9 / P0-6): whatever position the caller sent, the teardown targets
        // the occupying structure's anchor so the soil stamp below covers its WHOLE footprint. Off-anchor
        // stamps used to leave ghost buildings — sprite standing, household/business already destroyed.
        tilePosition = this.resolvePlacement(Tool.Bulldoze, tilePosition).position ?? tilePosition;

        // Tear the structure down coherently before the soil overwrite (task 025): a house evicts its residents
        // (relatives or homelessness, 022) and a workplace closes its business (lay off, 021), so no Person,
        // Household, or business is left pointing at the destroyed building.
        const tile = this.getTile(tilePosition.row, tilePosition.col);
        if (tile instanceof House) {
            Game.city?.demolishHouse(tile);
        } else if (tile instanceof Workplace) {
            Game.city?.demolishWorkplace(tile);
        }

        event.tool = Tool.Soil;
        event.position = tilePosition;
        this.build(event);
    }

    build(event: BuildEvent): void {
        let tilePosition = event.position;
        if (tilePosition === null) {
            return;
        }

        // Enforce placement rules authoritatively: roads snap to the supertile grid, and buildings must be a
        // valid road-side placement (in bounds, not overlapping another structure, flush against a road).
        if (event.tool === Tool.Road) {
            tilePosition = this.snapToRoadGrid(tilePosition);
        } else if (event.tool === Tool.House || event.tool === Tool.Work) {
            if (!this.isValidBuildingPlacement(tilePosition)) {
                return;
            }
        }

        if (tilePosition === null) {
            return;
        }

        const pixelCenter = Game.tileToPixelPosition(tilePosition);
        if (pixelCenter === null) {
            return;
        }

        const { row, col } = tilePosition;
        const currentTile = this.getTile(row, col);
        if (currentTile === null) {
            throw new Error(`Invalid tile to build on: ${row}-${col}`);
        }

        let newTile = null;
        // Construction-menu picks (task 108) override the default tool asset (civic colored squares).
        const assetName = event.asset ?? Game.toolbelt[event.tool as Tool];

        // TODO: This is a reduntant dictionary selection, refactor to just select tile class based on tool
        const tileDictionary: { [key in Tool]: (() => Tile) | null } = {
            [Tool.Road]: () => new Road(row, col, null),
            [Tool.Soil]: () => new Soil(row, col, assetName),
            [Tool.House]: () => new House(row, col, assetName),
            [Tool.Work]: () => new Workplace(row, col, assetName),
            [Tool.Select]: null,
            [Tool.Bulldoze]: null,
            [Tool.Construction]: null, // never a direct build tool (task 108)
        };
        const tileConstructor = tileDictionary[event.tool as Tool];

        if (tileConstructor) {
            newTile = tileConstructor();
        } else {
            throw new Error(`Invalid tool to build: ${event.tool}`);
        }

        // if new tile is instance of same as current tile, return
        if (newTile instanceof currentTile.constructor){
            return;
        }

        // Stamp the new structure across its whole footprint, then auto-tile it against its neighbours.
        this.stampFootprint(newTile);
        newTile.updateSelfBasedOnNeighbors(this.getNeighbors(newTile));

        const footprintParams = Game.gridParams.footprint;

        if (newTile instanceof Road) {
            newTile.calculateCurb(footprintParams, pixelCenter);
            newTile.calculateLanes(footprintParams, pixelCenter);
        }

        if (newTile instanceof Building) {
            newTile.calculateEntrance(footprintParams, pixelCenter);
        }

        Game.emit("tileSpawned", newTile);

        // Re-evaluate the neighbouring footprints so adjacent roads update their auto-tiling.
        const neighbors = this.getNeighbors(newTile);
        if (neighbors.top) this.refreshFootprint(neighbors.top);
        if (neighbors.bottom) this.refreshFootprint(neighbors.bottom);
        if (neighbors.left) this.refreshFootprint(neighbors.left);
        if (neighbors.right) this.refreshFootprint(neighbors.right);

        if (newTile instanceof Road) {
            Game.emit("roadBuilt", newTile);
        }

        if (newTile instanceof House) {
            Game.emit("houseBuilt", newTile);
        }

        if (newTile instanceof Workplace) {
            // A pinned blueprint (task 108: the construction menu chose a specific business) rides the
            // workplace transiently — City.setupBusiness consumes it; loads restore the business directly.
            if (event.blueprintKey !== undefined) {
                newTile.setPendingBlueprint(event.blueprintKey);
            }
            Game.emit("workplaceBuilt", newTile);
        }
    }

    spawnPerson(pixelPosition: PixelPosition): Person {
        if (pixelPosition === null) {
            throw new Error("Invalid pixel position to spawn person");
        }

        const tilePosition = Game.pixelToTilePosition(pixelPosition);
        if (tilePosition === null) {
            throw new Error("Invalid tile position to spawn person");
        }

        const currentTile = this.getTile(tilePosition.row, tilePosition.col);
        if (currentTile === null) {
            throw new Error("Invalid tile to spawn person");
        }

        const { x, y } = pixelPosition;
        const person = new Person(x, y);
        person.setGameManager(Game);
        person.updateDepth(currentTile);

        this.people.push(person);
        Game.emit("personSpawned", person);
        
        return person;
    }

    spawnVehicle(pixelPosition: PixelPosition): Vehicle {
        if (pixelPosition === null) {
            throw new Error("Invalid pixel position to spawn vehicle");
        }

        const tilePosition = Game.pixelToTilePosition(pixelPosition);
        if (tilePosition === null) {
            throw new Error("Invalid tile position to spawn vehicle");
        }

        const currentTile = this.getTile(tilePosition.row, tilePosition.col);
        if (currentTile === null) {
            throw new Error("Invalid tile to spawn vehicle");
        }

        const { x, y } = pixelPosition;
        const vehicle = new Vehicle(x, y);
        vehicle.updateDepth(currentTile);

        this.vehicles.push(vehicle);
        Game.emit("vehicleSpawned", vehicle);

        return vehicle;
    }

    // Stamps a structure across every cell of its footprint and reconciles destinations and any structures it
    // overwrites. A previously placed structure is only torn down once none of its cells reference it anymore,
    // which lets footprints partially overlap.
    stampFootprint(structure: Tile): void {
        if (structure === null) {
            return;
        }

        const footprintTiles = Game.gridParams.footprint.tiles;
        const cells = structure.getFootprintCells(footprintTiles);

        const overwritten = new Set<Tile>();
        for (const cell of cells) {
            if (cell === null || !this.isValidPosition(cell.row, cell.col)) {
                continue;
            }

            const existing = this.matrix[cell.row]?.[cell.col];
            if (existing && existing !== structure) {
                overwritten.add(existing);
            }

            this.setTile(cell.row, cell.col, structure);
        }

        // An address is a structure's anchor cell. Buildings are travel destinations; other structures are not.
        const anchorKey = structure.getIdentifier();
        this.destinations.delete(anchorKey);
        this.roadAnchors.delete(anchorKey);
        this.loiterDirty = true; // structure set changed → gathering-venue curbs may have moved

        // Tear down anything this structure fully replaced BEFORE registering our own anchor below. A road or
        // building placed on a supertile anchor shares its key ("row-col") with the grass footprint it
        // overwrites — grass footprints are anchored on the SAME 3k+1 grid roads snap to — and
        // destroyStructure deletes that key from destinations/roadAnchors. Registering AFTER the teardown
        // means the replaced grass can't wipe our just-added entry. (This ordering bug left roadAnchors and
        // grid-aligned destinations permanently EMPTY: since roads always snap to the grid, V2's ambulatory
        // street roam silently had no road targets and every walk fell back to building-entrance wander —
        // the audit's persistent entrance-clustering.)
        for (const previous of overwritten) {
            if (this.isFootprintOrphaned(previous)) {
                this.destroyStructure(previous);
            }
        }

        if (structure instanceof Building) {
            this.destinations.add(anchorKey);
        } else if (structure instanceof Road) {
            // Road anchors are the roam targets for ambulatory street life (V2): a person "taking a walk"
            // wanders the ROADS and stops mid-street, instead of pathing to a building's entrance and
            // clustering there (the audit's crowds at civic doorways).
            this.roadAnchors.add(anchorKey);
        }
    }

    // Re-runs auto-tiling for a structure based on its current neighbours and redraws it if its asset changed.
    refreshFootprint(structure: Tile): void {
        if (structure === null) {
            return;
        }

        const oldAssetName = structure.getAssetName();
        structure.updateSelfBasedOnNeighbors(this.getNeighbors(structure));

        if (structure.getAssetName() !== oldAssetName) {
            Game.emit("tileSpawned", structure);
        }
    }

    private isFootprintOrphaned(structure: Tile): boolean {
        const footprintTiles = Game.gridParams.footprint.tiles;
        const cells = structure.getFootprintCells(footprintTiles);

        for (const cell of cells) {
            if (cell === null || !this.isValidPosition(cell.row, cell.col)) {
                continue;
            }

            if (this.matrix[cell.row]?.[cell.col] === structure) {
                return false;
            }
        }

        return true;
    }

    private destroyStructure(structure: Tile): void {
        const asset = structure.getAsset();
        if (asset) {
            asset.destroy();
        }

        const debugText = structure.getDebugText();
        if (debugText) {
            debugText.destroy();
        }

        this.destinations.delete(structure.getIdentifier());
        this.roadAnchors.delete(structure.getIdentifier());
        this.loiterDirty = true;
    }

    // Marks the loiter-node cache stale (task 128). Called by City when a business is (re)assigned to a
    // workplace — a Workplace has no business at stamp time (setupBusiness runs after workplaceBuilt), so the
    // build-time dirty flag can't yet see its blueprint; the assignment is the second, decisive signal.
    markLoiterDirty(): void {
        this.loiterDirty = true;
    }

    // The loiter nodes — road anchors in front of gathering venues (task 128). Recomputed lazily on first
    // access after any change; the scan is O(buildings) (a few dozen) and only runs when stale.
    getLoiterAnchors(): Set<string> {
        if (this.loiterDirty) {
            this.recomputeLoiterAnchors();
        }
        return this.loiterAnchors;
    }

    private recomputeLoiterAnchors(): void {
        this.loiterAnchors.clear();
        for (const key of this.destinations) {
            const [row, col] = key.split('-').map(Number);
            if (row === undefined || col === undefined) {
                continue;
            }
            const tile = this.getTile(row, col);
            if (!(tile instanceof Workplace)) {
                continue;
            }
            const blueprintKey = tile.getBusiness()?.blueprintKey;
            if (!blueprintKey || !GATHERING_BLUEPRINTS.has(blueprintKey)) {
                continue;
            }
            const roadTile = this.getAdjacentRoadTile(tile);
            if (!roadTile) {
                continue;
            }
            const road = this.getTile(roadTile.row, roadTile.col);
            if (road instanceof Road) {
                this.loiterAnchors.add(road.getIdentifier());
            }
        }
        this.loiterDirty = false;
    }

    // Resolves where a structure would actually be placed for the given tool, and whether that placement is
    // valid. Roads snap to the supertile grid; buildings soft-snap to the nearest road side; everything else is
    // placed as-is. Both the build preview and the click handler go through this so they always agree.
    resolvePlacement(tool: Tool, position: TilePosition): PlacementResult {
        if (position === null) {
            return { position: null, valid: false };
        }

        if (tool === Tool.Road) {
            return { position: this.snapToRoadGrid(position), valid: true };
        }

        if (tool === Tool.House || tool === Tool.Work) {
            return this.resolveBuildingPlacement(position);
        }

        // Bulldoze truth (W9 / proposal simulation-aliveness-3 P0-6): the bulldozer targets STRUCTURES —
        // the clicked cell resolves to the occupying structure's ANCHOR so the soil stamp covers its whole
        // footprint. An off-anchor click used to overwrite a partial footprint, leaving a ghost building
        // (sprite + cells standing, household/business already destroyed). Empty ground keeps the
        // paint-as-is soil semantics (grass IS the empty state, task 108).
        if (tool === Tool.Bulldoze) {
            const occupied = this.getTile(position.row, position.col);
            if (occupied instanceof Road || occupied instanceof Building) {
                return { position: occupied.getPosition(), valid: true };
            }
            return { position, valid: true };
        }

        return { position, valid: true };
    }

    // Snaps a tile position to the nearest supertile anchor (the same anchors the soil grid uses), so roads
    // always land footprint-aligned and connect/auto-tile correctly.
    snapToRoadGrid(position: TilePosition): TilePosition {
        if (position === null) {
            return null;
        }

        const footprintTiles = Game.gridParams.footprint.tiles;
        const half = Math.floor(footprintTiles / 2);

        const snap = (value: number, maxAnchor: number): number => {
            const index = Math.round((value - half) / footprintTiles);
            const anchor = (index * footprintTiles) + half;
            return Math.max(half, Math.min(anchor, maxAnchor));
        };

        return {
            row: snap(position.row, this.rows - 1 - half),
            col: snap(position.col, this.cols - 1 - half),
        };
    }

    // A building placement is valid when its whole footprint is in bounds, overlaps no road/building, and is
    // flush against at least one road side.
    isValidBuildingPlacement(position: TilePosition): boolean {
        if (position === null) {
            return false;
        }

        const footprintTiles = Game.gridParams.footprint.tiles;
        const cells = this.footprintCellsAt(position.row, position.col, footprintTiles);

        for (const cell of cells) {
            if (!this.isValidPosition(cell.row, cell.col)) {
                return false;
            }

            const tile = this.getTile(cell.row, cell.col);
            if (tile instanceof Road || tile instanceof Building) {
                return false;
            }
        }

        return this.isFootprintRoadAdjacent(position.row, position.col, footprintTiles);
    }

    // Finds the valid road-side placement closest to the cursor within the snap radius. Returns the raw position
    // (flagged invalid) when there is no road side near enough to snap to.
    resolveBuildingPlacement(position: TilePosition): PlacementResult {
        if (position === null) {
            return { position: null, valid: false };
        }

        if (this.isValidBuildingPlacement(position)) {
            return { position, valid: true };
        }

        const cursorPixel = Game.tileToPixelPosition(position);

        let best: TilePosition = null;
        let bestDistance = Infinity;

        for (let dr = -BUILDING_SNAP_RADIUS_TILES; dr <= BUILDING_SNAP_RADIUS_TILES; dr++) {
            for (let dc = -BUILDING_SNAP_RADIUS_TILES; dc <= BUILDING_SNAP_RADIUS_TILES; dc++) {
                const candidate: TilePosition = { row: position.row + dr, col: position.col + dc };
                if (!this.isValidBuildingPlacement(candidate)) {
                    continue;
                }

                const candidatePixel = Game.tileToPixelPosition(candidate);
                if (candidatePixel === null || cursorPixel === null) {
                    continue;
                }

                const distance = Math.pow(candidatePixel.x - cursorPixel.x, 2) + Math.pow(candidatePixel.y - cursorPixel.y, 2);
                // The capture gate (W9): beyond 1.5 tiles the preview stays honestly invalid — no yanking.
                const captureLimit = Math.pow(BUILDING_SNAP_CAPTURE_TILES * Game.gridParams.cells.width, 2);
                if (distance > captureLimit) {
                    continue;
                }
                if (distance < bestDistance) {
                    bestDistance = distance;
                    best = candidate;
                }
            }
        }

        if (best !== null) {
            return { position: best, valid: true };
        }

        return { position, valid: false };
    }

    private footprintCellsAt(row: number, col: number, footprintTiles: number): { row: number; col: number }[] {
        const half = Math.floor(footprintTiles / 2);
        const cells: { row: number; col: number }[] = [];

        for (let r = row - half; r <= row + half; r++) {
            for (let c = col - half; c <= col + half; c++) {
                cells.push({ row: r, col: c });
            }
        }

        return cells;
    }

    // The street spot "in front of" a building: the road cell on the ring just outside its footprint that is
    // closest to the building's entrance. This is where a commute car materializes (task 008 spec: cars live
    // on the street, never inside a footprint) and where it parks at the destination. Null when the building
    // somehow has no adjacent road (legacy/test worlds) — callers fall back to the entrance.
    // The nearest road tile to a pixel position (V1 / aliveness-4 trip planner): a commute car for an
    // OUTDOORS person must spawn on the road near their BODY, not at their home (origin truth). The person's
    // own tile is usually already a curb; otherwise a small ring search outward finds the closest road.
    nearestRoadTile(pixel: PixelPosition, maxRadius = 3): TilePosition {
        if (!pixel) {
            return null;
        }
        const origin = Game.pixelToTilePosition(pixel);
        if (!origin) {
            return null;
        }
        if (this.getTile(origin.row, origin.col) instanceof Road) {
            return origin;
        }
        for (let radius = 1; radius <= maxRadius; radius++) {
            let best: TilePosition = null;
            let bestDistance = Infinity;
            for (let dr = -radius; dr <= radius; dr++) {
                for (let dc = -radius; dc <= radius; dc++) {
                    if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) {
                        continue; // ring boundary only — inner rings were checked at smaller radii
                    }
                    const row = origin.row + dr;
                    const col = origin.col + dc;
                    if (!this.isValidPosition(row, col) || !(this.getTile(row, col) instanceof Road)) {
                        continue;
                    }
                    const center = Game.tileToPixelPosition({ row, col });
                    const distance = center ? Math.hypot(center.x - pixel.x, center.y - pixel.y) : 0;
                    if (distance < bestDistance) {
                        bestDistance = distance;
                        best = { row, col };
                    }
                }
            }
            if (best) {
                return best;
            }
        }
        return null;
    }

    getAdjacentRoadTile(building: Building): TilePosition {
        const footprintTiles = Game.gridParams.footprint.tiles;
        const half = Math.floor(footprintTiles / 2);
        const row = building.getRow();
        const col = building.getCol();

        const ring: { row: number; col: number }[] = [];
        for (let c = col - half; c <= col + half; c++) {
            ring.push({ row: row - half - 1, col: c });
            ring.push({ row: row + half + 1, col: c });
        }
        for (let r = row - half; r <= row + half; r++) {
            ring.push({ row: r, col: col - half - 1 });
            ring.push({ row: r, col: col + half + 1 });
        }

        const entrance = building.getEntrance();
        let best: TilePosition = null;
        let bestDistance = Infinity;
        for (const cell of ring) {
            if (!this.isValidPosition(cell.row, cell.col) || !(this.getTile(cell.row, cell.col) instanceof Road)) {
                continue;
            }
            const center = Game.tileToPixelPosition(cell);
            if (!center) {
                continue;
            }
            const distance = entrance
                ? Math.hypot(center.x - entrance.x, center.y - entrance.y)
                : 0;
            if (distance < bestDistance) {
                bestDistance = distance;
                best = cell;
            }
        }
        return best;
    }

    // Returns true when at least one cell on the ring just outside the footprint's edges is a road.
    private isFootprintRoadAdjacent(row: number, col: number, footprintTiles: number): boolean {
        const half = Math.floor(footprintTiles / 2);
        const ring: { row: number; col: number }[] = [];

        for (let c = col - half; c <= col + half; c++) {
            ring.push({ row: row - half - 1, col: c });
            ring.push({ row: row + half + 1, col: c });
        }

        for (let r = row - half; r <= row + half; r++) {
            ring.push({ row: r, col: col - half - 1 });
            ring.push({ row: r, col: col + half + 1 });
        }

        for (const cell of ring) {
            if (!this.isValidPosition(cell.row, cell.col)) {
                continue;
            }

            if (this.getTile(cell.row, cell.col) instanceof Road) {
                return true;
            }
        }

        return false;
    }

    getNeighbors(tile: Tile): NeighborMap {
        const row = tile.getRow();
        const col = tile.getCol();

        // Neighbouring footprints sit one cell beyond this footprint's edge, i.e. half the footprint plus one
        // away from the anchor centre.
        const offset = Math.floor(Game.gridParams.footprint.tiles / 2) + 1;

        const neighbors: NeighborMap = {
            top: this.isValidPosition(row - offset, col) ? this.getTile(row - offset, col) : null,
            bottom: this.isValidPosition(row + offset, col) ? this.getTile(row + offset, col) : null,
            left: this.isValidPosition(row, col - offset) ? this.getTile(row, col - offset) : null,
            right: this.isValidPosition(row, col + offset) ? this.getTile(row, col + offset) : null
        };

        return neighbors;
    }

    isValidPosition(row: number, col: number): boolean {
        const isRowValid = row >= 0 && row < this.getRows();
        const isColValid = col >= 0 && col < this.getCols();
        return (isRowValid && isColValid);
    }

    getTile(row: number, col: number): Tile | null {
        const rowEntry = this.matrix[row];
        if (!rowEntry) {
            console.error(`[Field] Tried to get an invalid row: ${row}`);
            return null;
        }

        const tile = rowEntry[col];
        if (!tile) {
            console.error(`[Field] Tried to get an invalid col: ${col}`);
            return null;
        }

        return tile;
    }

    setTile(row: number, col: number, tile: Tile): void {
        const rowEntry = this.matrix[row];
        if (!rowEntry) {
            console.error(`[Field] Tried to set an invalid row: ${row}`);
            return;
        }
        rowEntry[col] = tile;
    }

    getRows(): number {
        return this.rows;
    }

    getCols(): number {
        return this.cols;
    }

    // --- Save/load support -------------------------------------------------

    getPeople(): Person[] {
        return this.people;
    }

    // Despawns a person: destroys its sprite and drops it from the update list. Used when a resident dies.
    removePerson(person: Person): void {
        const index = this.people.indexOf(person);
        if (index === -1) {
            return;
        }
        this.people.splice(index, 1);
        // Despawn the removed person's linked car (task 130): once its driver is gone it links to nobody, so
        // it would become a controlled orphan (the runWakePass sweep would reap it a minute later, but tearing
        // it down here keeps the invariant immediate). removeVehicle ejects any remaining occupants (ridesharing).
        const vehicle = person.getVehicle();
        if (vehicle) {
            this.removeVehicle(vehicle);
        }
        person.getAsset()?.destroy();
        person.markRemoved(); // a late-attaching sprite (async draw handler) self-destroys — W8/P0-2.2
    }

    getVehicles(): Vehicle[] {
        return this.vehicles;
    }

    // Despawns a vehicle: ejects any remaining occupants, destroys its sprite, and drops it from the update
    // list. Used when a commute car is despawned at the destination on arrival (task 130 on-demand cars).
    removeVehicle(vehicle: Vehicle): void {
        const index = this.vehicles.indexOf(vehicle);
        if (index === -1) {
            return;
        }
        // Eject everyone still aboard (ridesharing / forced despawn, task 130): a car must never vanish with
        // a person invisibly inside. Each occupant is stepped out at the car's position with their sprite
        // restored and their vehicle link cleared — the W8 contract, generalized from one driver to N riders.
        const carPosition = vehicle.getPosition();
        for (const occupant of [...vehicle.getOccupants()]) {
            occupant.ejectFromVehicle(vehicle, carPosition);
        }
        this.vehicles.splice(index, 1);
        vehicle.getAsset()?.destroy();
        vehicle.markRemoved(); // a late-attaching sprite (async draw handler) self-destroys — W8/P0-2.2
    }

    // Returns the distinct placed structures (roads & buildings). Soil/grass is the implicit default and is not
    // included, since loads are applied over a fresh, all-grass field.
    getStructures(): Tile[] {
        const seen = new Set<Tile>();
        const structures: Tile[] = [];

        for (let row = 0; row < this.rows; row++) {
            const rowEntry = this.matrix[row];
            if (!rowEntry) {
                continue;
            }

            for (let col = 0; col < this.cols; col++) {
                const tile = rowEntry[col];
                if (!tile) {
                    continue;
                }

                if ((tile instanceof Road || tile instanceof Building) && !seen.has(tile)) {
                    seen.add(tile);
                    structures.push(tile);
                }
            }
        }

        return structures;
    }

    // Places a structure during load: stamps its footprint, recomputes waypoints/entrance and draws it, but does
    // NOT emit houseBuilt/roadBuilt — so loading never regenerates families or re-runs build side effects. The
    // saved assetName (e.g. a road's auto-tile code) is authoritative and kept as-is.
    loadStructure(type: 'road' | 'house' | 'work', row: number, col: number, assetName: string | null): Tile | null {
        let structure: Tile;
        switch (type) {
            case 'road':
                structure = new Road(row, col, assetName);
                break;
            case 'house':
                structure = new House(row, col, assetName);
                break;
            case 'work':
                structure = new Workplace(row, col, assetName);
                break;
            default:
                return null;
        }

        const pixelCenter = Game.tileToPixelPosition({ row, col });
        this.stampFootprint(structure);

        const footprintParams = Game.gridParams.footprint;
        if (structure instanceof Road && pixelCenter) {
            structure.calculateCurb(footprintParams, pixelCenter);
            structure.calculateLanes(footprintParams, pixelCenter);
        }
        if (structure instanceof Building && pixelCenter) {
            structure.calculateEntrance(footprintParams, pixelCenter);
        }

        Game.emit("tileSpawned", structure);
        return structure;
    }

    loadPerson(x: number, y: number): Person {
        const person = new Person(x, y);
        person.setGameManager(Game);

        const tilePosition = Game.pixelToTilePosition({ x, y });
        if (tilePosition) {
            const tile = this.getTile(tilePosition.row, tilePosition.col);
            if (tile) {
                person.updateDepth(tile);
            }
        }

        this.people.push(person);
        Game.emit("personSpawned", person);
        return person;
    }

    loadVehicle(x: number, y: number): Vehicle {
        const vehicle = new Vehicle(x, y);

        const tilePosition = Game.pixelToTilePosition({ x, y });
        if (tilePosition) {
            const tile = this.getTile(tilePosition.row, tilePosition.col);
            if (tile) {
                vehicle.updateDepth(tile);
            }
        }

        this.vehicles.push(vehicle);
        Game.emit("vehicleSpawned", vehicle);
        return vehicle;
    }
}