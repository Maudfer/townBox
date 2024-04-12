import { NeighborMap } from 'types/Neighbor';
import { TilePosition } from 'types/Position';
import { Image } from 'types/Phaser';

export default class Tile {
    protected row: number;
    protected col: number;

    private asset: Image;
    private textureName: string | null;

    private debugText?: Phaser.GameObjects.Text;

    constructor(row: number, col: number, textureName: string | null) {
        this.row = row;
        this.col = col;
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

    getDebugText(): Phaser.GameObjects.Text | undefined {
        return this.debugText;
    }

    setDebugText(debugText: Phaser.GameObjects.Text): void {
        this.debugText = debugText;
    }

    updateSelfBasedOnNeighbors(_: NeighborMap): void { }

}