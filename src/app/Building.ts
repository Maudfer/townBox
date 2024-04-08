import Tile from 'app/Tile';
export default class Building extends Tile {
    constructor(row: number, col: number, textureName: string | null) {
        super(row, col, textureName);
    }

    calculateDepth(): number {
        return ((this.row + 1) * 10);
    }
}