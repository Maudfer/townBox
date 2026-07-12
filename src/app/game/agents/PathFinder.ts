import Field from 'game/world/Field';
import Road from 'game/world/Road';
import Tile from 'game/world/Tile';
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

        // The structure the search starts on. A traveller inside a building starts at its ANCHOR (every
        // footprint cell reports the anchor via getRow()/getCol()), whose four neighbors are all cells of
        // that same footprint — so without treating the start footprint as walkable, no path can ever LEAVE
        // a building (the commute-freezing regression introduced by the 3x3 footprint subdivision; the
        // legacy single-tile world had the road directly adjacent to the anchor).
        const startTile = this.field.getTile(start.row, start.col);
        const startIdentifier = startTile ? startTile.getIdentifier() : null;

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
            const neighbors = this.getValidNeighbors(currentPosition, goal, startIdentifier);

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

    private getValidNeighbors(position: TilePosition, destination: TilePosition, startIdentifier: string | null): TilePosition[] {
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

            // Bounds-check the row AND col before indexing the matrix. A neighbor off the top/bottom edge has
            // no row entry (matrix[-1] is undefined), so indexing it before this guard threw a TypeError.
            const isValid = this.field.isValidPosition(neighbor.row, neighbor.col);
            if (!isValid || !destination) {
                return false;
            }

            const neighborTile = matrix[neighbor.row]![neighbor.col];
            if (!neighborTile) {
                return false;
            }

            const isRoad = (neighborTile instanceof Road);
            // Every cell of the destination structure shares the same anchor identifier, so this lets A* step
            // through a building's footprint to reach its anchor cell from an adjacent road.
            const isDestination = (neighborTile.getIdentifier() === `${destination.row}-${destination.col}`);
            // Cells of the START structure's own footprint are walkable too, so a traveller can step out of
            // (or within) the building they are standing in — see the comment in findPath(). Soil is
            // unaffected: each soil cell is its own instance, so only the start cell itself matches.
            const isStartFootprint = (startIdentifier !== null && neighborTile.getIdentifier() === startIdentifier);

            return (isRoad || isDestination || isStartFootprint);
        });

        if (!validNeighbors) {
            return [];
        }

        return validNeighbors;
    }

    private reconstructPath(cameFrom: Map<string, string>, currentKey: string): Tile[] {
        const rawPath: Tile[] = [];
        while (cameFrom.has(currentKey)) {
            const currentPos = this.getPositionFromKey(currentKey);
            if (!currentPos) {
                throw new Error(`[PathFinder] Invalid position key: ${currentKey}`);
            }

            const tile = this.field.getTile(currentPos.row, currentPos.col);
            if (tile) {
                rawPath.unshift(tile);
                currentKey = cameFrom.get(currentKey) ?? "";
            }
        }

        // Cells belonging to the same footprint reference the same structure instance. Collapse consecutive
        // duplicates so movers step from footprint to footprint (using each structure's anchor) rather than
        // re-targeting the same footprint once per fine cell.
        const path: Tile[] = [];
        for (const tile of rawPath) {
            const previous = path[path.length - 1];
            if (previous !== tile) {
                path.push(tile);
            }
        }

        return path;
    }
}
