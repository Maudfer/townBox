import { createRoot } from 'react-dom/client';

import GameManager from './game/GameManager';
import HUD from './hud/Hud';

function initializeUI(game: GameManager): void {
    const container = document.getElementById('hud-container');
    if (!container) {
        console.error("#hud-container:", container);
        throw new Error("HUD container not found, can't initialize application.");
    }

    const root = createRoot(container);
    root.render(<HUD game={game} />);
}

const main = () => {
    const game = new GameManager();
    game.on("gameInitialized", { callback: initializeUI, context: this });
}

document.addEventListener('DOMContentLoaded', main);