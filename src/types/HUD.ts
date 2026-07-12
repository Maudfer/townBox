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
    onClose?: (index: number) => void;
    onResize?: RndResizeCallback;
}

export interface DetailsWindowProps extends WindowProps {
    data: WindowPayload;
}

export type WindowPayload = House | Workplace | Person | Vehicle | City;

export enum WindowTypes {
    "HouseDetails",
    "WorkplaceDetails",
    "PersonDetails",
    "VehicleDetails",
    "CityDetails",
    "GameOptions",
    "AvailableBuildings",
};

export type WindowData = {
    type: WindowTypes;
    data: WindowPayload;
};