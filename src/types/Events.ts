import Tile from 'app/Tile';
import Road from 'app/Road';
import House from 'app/House';
import Person from 'app/Person';
import Vehicle from 'app/Vehicle';

import { TilePosition, PixelPosition } from "types/Position";
import { Tool } from "types/Cursor";

export type UpdateEvent = {
    time: number;
    timeDelta: number;
};

export type BuildEvent = {
    position: TilePosition;
    tool: Tool;
};

/*
export type CitizenEvent = {
    position: PixelPosition;
    home: House;
};

export type CarEvent = {
    position: PixelPosition;
    home: House;
    owner: Person;
};
*/

export interface EventPayloads {
    "sceneInitialized": Phaser.Scene;
    "update": UpdateEvent;
    "tileClicked": BuildEvent;
    "personSpawnRequest": PixelPosition;
    "vehicleSpawnRequest": PixelPosition;
    "houseBuilt": House;
    "tileSpawned": Tile;
    "personSpawned": Person;
    "vehicleSpawned": Vehicle;
    "roadBuilt": Road;
};