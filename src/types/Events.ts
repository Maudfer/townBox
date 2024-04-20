import Tile from 'app/Tile';
import Road from 'app/Road';
import Person from 'app/Person';
import Vehicle from 'app/Vehicle';

import { TilePosition, PixelPosition } from "types/Position";

export type UpdateEvent = {
    time: number;
    timeDelta: number;
};

export type BuildEvent = {
    position: TilePosition;
    tool: string;
};

export interface EventPayloads {
    "sceneInitialized": Phaser.Scene;
    "update": UpdateEvent;
    "tileClicked": BuildEvent;
    "personNeeded": PixelPosition;
    "vehicleNeeded": PixelPosition;
    "tileSpawned": Tile;
    "personSpawned": Person;
    "vehicleSpawned": Vehicle;
    "roadBuilt": Road;
};