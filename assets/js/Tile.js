export default class Tile {
    constructor(row, col) {
        this.row = row;
        this.col = col;
        this.content = '';
        //console.log(`Hello from Tile class. My row is ${this.row} and my column is ${this.column}`);

    }

    getRow(){
        return this.row;
    }
    
    getCol(){
        return this.col;
    }

    getContent(){
        return this.content;
    }

    setContent(content){
        this.content = content;
    }
}

