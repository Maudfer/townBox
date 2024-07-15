import GameManager from "game/GameManager";

import House from 'game/House';
import Workplace from 'game/Workplace';
import Person from 'game/Person';
import Vehicle from 'game/Vehicle';
import City from 'game/City';

export interface HUDProps {
    game: GameManager;
}

export interface WindowProps {
    game: GameManager;
    index: number;
    title?: string;
    children?: React.ReactNode;
    header?: React.ReactNode;
    footer?: React.ReactNode;
    onClose?: (index: number) => void;
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