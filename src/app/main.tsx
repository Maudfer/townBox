import { createRoot } from 'react-dom/client';

import GameManager from './game/GameManager';
import HUD from './hud/Hud';

const main = () => {
    const game = new GameManager();

    const container = document.getElementById('hud-container');
    if (!container) {
        console.error("#hud-container:", container);
        throw new Error("HUD container not found, can't initialize application.");
    }

    const root = createRoot(container);
    root.render(<HUD game={game} />);
}
document.addEventListener('DOMContentLoaded', main);