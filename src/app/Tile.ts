import { NeighborMap } from 'types/Neighbor';
import { PixelPosition, TilePosition } from 'types/Position';
import { Image } from 'types/Phaser';

export default class Tile {
    protected row: number;
    protected col: number;

    private center: PixelPosition;
    private asset: Image;
    private textureName: string | null;

    constructor(row: number, col: number, center: PixelPosition, textureName: string | null) {
        this.row = row;
        this.col = col;
        this.center = center;
        this.asset = null;
        this.textureName = textureName;
    }

    calculateDepth(): number {
        throw new Error("Base class Tile calculateDepth() called. This method should always be overridden.");
    }

    getRow(): number {
        return this.row;
    }

    getCol(): number {
        return this.col;
    }

    getPosition(): TilePosition {
        return { row: this.row, col: this.col };
    }

    getIdentifier(): string {
        return `${this.row}-${this.col}`;
    }

    getTextureName(): string | null {
        return this.textureName;
    }

    setTextureName(textureName: string | null): void {
        this.textureName = textureName;
    }

    getAsset(): Image {
        return this.asset;
    }

    setAsset(asset: Image): void {
        this.asset = asset;
    }

    getCenter(): PixelPosition {
        return this.center;
    }

    updateSelfBasedOnNeighbors(_: NeighborMap): void { }

}