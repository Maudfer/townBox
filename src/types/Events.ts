import GameManager from 'game/GameManager';
import Person from 'game/agents/Person';
import Vehicle from 'game/agents/Vehicle';
import House from 'game/world/House';
import Road from 'game/world/Road';
import Tile from 'game/world/Tile';
import Workplace from 'game/world/Workplace';
import { Tool } from "types/Cursor";
import { TilePosition, PixelPosition } from "types/Position";
import { TimeChangedEvent, NewTickEvent, NewDayEvent } from "types/Time";

export type UpdateEvent = {
    time: number;
    timeDelta: number;
};

export type BuildEvent = {
    position: TilePosition;
    tool: Tool;
    // Construction-menu picks (task 108): pin the business blueprint and/or a placeholder asset.
    blueprintKey?: string;
    asset?: string;
};

// A construction-menu selection (task 108): arms the placement cursor with the chosen building.
export type ConstructionPick = {
    tool: Tool;
    blueprintKey?: string;
    asset?: string;
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
    "constructionSelected": ConstructionPick;
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
    "newTick": NewTickEvent;
    "newDay": NewDayEvent;
    "cityEvent": CityEvent;
};