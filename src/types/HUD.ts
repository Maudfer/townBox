import { RndResizeCallback } from 'react-rnd';

import City from 'game/City';
import GameManager from "game/GameManager";
import Person from 'game/agents/Person';
import Vehicle from 'game/agents/Vehicle';
import House from 'game/world/House';
import Workplace from 'game/world/Workplace';

export interface HUDProps {
    game: GameManager;
}

export interface WindowSize {
    width: number;
    height: number;
}

export interface WindowProps {
    game: GameManager;
    index: number;
    title?: string;
    // Stable selector for the integration tests (task 008), e.g. "window-person". Applied to the window root.
    testId?: string;
    children?: React.ReactNode;
    header?: React.ReactNode;
    footer?: React.ReactNode;
    initialSize?: WindowSize;
    // Stacking order + focus (task 131 follow-up #2): the HUD assigns each window a z; interacting with a
    // window (click or drag) calls onFocus to bring it to the front.
    z?: number;
    onFocus?: () => void;
    onClose?: (index: number) => void;
    onResize?: RndResizeCallback;
}

export interface DetailsWindowProps extends WindowProps {
    data: WindowPayload;
}

// null = an entity-less window (the construction menu, task 108).
export type WindowPayload = House | Workplace | Person | Vehicle | City | null;

export enum WindowTypes {
    "HouseDetails",
    "WorkplaceDetails",
    "PersonDetails",
    "VehicleDetails",
    "CityDetails",
    "GameOptions",
    "AvailableBuildings",
    "ConstructionMenu",
    "ServicesDetails",
};

export type WindowData = {
    id: string;   // stable React key + focus handle (task 131 follow-up #2)
    z: number;    // stacking order — higher is in front
    type: WindowTypes;
    data: WindowPayload;
};