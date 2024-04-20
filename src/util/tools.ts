import { degreesToRadians } from 'util/math';

import { Direction } from 'types/Movement';

export function directionToRadianRotation(direction: Direction): number {
    if (direction === Direction.NULL) {
        throw new Error(`[Tools] Invalid direction: ${direction}`);
    }

    const directionRotationMap = {
        [Direction.North]: degreesToRadians(-90),
        [Direction.South]: degreesToRadians(90),
        [Direction.East]: degreesToRadians(0),
        [Direction.West]: degreesToRadians(180)
    };
    return directionRotationMap[direction];
}