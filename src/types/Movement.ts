import { PixelPosition } from 'types/Position';

export enum Direction {
    North = 'N',
    East = 'E',
    South = 'S',
    West = 'W',
    NULL = 0
}

export type Curb = {
    topLeft: PixelPosition;
    topRight: PixelPosition;
    bottomLeft: PixelPosition;
    bottomRight: PixelPosition;
} | null;

export type Lane = {
    topLeft: PixelPosition;
    topRight: PixelPosition;
    bottomLeft: PixelPosition;
    bottomRight: PixelPosition;
} | null;