export default class Tile {
    constructor(row, col, textureName) {
        this.row = row;
        this.col = col;
        this.asset = null;
        this.textureName = textureName;
    }

    getRow(){
        return this.row;
    }
    
    getCol(){
        return this.col;
    }

    getIdentifier(){
        return `${this.row}-${this.col}`;
    }

    getTextureName(){
        return this.textureName;
    }

    setTextureName(textureName){
        this.textureName = textureName;
    }

    getAsset(){
        return this.asset;
    }

    setAsset(asset){
        this.asset = asset;
    }

    updateSelfBasedOnNeighbors(neighbors){
        
    }
}

