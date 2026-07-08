import { FC, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import GameManager from './game/GameManager';
import HUD from './hud/Hud';

// Root React tree: the HUD mounts once the game is initialized. A new game no longer runs a loading-screen
// history bootstrap (task 055 retired it) — it selects a slice of the offline history asset instead, which is
// fast, so `gameInitialized` fires without a wait.
const App: FC<{ game: GameManager }> = ({ game }) => {
    const [ready, setReady] = useState(false);

    useEffect(() => {
        game.on('gameInitialized', { callback: () => setReady(true) });
        return () => game.off('gameInitialized');
    }, []);

    return ready ? <HUD game={game} /> : null;
};

const main = () => {
    const container = document.getElementById('hud-container');
    if (!container) {
        console.error("#hud-container:", container);
        throw new Error("HUD container not found, can't initialize application.");
    }

    const game = new GameManager();
    createRoot(container).render(<App game={game} />);
};

document.addEventListener('DOMContentLoaded', main);
