import GameManager from "game/GameManager";

export interface HUDProps {
    game: GameManager;
}

export interface WindowProps {
    game: GameManager;
    title: string;
}