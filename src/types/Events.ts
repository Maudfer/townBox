import Tile from 'game/Tile';
import Road from 'game/Road';
import House from 'game/House';
import Workplace from 'game/Workplace';
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

// A notable city happening surfaced to the HUD feed (task 029). `person` (when set) is the materialized
// subject, so a feed entry can open that person's inspector on click. `tick` dates the entry.
export type CityEvent = {
    kind: string;
    tick: number;
    message: string;
    person: Person | null;
};
export interface EventPayloads {
    "sceneInitialized": Phaser.Scene;
    "gameInitialized": GameManager;
    "update": UpdateEvent;
    "tileClicked": BuildEvent;
    "toolSelected": Tool;
    "personSpawnRequest": PixelPosition;
    "vehicleSpawnRequest": PixelPosition;
    "houseBuilt": House;
    "workplaceBuilt": Workplace;
    "tileSpawned": Tile;
    "personSpawned": Person;
    "vehicleSpawned": Vehicle;
    "roadBuilt": Road;
    "windowDragStart": void;
    "windowDragStop": void;
    "HouseSelected": House;
    "PersonSelected": Person;
    "WorkplaceSelected": Workplace;
    "CitySelected": GameManager["city"];
    "hudReady": void;
    "saveGameRequest": void;
    "gameSaved": void;
    "saveFailed": string;
    "gameLoaded": void;
    "loadFailed": string;
    "timeChanged": TimeChangedEvent;
    "newDay": NewDayEvent;
    "cityEvent": CityEvent;
};