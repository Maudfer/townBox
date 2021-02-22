import Tile from './Tile.js';

export default class Road extends Tile {

    constructor(row, col, textureName) {
        super(row, col, textureName);
    }

    updateSelfBasedOnNeighbors(neighbors){
        let code = 'road_';

        const top = neighbors.top && neighbors.top instanceof Road ? 1 : 0;
        const bottom = neighbors.bottom && neighbors.bottom instanceof Road ? 1 : 0;
        const left = neighbors.left && neighbors.left instanceof Road? 1 : 0;
        const right = neighbors.right && neighbors.right instanceof Road ? 1 : 0;

        // If tile is originally horizontal
        if (this.textureName === 'road_0011') {
            code += `${top}${bottom}11`;
        } else if (this.textureName === 'road_1100') {
            code += `11${left}${right}`;
        }

        this.textureName = code;
    }
}