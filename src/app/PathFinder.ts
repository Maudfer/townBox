import Field from 'app/Field';
import Tile from 'app/Tile';
import Road from 'app/Road';

import { TilePosition } from 'types/Position';

export default class PathFinder {
    private field: Field;

    constructor(field: Field) {
        this.field = field;
    }

    findPath(start: TilePosition, goal: TilePosition): Tile[] {
        if(!start || !goal) {
            throw new Error(`[PathFinder] Invalid start or goal position: ${start}, ${goal}`);
        }

        const startingPositionKey = this.getKeyFromPosition(start);
        const openSet = new Set<string>([startingPositionKey]);
        const cameFrom = new Map<string, string>();

        const gScore = new Map<string, number>(); // For each node, the cost of getting from the start node to that node.
        gScore.set(startingPositionKey, 0);

        const fScore = new Map<string, number>(); // For each node, the total cost of getting from the start node to the goal.
        fScore.set(startingPositionKey, this.heuristic(start, goal));

        while (openSet.size > 0) {
            const currentPositionKey = [...openSet].reduce((a, b) => (fScore.get(a) ?? Infinity) < (fScore.get(b) ?? Infinity) ? a : b);
            const currentPosition = this.getPositionFromKey(currentPositionKey);
            if (!currentPosition) {
                throw new Error(`[PathFinder] Invalid position key: ${currentPositionKey}`);
            }

            if (currentPosition.row === goal.row && currentPosition.col === goal.col) {
                return this.reconstructPath(cameFrom, currentPositionKey);
            }

            openSet.delete(currentPositionKey);
            const neighbors = this.getValidNeighbors(currentPosition, goal);

            for (const neighbor of neighbors) {
                const tentativeGScore = (gScore.get(currentPositionKey) ?? Infinity) + 1; // Assume cost of 1 for moving from current to neighbor
                const neighborPositionKey = this.getKeyFromPosition(neighbor);

                if (tentativeGScore < (gScore.get(neighborPositionKey) ?? Infinity)) {
                    cameFrom.set(neighborPositionKey, currentPositionKey);
                    gScore.set(neighborPositionKey, tentativeGScore);
                    fScore.set(neighborPositionKey, tentativeGScore + this.heuristic(neighbor, goal));
                    openSet.add(neighborPositionKey);
                }
            }
        }

        return [];
    }

    private getKeyFromPosition(position: TilePosition): string {
        if (!position) {
            throw new Error(`[PathFinder] Invalid position: ${position}`);
        }
        return `${position.row}-${position.col}`;
    }

    private getPositionFromKey(key: string): TilePosition {
        const [row, col] = key.split('-').map(Number);
        if (row === undefined || col === undefined) { // Explicit undefined check because 0 is a valid value
            throw new Error(`[PathFinder] Invalid key: ${key}`);
        }

        return { row, col };
    }

    private heuristic(a: TilePosition, b: TilePosition): number {
        if (!a || !b) {
            throw new Error(`[PathFinder] Invalid positions: ${a}, ${b}`);
        }

        // Manhattan distance on a grid
        return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
    }

    private getValidNeighbors(position: TilePosition, destination: TilePosition): TilePosition[] {
        if (!position) {
            throw new Error(`[PathFinder] Invalid position: ${position}`);
        }

        const matrix = this.field.matrix;
        const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]]; // N, S, W, E

        const neighborPositions = directions.map(([dr, dc]) => {
            return { 
                row: (position.row + dr!), 
                col: (position.col + dc!) 
            };
        });

        const validNeighbors = neighborPositions.filter(neighbor => {
            if (!neighbor) {
                return false;
            }

            // TODO: handle grid edges
            const neighborTile = matrix[neighbor.row]![neighbor.col];
            if (!neighborTile || !destination) {
                return false;
            }

            const isValid = this.field.isValidPosition(neighbor.row, neighbor.col);
            const isRoad = (neighborTile instanceof Road);
            const isDestination = (neighbor.row === destination.row && neighbor.col === destination.col);

            return ( isValid && (isRoad || isDestination) );
        });

        if (!validNeighbors) {
            return [];
        }

        return validNeighbors;
    }

    private reconstructPath(cameFrom: Map<string, string>, currentKey: string): Tile[] {
        const path: Tile[] = [];
        while (cameFrom.has(currentKey)) {
            const currentPos = this.getPositionFromKey(currentKey);
            if (!currentPos) {
                throw new Error(`[PathFinder] Invalid position key: ${currentKey}`);
            }

            const tile = this.field.getTile(currentPos.row, currentPos.col);
            if (tile) {
                path.unshift(tile);
                currentKey = cameFrom.get(currentKey) ?? "";
            }
        }
        return path;
    }
}
