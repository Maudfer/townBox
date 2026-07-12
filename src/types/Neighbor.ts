import Tile from 'game/world/Tile';

export type Neighbor = Tile | null;

export interface NeighborMap {
    top: Neighbor;
    bottom: Neighbor;
    left: Neighbor;
    right: Neighbor;
}