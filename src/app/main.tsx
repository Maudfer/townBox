import { FC, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import GameManager from './game/GameManager';
import HUD from './hud/Hud';
import BootstrapLoader from './hud/BootstrapLoader';

// Root React tree: the bootstrap loading overlay is always mounted (it self-hides unless the pre-game history
// bootstrap is running, task 036), and the HUD mounts once the game is initialized — which, on a fresh game,
// is after the bootstrap finishes.
const App: FC<{ game: GameManager }> = ({ game }) => {
    const [ready, setReady] = useState(false);

    useEffect(() => {
        game.on('gameInitialized', { callback: () => setReady(true) });
        return () => game.off('gameInitialized');
    }, []);

    return (
        <>
            <BootstrapLoader game={game} />
            {ready && <HUD game={game} />}
        </>
    );
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
