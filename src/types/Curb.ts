export type CurbPoint = {
    x: number;
    y: number;
};

export type Curb = {
    topLeft: CurbPoint;
    topRight: CurbPoint;
    bottomLeft: CurbPoint;
    bottomRight: CurbPoint;
} | null;