import Tile from '@/Tile';

import { PixelPosition } from '@/types/Position';

export default class Building extends Tile {
    constructor(row: number, col: number, center: PixelPosition, textureName: string | null) {
        super(row, col, center, textureName);
    }
}