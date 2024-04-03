import Road from './Road.js';

export default class PathFinder {
    constructor(field) {
        this.field = field;
    }

    findPath(start, goal) {
        const startingPositionKey = this.getKeyFromPosition(start);

        const openSet = new Set([startingPositionKey]);
        const cameFrom = new Map();

        const gScore = new Map(); // For each node, the cost of getting from the start node to that node.
        gScore.set(startingPositionKey, 0);

        const fScore = new Map(); // For each node, the total cost of getting from the start node to the goal
        fScore.set(startingPositionKey, this.heuristic(start, goal));

        while (openSet.size > 0) {
            const currentPositionKey = [...openSet].reduce((a, b) => fScore.get(a) < fScore.get(b) ? a : b);
            const currentPosition = this.getPositionFromKey(currentPositionKey);

            if (currentPosition.row === goal.row && currentPosition.col === goal.col) {
                return this.reconstructPath(cameFrom, currentPositionKey);
            }
            openSet.delete(currentPositionKey);


            const neighbors = this.getValidNeighbors(currentPosition, goal);
            for (let neighbor of neighbors) {

                const tentativeGScore = gScore.get(currentPositionKey) + 1; // Assume cost of 1 for moving from current to neighbor
                const neighborPositionKey = this.getKeyFromPosition(neighbor);

                if (tentativeGScore < (gScore.get(neighborPositionKey) || Infinity)) {

                    if (neighborPositionKey !== startingPositionKey) {
                        cameFrom.set(neighborPositionKey, currentPositionKey);
                    }

                    gScore.set(neighborPositionKey, tentativeGScore);
                    fScore.set(neighborPositionKey, tentativeGScore + this.heuristic(neighbor, goal));
                    openSet.add(neighborPositionKey);
                }
            }
        }

        return [];
    }

    getKeyFromPosition(position) {
        return `${position.row}-${position.col}`;
    }

    getPositionFromKey(key) {
        const [row, col] = key.split('-').map(Number);
        return { row, col };
    }

    heuristic(a, b) {
        // Manhattan distance on a grid
        return ( Math.abs(a.row - b.row) + Math.abs(a.col - b.col) );
    }

    getValidNeighbors(pos, destination) {
        const matrix = this.field.matrix;
        const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]]; // N, S, W, E

        const neighborPositions = directions.map(([dr, dc]) => {
            return { 
                row: (pos.row + dr), 
                col: (pos.col + dc) 
            };
        });

        const validNeighbors = neighborPositions.filter(neighbor => {
            const isValid = this.field.isValidPosition(neighbor.row, neighbor.col);
            const isRoad = (matrix[neighbor.row][neighbor.col] instanceof Road);
            const isDestination = (neighbor.row === destination.row && neighbor.col === destination.col);

            return ( isValid && (isRoad || isDestination) );
        });

        return validNeighbors;
    }

    reconstructPath(cameFrom, current) {
        const path = [];
        while (cameFrom.has(current)) {
            const position = this.getPositionFromKey(current);
            const tile = this.field.getTile(position.row, position.col);
            
            path.unshift(tile);
            current = cameFrom.get(current);
        }
        return path;
    }
}