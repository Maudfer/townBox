export default class Tile {
    constructor(row, col, textureName) {
        this.row = row;
        this.col = col;
        this.textureName = textureName;
        //console.log(`Hello from Tile class. My row is ${this.row} and my column is ${this.column}`);
    }

    getRow(){
        return this.row;
    }
    
    getCol(){
        return this.col;
    }

    getTextureName(){
        return this.textureName;
    }

    setTextureName(textureName){
        this.textureName = textureName;
    }

    updateSelfBasedOnNeighbors(neighbors){
        
    }
}

