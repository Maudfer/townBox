import { NeighborMap } from 'types/Neighbor';
import { TilePosition } from 'types/Position';
import { Image } from 'types/Phaser';
import { Direction } from 'types/Movement';

export default class Tile {
    protected row: number;
    protected col: number;

    private asset: Image;
    private assetName: string | null;

    private debugText?: Phaser.GameObjects.Text;

    constructor(row: number, col: number, assetName: string | null) {
        this.row = row;
        this.col = col;
        this.asset = null;
        this.assetName = assetName;
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

    getRelativeDirection(otherTile: Tile): Direction {
        if (this.row === otherTile.getRow()) {
            if (this.col < otherTile.getCol()) {
                return Direction.East;
            } else {
                return Direction.West;
            }
        } else {
            if (this.row < otherTile.getRow()) {
                return Direction.South;
            } else {
                return Direction.North;
            }
        }
    }

    getPosition(): TilePosition {
        return { row: this.row, col: this.col };
    }

    getIdentifier(): string {
        return `${this.row}-${this.col}`;
    }

    getAssetName(): string | null {
        return this.assetName;
    }

    setAssetName(assetName: string): void {
        this.assetName = assetName;
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