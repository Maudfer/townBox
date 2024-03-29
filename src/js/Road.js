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

    getPossibleDirections(field) {
        // Get all neighboring tiles
        const neighbors = field.getNeighbors(this);
        
        // Initialize an array to hold possible directions
        let possibleDirections = [];

        // Check each neighbor to see if it's also a road
        if (neighbors.top instanceof Road) possibleDirections.push('up');
        if (neighbors.bottom instanceof Road) possibleDirections.push('down');
        if (neighbors.left instanceof Road) possibleDirections.push('left');
        if (neighbors.right instanceof Road) possibleDirections.push('right');

        return possibleDirections;
    }
}