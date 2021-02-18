import Tile from './Tile.js';

export default class Field {

    constructor(rows, cols) {
        this.rows = rows;
        this.cols = cols;
        this.matrix = {};
        this.buildQueue = {};

        for(let i = 0; i < this.rows; i++){
            this.matrix[i] = {};
            for(let j = 0; j < this.cols; j++){
                this.matrix[i][j] = new Tile(i, j);
            }
        }

        //console.log(this.matrix);
    }

    iterateBuildQueue(callback){
        for (const [label, tile] of Object.entries(this.buildQueue)) {
            delete this.buildQueue[label];
            callback(tile);
        }
    }

    handleTileClick(row, col){
        this.matrix[row][col].setContent('ball');
        this.buildQueue[`${row}-${col}`] = this.matrix[row][col];
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