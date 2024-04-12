import Tile from 'app/Tile';

export type Neighbor = Tile | null;

export interface NeighborMap {
    top: Neighbor;
    bottom: Neighbor;
    left: Neighbor;
    right: Neighbor;
}