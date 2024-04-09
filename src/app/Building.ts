import Tile from 'app/Tile';

import { Point } from 'types/Tile';
import { PixelPosition } from 'types/Position';
import { CellParams } from 'types/Grid';
export default class Building extends Tile {
    private entrance: Point;

    constructor(row: number, col: number, textureName: string | null) {
        super(row, col, textureName);
        this.entrance = {x: 0, y: 0};
    }

    calculateDepth(): number {
        return ((this.row + 1) * 10);
    }

    calculateEntrance(cellParams: CellParams, pixelCenter: PixelPosition): void {
        if (!cellParams || !pixelCenter) {
            console.warn(`[Building] calculateEntrance() called with invalid parameters: ${pixelCenter}, ${cellParams}`);
            return;
        }

        this.entrance = {
            x: pixelCenter.x,
            y: pixelCenter.y + (cellParams.height / 2) - 5,
        };
    }

    getEntrance(): Point {
        return this.entrance;
    }
}