import { RndResizeCallback } from 'react-rnd';

import GameManager from "game/GameManager";
import House from 'game/House';
import Workplace from 'game/Workplace';
import Person from 'game/Person';
import Vehicle from 'game/Vehicle';
import City from 'game/City';

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