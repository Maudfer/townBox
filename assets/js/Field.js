import Tile from './Tile.js';

export default class Field {

    constructor(rows, cols) {
        this.rows = rows;
        this.cols = cols;
        this.matrix = {};
        this.builtTiles = {};

        for(let i = 0; i < this.rows; i++){
            this.matrix[i] = {};
            for(let j = 0; j < this.cols; j++){
                this.matrix[i][j] = new Tile(i, j);
            }
        }

        //console.log(this.matrix);
    }

    iterateBuiltTiles(callback){
        for (const [label, tile] of Object.entries(this.builtTiles)) {
            callback(tile);
        }
    }

    handleTileClick(row, col){
        this.matrix[row][col].setContent('ball');
        this.builtTiles[`${row}-${col}`] = this.matrix[row][col];
    }

    getRows(){
        return this.rows;
    }

    getCols(){
        return this.cols;
    }
}