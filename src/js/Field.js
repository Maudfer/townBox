import Tile from './Tile.js';
import Road from './Road.js';
import Building from './Building.js';

export default class Field {

    constructor(rows, cols) {
        this.rows = rows;
        this.cols = cols;
        this.matrix = {};
        this.buildQueue = [];

        for(let i = 0; i < this.rows; i++){
            this.matrix[i] = {};
            for(let j = 0; j < this.cols; j++){
                this.matrix[i][j] = new Tile(i, j, null);
            }
        }
    }

    handleTileClick(row, col, button){
        let newTile = null;

        if(button === 0){
            newTile = new Road(row, col, null);
        } else if (button === 2){
            newTile = new Building(row, col, 'building_1x1x1_2');   
        } else {
            newTile = new Tile(row, col, null);   
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
            const neighbors = this.getNeighbors(tile);
    
            tile.updateSelfBasedOnNeighbors(neighbors);
            this.matrix[row][col] = tile;
            this.buildQueue.push(tile);
        }
    }

    getNeighbors(tile){
        const row = tile.getRow();
        const col = tile.getCol();

        const neighbors = {
            top: this.isValidPosition(row-1, col) ? this.matrix[row-1][col] : null,
            bottom: this.isValidPosition(row+1, col) ? this.matrix[row+1][col] : null,
            left: this.isValidPosition(row, col-1) ? this.matrix[row][col-1] : null,
            right: this.isValidPosition(row, col+1) ? this.matrix[row][col+1] : null
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