import Tile from 'app/Tile';

import { PixelPosition } from 'types/Position';

export default class Building extends Tile {
    constructor(row: number, col: number, center: PixelPosition, textureName: string | null) {
        super(row, col, center, textureName);
    }

    calculateDepth(): number {
        return ((this.row + 1) * 10);
    }
}