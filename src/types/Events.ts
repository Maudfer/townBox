import Tile from 'game/Tile';
import Road from 'game/Road';
import House from 'game/House';
import Person from 'game/Person';
import Vehicle from 'game/Vehicle';

import { TilePosition, PixelPosition } from "types/Position";
import { Tool } from "types/Cursor";
import { TimeChangedEvent, NewDayEvent } from "types/Time";
import GameManager from 'game/GameManager';

export type UpdateEvent = {
    time: number;
    timeDelta: number;
};

export type BuildEvent = {
    position: TilePosition;
    tool: Tool;
};
export interface EventPayloads {
    "sceneInitialized": Phaser.Scene;
    "gameInitialized": GameManager;
    "update": UpdateEvent;
    "tileClicked": BuildEvent;
    "personSpawnRequest": PixelPosition;
    "vehicleSpawnRequest": PixelPosition;
    "houseBuilt": House;
    "tileSpawned": Tile;
    "personSpawned": Person;
    "vehicleSpawned": Vehicle;
    "roadBuilt": Road;
    "windowDragStart": void;
    "windowDragStop": void;
    "HouseSelected": House;
    "hudReady": void;
    "saveGameRequest": void;
    "gameSaved": void;
    "saveFailed": string;
    "gameLoaded": void;
    "loadFailed": string;
    "timeChanged": TimeChangedEvent;
    "newDay": NewDayEvent;
};