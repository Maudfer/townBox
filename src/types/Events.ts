import Tile from 'app/Tile';
import Road from 'app/Road';
import Person from 'app/Person';

import { TilePosition, PixelPosition } from "types/Position";

export type UpdateEvent = {
    time: number;
    delta: number;
};

export type BuildEvent = {
    position: TilePosition;
    tool: string;
};

export interface EventPayloads {
    "sceneInitialized": Phaser.Scene;
    "update": UpdateEvent;
    "tileClicked": BuildEvent;
    "tileChanged": Tile;
    "personNeeded": PixelPosition;
    "personSpawned": Person;
    "roadBuilt": Road;
};