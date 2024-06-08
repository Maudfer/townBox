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

import { TilePosition, PixelPosition } from 'types/Position';
import { UpdateEvent, BuildEvent } from 'types/Events';
import { NeighborMap } from 'types/Neighbor';
import { Tool } from 'types/Cursor';

type TileMatrix = {
    [row: number]: {
        [col: number]: Tile;
    };
};

export default class Field {
    private gameManager: GameManager;
    private rows: number;
    private cols: number;

    private people: Person[];
    private vehicles: Vehicle[];
    private destinations: Set<string>;
    private pathFinder: PathFinder;

    public matrix: TileMatrix;

    constructor(gameManager: GameManager, rows: number, cols: number) {
        this.gameManager = gameManager;
        this.rows = rows;
        this.cols = cols;

        this.people = [];
        this.vehicles = [];
        this.destinations = new Set();
        this.pathFinder = new PathFinder(this);

        this.matrix = {};
        for (let row = 0; row < this.rows; row++) {
            this.matrix[row] = {};

            for (let col = 0; col < this.cols; col++) {
                const tile = new Soil(row, col, "grass");
                this.matrix[row]![col] = tile;
                this.gameManager.emit("tileSpawned", tile);
            }
        }

        this.gameManager.on("tileClicked", { callback: this.build, context: this });
        this.gameManager.on("personSpawnRequest", { callback: this.spawnPerson, context: this });
        this.gameManager.on("vehicleSpawnRequest", { callback: this.spawnVehicle, context: this });
        this.gameManager.on("update", { callback: this.update, context: this });
    }

    update(event: UpdateEvent): void {
        this.people.forEach((person: Person) => {
            const currentPixelPosition = person.getPosition();
            if (currentPixelPosition === null) {
                return;
            }

            const currentTilePosition = this.gameManager.pixelToTilePosition(currentPixelPosition);
            if (currentTilePosition === null) {
                return;
            }

            const currentTile = this.getTile(currentTilePosition.row, currentTilePosition.col);
            if (currentTile === null) {
                return;
            }

            person.walk(currentTile, event.timeDelta);
            person.updateDestination(currentTile, this.destinations, this.pathFinder);
            person.redraw(event.timeDelta);
        });

        this.vehicles.forEach((vehicle: Vehicle) => {
            const currentPixelPosition = vehicle.getPosition();
            if (currentPixelPosition === null) {
                return;
            }

            const currentTilePosition = this.gameManager.pixelToTilePosition(currentPixelPosition);
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

    build(event: BuildEvent): void {
        const tilePosition = event.position;
        if (tilePosition === null) {
            return;
        }

        const pixelCenter = this.gameManager.tileToPixelPosition(tilePosition);
        if (pixelCenter === null) {
            return;
        }

        const { row, col } = tilePosition;
        const currentTile = this.getTile(row, col);
        if (currentTile === null) {
            throw new Error("Invalid tile to build on");
        }

        let newTile = null;
        const assetName = this.gameManager.toolbelt[event.tool as Tool];
        const tileDictionary: { [key in Tool]: () => Tile } = {
            [Tool.Road]: () => new Road(row, col, null),
            [Tool.Soil]: () => new Soil(row, col, assetName),
            [Tool.House]: () => new House(row, col, assetName),
            [Tool.Work]: () => new Workplace(row, col, assetName),
        };
        const tileConstructor = tileDictionary[event.tool as Tool];

        if (tileConstructor) {
            newTile = tileConstructor();
        } else {
            newTile = new Building(row, col, assetName);
        }

        // if new tile is instance of same as current tile, return
        if (newTile instanceof currentTile.constructor){
            return;
        }

        const neighbors = this.getNeighbors(newTile);

        this.replaceTile(newTile);
        neighbors.top && this.replaceTile(neighbors.top);
        neighbors.bottom && this.replaceTile(neighbors.bottom);
        neighbors.left && this.replaceTile(neighbors.left);
        neighbors.right && this.replaceTile(neighbors.right);

        if (newTile instanceof Road) {
            const cellParams = this.gameManager.gridParams.cells;
            newTile.calculateCurb(cellParams, pixelCenter);
            newTile.calculateLanes(cellParams, pixelCenter);

            this.gameManager.emit("roadBuilt", newTile);
        }

        if (newTile instanceof Building) {
            const cellParams = this.gameManager.gridParams.cells;
            newTile.calculateEntrance(cellParams, pixelCenter);
        }

        if (newTile instanceof House) {
            this.gameManager.emit("houseBuilt", newTile);
        }
    }

    spawnPerson(pixelPosition: PixelPosition): Person {
        if (pixelPosition === null) {
            throw new Error("Invalid pixel position to spawn person");
        }

        const tilePosition = this.gameManager.pixelToTilePosition(pixelPosition);
        if (tilePosition === null) {
            throw new Error("Invalid tile position to spawn person");
        }

        const currentTile = this.getTile(tilePosition.row, tilePosition.col);
        if (currentTile === null) {
            throw new Error("Invalid tile to spawn person");
        }

        const { x, y } = pixelPosition;
        const person = new Person(x, y);
        person.updateDepth(currentTile);

        this.people.push(person);
        this.gameManager.emit("personSpawned", person);
        
        return person;
    }

    spawnVehicle(pixelPosition: PixelPosition): Vehicle {
        if (pixelPosition === null) {
            throw new Error("Invalid pixel position to spawn vehicle");
        }

        const tilePosition = this.gameManager.pixelToTilePosition(pixelPosition);
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
        this.gameManager.emit("vehicleSpawned", vehicle);

        return vehicle;
    }

    replaceTile(tile: Tile): void {
        if (tile === null) {
            return;
        }

        const tilePosition: TilePosition = tile.getPosition();
        if (tilePosition === null) {
            return;
        }

        const { row, col } = tilePosition;
        const oldTile = this.getTile(row, col);
        if (oldTile === null) {
            return;
        }

        const oldAssetName = oldTile.getAssetName();
        const oldAsset = oldTile.getAsset();
        const oldDebugText = oldTile.getDebugText();

        const neighbors = this.getNeighbors(tile);
        tile.updateSelfBasedOnNeighbors(neighbors);

        if (tile.getAssetName() !== oldAssetName) {
            if (oldAsset) {
                oldAsset.destroy();
            }

            if (oldDebugText) {
                oldDebugText.destroy();
            }
            
            // Update destinations set with building tiles
            this.destinations.delete(`${row}-${col}`);
            if (tile instanceof Building) {
                this.destinations.add(`${row}-${col}`);
            }

            this.setTile(row, col, tile);
            this.gameManager.emit("tileSpawned", tile);
        }

    }

    getNeighbors(tile: Tile): NeighborMap {
        const row = tile.getRow();
        const col = tile.getCol();

        const neighbors: NeighborMap = {
            top: this.isValidPosition(row - 1, col) ? this.getTile(row - 1, col) : null,
            bottom: this.isValidPosition(row + 1, col) ? this.getTile(row + 1, col) : null,
            left: this.isValidPosition(row, col - 1) ? this.getTile(row, col - 1) : null,
            right: this.isValidPosition(row, col + 1) ? this.getTile(row, col + 1) : null
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