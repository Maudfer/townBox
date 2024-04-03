import Tile from './Tile.js';
import Road from './Road.js';
import Building from './Building.js';
import Person from './Person';
import PathFinder from './PathFinder';

export default class Field {
    constructor(gameManager, rows, cols) {
        this.gameManager = gameManager;
        this.rows = rows;
        this.cols = cols;

        this.matrix = {};
        this.destinations = new Set();
        this.people = [];
        
        this.cursorEntity = null;
        this.pathFinder = new PathFinder(this);

        for (let row = 0; row < this.rows; row++) {
            this.matrix[row] = {};
            for (let col = 0; col < this.cols; col++) {
                const pixelCenter = this.gameManager.tileToPixelPosition(row, col);
                this.matrix[row][col] = new Tile(row, col, pixelCenter, null);
            }
        }

        this.gameManager.on("tileClicked", this.build, this);
        //this.gameManager.on('roadBuilt', this.spawnPerson, this);
        this.gameManager.on('personNeeded', this.spawnPerson, this);
        this.gameManager.on('update', this.update, this);
    }

    update(event) {
        this.people.forEach((person) => {
            const currentPosition = person.getPosition();
            const currentTilePosition = this.gameManager.pixelToTilePosition(currentPosition.x, currentPosition.y);
            const currentTile = this.getTile(currentTilePosition.row, currentTilePosition.col);

            person.walk(currentTile, event.delta);
            person.updateDepth(currentTile);
            person.updateDestination(currentTile, this.destinations, this.pathFinder);
        });
    }

    build(event) {
        const { row, col } = event.position;
        const pixelCenter = this.gameManager.tileToPixelPosition(row, col);

        let newTile = null;
        switch (event.tool) {
            case 'road':
                newTile = new Road(row, col, pixelCenter, null);
                break;
            case 'eraser':
                newTile = new Tile(row, col, pixelCenter, null);
                break;
            default:
                newTile = new Building(row, col, pixelCenter, event.tool);
        }

        const neighbors = this.getNeighbors(newTile);

        this.replaceTile(newTile);
        this.replaceTile(neighbors.top);
        this.replaceTile(neighbors.bottom);
        this.replaceTile(neighbors.left);
        this.replaceTile(neighbors.right);

        if (newTile instanceof Road) {
            this.gameManager.trigger("roadBuilt", { row, col });
        }
    }

    replaceTile(tile) {
        if (tile !== null) {
            const row = tile.getRow();
            const col = tile.getCol();

            const oldTile = this.getTile(row, col);
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
                if(tile instanceof Building) {
                    this.destinations.add(`${row}-${col}`);
                }

                this.setTile(row, col, tile);
                this.gameManager.trigger("tileUpdated", tile);
            }
        }
    }

    getNeighbors(tile) {
        const row = tile.getRow();
        const col = tile.getCol();

        const neighbors = {
            top: this.isValidPosition(row - 1, col) ? this.getTile(row - 1, col) : null,
            bottom: this.isValidPosition(row + 1, col) ? this.getTile(row + 1, col) : null,
            left: this.isValidPosition(row, col - 1) ? this.getTile(row, col - 1) : null,
            right: this.isValidPosition(row, col + 1) ? this.getTile(row, col + 1) : null
        };

        return neighbors;
    }

    isValidPosition(row, col) {
        const isRowValid = row >= 0 && row < this.getRows();
        const isColValid = col >= 0 && col < this.getCols();
        return (isRowValid && isColValid);
    }

    spawnPerson(event) {
        const { x, y } = event;

        const person = new Person(x, y);
        this.people.push(person);
        
        console.log('personSpawned', person);
        this.gameManager.trigger("personSpawned", person);
    }

    getTile(row, col) {
        return this.matrix[row][col];
    }

    setTile(row, col, tile) {
        this.matrix[row][col] = tile;
    }

    getBuildQueue() {
        return this.buildQueue;
    }

    getRows() {
        return this.rows;
    }

    getCols() {
        return this.cols;
    }

}