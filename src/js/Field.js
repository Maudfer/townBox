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
            newTile = new Road(row, col,'road_0011');
        } else if (button === 2){
            newTile = new Road(row, col, 'road_1100');
        } else {
            newTile = new Building(row, col, 'building_1x1x1_2');
        }
        
        const neighbors = this.getNeighbors(newTile);
        newTile.updateSelfBasedOnNeighbors(neighbors);

        /*
        neighbors.top.updateSelfBasedOnNeighbors(this.getNeighbors(neighbors.top));
        this.buildQueue.push(newTile);

        neighbors.bottom.updateSelfBasedOnNeighbors(this.getNeighbors(neighbors.bottom));
        this.buildQueue.push(neighbors.bottom);

        neighbors.left.updateSelfBasedOnNeighbors(this.getNeighbors(neighbors.left));
        this.buildQueue.push(neighbors.left);

        neighbors.right.updateSelfBasedOnNeighbors(this.getNeighbors(neighbors.right));
        this.buildQueue.push(neighbors.right);
        */

        this.matrix[row][col] = newTile;
        this.buildQueue.push(newTile);
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