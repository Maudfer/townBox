import Tile from './Tile.js';
import Road from './Road.js';
import Building from './Building.js';
import Person from './Person';

export default class Field {
    constructor(gameManager, rows, cols) {
        this.gameManager = gameManager;
        this.rows = rows;
        this.cols = cols;
        this.matrix = {};

        this.cursorEntity = null;
        this.people = [];

        for (let i = 0; i < this.rows; i++) {
            this.matrix[i] = {};
            for (let j = 0; j < this.cols; j++) {
                this.matrix[i][j] = new Tile(i, j, null);
            }
        }

        this.gameManager.on("tileClicked", this.build);
        this.gameManager.on('roadBuilt', this.spawnPerson);
    }

    build(event) {
        const { row, col } = event.position;

        let newTile = null;
        switch (event.tool) {
            case 'road':
                newTile = new Road(row, col, null);
                // this.peopleSpawner.push({row, col});
                break;
            case 'eraser':
                newTile = new Tile(row, col, null);
                break;
            default:
                newTile = new Building(row, col, event.tool);
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

            const neighbors = this.getNeighbors(tile);
            tile.updateSelfBasedOnNeighbors(neighbors);

            const oldTile = this.getTile(row, col);
            const oldTexture = oldTile.getTextureName();

            if (tile.getTextureName() !== oldTexture) {
                oldTile.getAsset()?.destroy();
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
        const { row, col } = event;
        const { x, y } = this.gameManager.tileToPixel(row, col);
        const person = new Person(x, y, row, col);

        person.decideNewDirection(this, true);
        this.people.push(person);

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