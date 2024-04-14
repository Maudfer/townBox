import GameManager from 'app/GameManager';
import Tile from 'app/Tile';
import Soil from 'app/Soil';
import Road from 'app/Road';
import Building from 'app/Building';
import Person from 'app/Person';
import PathFinder from 'app/PathFinder';

import { TilePosition, PixelPosition } from 'types/Position';
import { UpdateEvent, BuildEvent } from 'types/Events';
import { NeighborMap } from 'types/Neighbor';

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
    private destinations: Set<string>;
    private pathFinder: PathFinder;

    public matrix: TileMatrix;

    constructor(gameManager: GameManager, rows: number, cols: number) {
        this.gameManager = gameManager;
        this.rows = rows;
        this.cols = cols;

        this.people = [];
        this.destinations = new Set();
        this.pathFinder = new PathFinder(this);

        this.matrix = {};
        for (let row = 0; row < this.rows; row++) {

            this.matrix[row] = {}; // Initialize the row
            for (let col = 0; col < this.cols; col++) {
                const tile = new Soil(row, col, "grass");
                this.matrix[row]![col] = tile;
                this.gameManager.emit("tileUpdated", tile);
            }
        }

        this.gameManager.on("tileClicked", { callback: this.build, context: this });
        this.gameManager.on("personNeeded", { callback: this.spawnPerson, context: this });
        this.gameManager.on("update", { callback: this.update, context: this });
    }

    update(event: UpdateEvent): void {
        this.people.forEach((person) => {
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

            person.walk(currentTile, event.delta);
            person.updateDestination(currentTile, this.destinations, this.pathFinder);
            person.redraw();
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
        

        let newTile = null;
        switch (event.tool) {
            case 'road':
                newTile = new Road(row, col, null);
                break;
            case 'soil':
                newTile = new Soil(row, col, "grass");
                break;
            default:
                newTile = new Building(row, col, event.tool);
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

            this.gameManager.emit("roadBuilt", tilePosition);
        }

        if (newTile instanceof Building) {
            const cellParams = this.gameManager.gridParams.cells;
            newTile.calculateEntrance(cellParams, pixelCenter);
        }
    }

    spawnPerson(pixelPosition: PixelPosition): void {
        if (pixelPosition === null) {
            return;
        }

        const tilePosition = this.gameManager.pixelToTilePosition(pixelPosition);
        if (tilePosition === null) {
            return;
        }

        const currentTile = this.getTile(tilePosition.row, tilePosition.col);
        if (currentTile === null) {
            return;
        }

        const { x, y } = pixelPosition;
        const person = new Person(x, y);
        person.updateDepth(currentTile);

        this.people.push(person);
        this.gameManager.emit("personSpawned", person);
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

        const oldTexture = oldTile.getTextureName();
        const oldAsset = oldTile.getAsset();

        const neighbors = this.getNeighbors(tile);
        tile.updateSelfBasedOnNeighbors(neighbors);

        // TODO: Implement a better way to update the tile that doesn't rely on texture name
        if (tile.getTextureName() !== oldTexture) {
            if (oldAsset) {
                oldAsset.destroy();
            }

            // Update destinations set with building tiles
            this.destinations.delete(`${row}-${col}`);
            if (tile instanceof Building) {
                this.destinations.add(`${row}-${col}`);
            }

            this.setTile(row, col, tile);
            this.gameManager.emit("tileUpdated", tile);
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