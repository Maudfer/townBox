import Tile from 'app/Tile';

import { NeighborMap } from 'types/Neighbor';
import { PixelPosition } from 'types/Position';
import { CellParams } from 'types/Grid';
import { Curb, Lane } from 'types/Tile';
export default class Road extends Tile {
    private curb: Curb;
    private lane: Lane;

    constructor(row: number, col: number, textureName: string | null) {
        super(row, col, textureName);
        this.curb = null;
        this.lane = null;
    }

    calculateDepth(): number {
        return (this.row * 10);
    }

    calculateCurb(cellParams: CellParams, pixelCenter: PixelPosition): void {
        if (!cellParams || !pixelCenter) {
            console.warn(`[Road] calculateCurb() called with invalid parameters: ${pixelCenter}, ${cellParams}`);
            return;
        }

        const { width, height } = cellParams;
        const { x, y } = pixelCenter;

        const offset = 4;
        this.curb = {
            topLeft: {
                x: (x - (width / 2)) + offset,
                y: (y - (height / 2)) + offset
            },
            topRight: {
                x: (x + (width / 2)) - offset,
                y: (y - (height / 2)) + offset
            },
            bottomLeft: {
                x: (x - (width / 2)) + offset,
                y: (y + (height / 2)) - offset
            },
            bottomRight: {
                x: (x + (width / 2)) - offset,
                y: (y + (height / 2)) - offset
            }
        };
    }

    calculateLanes(cellParams: CellParams, pixelCenter: PixelPosition): void {
        if (!cellParams || !pixelCenter) {
            console.warn(`[Road] calculateLanes() called with invalid parameters: ${pixelCenter}, ${cellParams}`);
            return;
        }

        const { width, height } = cellParams;
        const { x, y } = pixelCenter;

        const offset = 13;
        this.lane = {
            topLeft: {
                x: (x - (width / 2)) + offset,
                y: (y - (height / 2)) + offset
            },
            topRight: {
                x: (x + (width / 2)) - offset,
                y: (y - (height / 2)) + offset
            },
            bottomLeft: {
                x: (x - (width / 2)) + offset,
                y: (y + (height / 2)) - offset
            },
            bottomRight: {
                x: (x + (width / 2)) - offset,
                y: (y + (height / 2)) - offset
            }
        };
    }

    isRightSideOfRoad(pixelPosition: PixelPosition): boolean {
        if(!pixelPosition || !this.curb) {
            console.warn(`[Road] isRightSideOfRoad() called with invalid parameters: ${pixelPosition}, ${this.curb}`);
            return false;
        }
        return pixelPosition.x > this.curb.topRight.x;
    }

    isTopSideOfTheRoad(pixelPosition: PixelPosition): boolean {
        if(!pixelPosition || !this.curb) {
            console.warn(`[Road] isTopSideOfTheRoad() called with invalid parameters: ${pixelPosition}, ${this.curb}`);
            return false;
        }
        return pixelPosition.y > this.curb.topRight.y;
    }

    updateSelfBasedOnNeighbors(neighbors: NeighborMap): void {
        let code = 'road_';

        const top = neighbors.top && neighbors.top instanceof Road ? '1' : '0';
        const bottom = neighbors.bottom && neighbors.bottom instanceof Road ? '1' : '0';
        const left = neighbors.left && neighbors.left instanceof Road ? '1' : '0';
        const right = neighbors.right && neighbors.right instanceof Road ? '1' : '0';

        const neighborsCode = `${top}${bottom}${left}${right}`;

        // Adjust the code based on neighbor types
        if (neighborsCode === '0000' || neighborsCode === '1000' || neighborsCode === '0100') {
            code += '1100';
        } else if (neighborsCode === '0010' || neighborsCode === '0001' || neighborsCode === '0011') {
            code += '0011';
        } else {
            code += neighborsCode;
        }

        this.setTextureName(code);
    }

    getConnectingRoads(neighbors: NeighborMap): Tile[] {
        let connectingRoads: Tile[] = [];

        Object.values(neighbors).forEach(tile => {
            if (tile instanceof Road) {
                connectingRoads.push(tile);
            }
        });

        return connectingRoads;
    }

    getCurb(): Curb {
        return this.curb;
    }

    getLane(): Lane {
        return this.lane;
    }
}