import Tile from './Tile.js';
import Road from './Road.js';
import Building from './Building.js';

export default class Field {

    constructor(rows, cols) {
        this.rows = rows;
        this.cols = cols;
        this.matrix = {};
        this.buildQueue = [];
        this.peopleSpawner = [];

        for(let i = 0; i < this.rows; i++){
            this.matrix[i] = {};
            for(let j = 0; j < this.cols; j++){
                this.matrix[i][j] = new Tile(i, j, null);
            }
        }
    }

    handleTileClick(row, col, event){
        let newTile = null;

        switch(event.tool){
            case 'road':
                newTile = new Road(row, col, null);
                this.peopleSpawner.push({row, col});
                break;
            case 'eraser':
                newTile = new Tile(row, col, null);
                break;
            default: 
                newTile = new Building(row, col, event.tool);
        }
        
        const neighbors = this.getNeighbors(newTile);

        this.updateFieldTile(newTile);
        this.updateFieldTile(neighbors.top);
        this.updateFieldTile(neighbors.bottom);
        this.updateFieldTile(neighbors.left);
        this.updateFieldTile(neighbors.right); 
    }

    updateFieldTile(tile){
        if(tile !== null){
            const row = tile.getRow();
            const col = tile.getCol();
            const oldTexture = this.getTile(row, col).getTextureName();

            const neighbors = this.getNeighbors(tile);
            tile.updateSelfBasedOnNeighbors(neighbors);

            if(tile.getTextureName() !== oldTexture){
                this.setTile(row, col, tile);
                this.buildQueue.push(tile);
            }
        }
    }

    getNeighbors(tile){
        const row = tile.getRow();
        const col = tile.getCol();

        const neighbors = {
            top: this.isValidPosition(row-1, col) ? this.getTile(row-1, col) : null,
            bottom: this.isValidPosition(row+1, col) ? this.getTile(row+1, col) : null,
            left: this.isValidPosition(row, col-1) ? this.getTile(row, col-1) : null,
            right: this.isValidPosition(row, col+1) ? this.getTile(row, col+1) : null
        };

        return neighbors;
    }

    isValidPosition(row, col){
        const isRowValid = row >= 0 && row < this.getRows();
        const isColValid = col >= 0 && col < this.getCols();
        return (isRowValid && isColValid);
    }

    iterateBuildQueue(callback){
        while(this.buildQueue.length > 0){
            const tile = this.buildQueue.shift();
            callback(tile);
        }
    }

    iteratePeopleSpawner(callback){
        while(this.peopleSpawner.length > 0){
            const person = this.peopleSpawner.shift();
            callback(person);
        }
    }

    getTile(row, col){
        return this.matrix[row][col];
    }

    setTile(row, col, tile){
        this.matrix[row][col] = tile;
    }

    getBuildQueue(){
        return this.buildQueue;
    }

    getRows(){
        return this.rows;
    }

    getCols(){
        return this.cols;
    }
}