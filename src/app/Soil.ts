import Tile from 'app/Tile';

import { PixelPosition } from 'types/Position';

export default class Soil extends Tile {
    constructor(row: number, col: number, center: PixelPosition, textureName: string | null) {
        super(row, col, center, textureName);
    }

    calculateDepth(): number {
        return 0;
    }
}