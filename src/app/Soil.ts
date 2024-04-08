import Tile from 'app/Tile';

export default class Soil extends Tile {
    constructor(row: number, col: number, textureName: string | null) {
        super(row, col, textureName);
    }

    calculateDepth(): number {
        return 0;
    }
}