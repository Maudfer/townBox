export type Point = {
    x: number;
    y: number;
};

export type Curb = {
    topLeft: Point;
    topRight: Point;
    bottomLeft: Point;
    bottomRight: Point;
} | null;

export type Lane = {
    topLeft: Point;
    topRight: Point;
    bottomLeft: Point;
    bottomRight: Point;
} | null;