import Tile from './Tile.js';

export default class Road extends Tile {

    constructor(row, col, textureName) {
        super(row, col, textureName);
    }

    updateSelfBasedOnNeighbors(neighbors){
        let code = 'road_';

        const top = neighbors.top && neighbors.top instanceof Road ? '1' : '0';
        const bottom = neighbors.bottom && neighbors.bottom instanceof Road ? '1' : '0';
        const left = neighbors.left && neighbors.left instanceof Road? '1' : '0';
        const right = neighbors.right && neighbors.right instanceof Road ? '1' : '0';

        const neighborsCode = `${top}${bottom}${left}${right}`;

        // If tile is originally horizontal
        if(neighborsCode === '0000' || neighborsCode === '1000' || neighborsCode === '0100') {
            code += '1100';
        } else if (neighborsCode === '0010' || neighborsCode === '0001' || neighborsCode === '0011') {
            code += '0011';
        } else {
            code += neighborsCode;
        }

        this.textureName = code;
    }
}