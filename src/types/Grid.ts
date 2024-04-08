import Phaser from 'phaser';

export interface FieldParams {
    rows: number;
    cols: number;
}

export interface ScreenParams {
    width: number;
    height: number;
}

export interface CellParams {
    width: number;
    height: number;
}

export interface GridParams {
    width: number;
    height: number;
    rows: number;
    cols: number;
    gridX: number;
    gridY: number;
    cells: CellParams;
    bounds?: Phaser.Geom.Rectangle;
}