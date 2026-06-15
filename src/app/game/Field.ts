import GameManager from 'game/GameManager';
import Tile from 'game/Tile';
import Soil from 'game/Soil';
import Road from 'game/Road';
import Building from 'game/Building';
import House from 'game/House';
import Workplace from 'game/Workplace';
import Person from 'game/Person';
import Vehicle from 'game/Vehicle';
import PathFinder from 'game/PathFinder';

import { PixelPosition } from 'types/Position';
import { UpdateEvent, BuildEvent } from 'types/Events';
import { NeighborMap } from 'types/Neighbor';
import { Tool } from 'types/Cursor';

type TileMatrix = {
    [row: number]: {
        [col: number]: Tile;
    };
};

let Game: GameManager;

export default class Field {
    private rows: number;
    private cols: number;

    private people: Person[];
    private vehicles: Vehicle[];
    private destinations: Set<string>;
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
        Game.on("vehicleSpawnRequest", { callback: this.spawnVehicle, context: this });
        Game.on("update", { callback: this.update, context: this });
    }

    update(event: UpdateEvent): void {
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

            person.update(currentTile, event.timeDelta, this.destinations, this.pathFinder);
            person.redraw(event.timeDelta);
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

            vehicle.drive(currentTile, event.timeDelta);
            vehicle.updateDestination(currentTile, this.destinations, this.pathFinder);
            vehicle.redraw(event.timeDelta);
        });
    }

    handleTileClick(event: BuildEvent): void {
        const tileDictionary: { [key in Tool]: ((event: BuildEvent) => void) | null } = {
            [Tool.Road]: this.build,
            [Tool.Soil]: this.build,
            [Tool.House]: this.build,
            [Tool.Work]: this.build,
            [Tool.Select]: this.select,
            [Tool.Bulldoze]: this.bulldoze,
        };

        const tileHandler = tileDictionary[event.tool as Tool];
        if (tileHandler) {
            tileHandler.call(this, event);
        } else {
            throw new Error(`Invalid tool to handle click '${event.tool}' on tile ${event.position?.row}-${event.position?.col}`);
        }
    }

    select(event: BuildEvent): void {
        const tilePosition = event.position;
        if (tilePosition === null) {
            return;
        }

        const tile = this.getTile(tilePosition.row, tilePosition.col);
        if (tile === null) {
            return;
        }

        if (tile instanceof House) {
            Game.emit("HouseSelected", tile);
        }
    }

    bulldoze(event: BuildEvent): void {
        const tilePosition = event.position;
        if (tilePosition === null) {
            return;
        }

        const tile = this.getTile(tilePosition.row, tilePosition.col);
        if (tile instanceof House) {
            // TODO: Implement relocateFamily
            // tile.relocateFamily();
        }

        event.tool = Tool.Soil;
        this.build(event);
    }

    build(event: BuildEvent): void {
        const tilePosition = event.position;
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
        const assetName = Game.toolbelt[event.tool as Tool];

        // TODO: This is a reduntant dictionary selection, refactor to just select tile class based on tool
        const tileDictionary: { [key in Tool]: (() => Tile) | null } = {
            [Tool.Road]: () => new Road(row, col, null),
            [Tool.Soil]: () => new Soil(row, col, assetName),
            [Tool.House]: () => new House(row, col, assetName),
            [Tool.Work]: () => new Workplace(row, col, assetName),
            [Tool.Select]: null,
            [Tool.Bulldoze]: null,
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
        neighbors.top && this.refreshFootprint(neighbors.top);
        neighbors.bottom && this.refreshFootprint(neighbors.bottom);
        neighbors.left && this.refreshFootprint(neighbors.left);
        neighbors.right && this.refreshFootprint(neighbors.right);

        if (newTile instanceof Road) {
            Game.emit("roadBuilt", newTile);
        }

        if (newTile instanceof House) {
            Game.emit("houseBuilt", newTile);
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
        if (structure instanceof Building) {
            this.destinations.add(anchorKey);
        }

        for (const previous of overwritten) {
            if (this.isFootprintOrphaned(previous)) {
                this.destroyStructure(previous);
            }
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
        if (!this.matrix[row]) {
            console.error(`[Field] Tried to get an invalid row: ${row}`);
            return null;
        }

        if (!this.matrix[row][col]) {
            console.error(`[Field] Tried to get an invalid col: ${col}`);
            return null;
        }

        return this.matrix[row][col];
    }

    setTile(row: number, col: number, tile: Tile): void {
        if (!this.matrix[row]) {
            console.error(`[Field] Tried to set an invalid row: ${row}`);
            return;
        }
        this.matrix[row][col] = tile;
    }

    getRows(): number {
        return this.rows;
    }

    getCols(): number {
        return this.cols;
    }
}