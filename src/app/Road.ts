import Tile from 'app/Tile';

import { NeighborMap } from 'types/Neighbor';
import { PixelPosition } from 'types/Position';

export default class Road extends Tile {
    constructor(row: number, col: number, center: PixelPosition, textureName: string | null) {
        super(row, col, center, textureName);
        
    }

    calculateDepth(): number {
        return (this.row * 10);
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
}