import Tile from './Tile.js';

export default class Building extends Tile {
    constructor(row, col, center, textureName) {
        super(row, col, center, textureName);
    }
}