import { TilePosition, PixelPosition } from "@/types/Position";
import { Tile } from '@/Tile';
import { Person } from '@/Person';

export type UpdateEvent = {
    time: number;
    delta: number;
};

export type BuildEvent = {
    position: TilePosition;
    tool: string;
};

export interface EventPayloads {
    "sceneInitialized": {};
    "update": UpdateEvent;
    "tileClicked": BuildEvent;
    "tileUpdated": Tile;
    "personNeeded": PixelPosition;
    "personSpawned": Person;
    "roadBuilt": TilePosition;
};