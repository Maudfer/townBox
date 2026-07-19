import { FC, useEffect, useState } from 'react';

import GameManager from 'game/GameManager';
import { PAUSE_TIME_SCALE, TIME_SCALES } from 'util/time';

// The time toolbar (W10 / proposal simulation-aliveness-3): a small floating strip, top-right — Pause,
// Play (1×), double-chevron (4×), triple-chevron (8×). Talks to the game ONLY through the bus (§4.9):
// buttons emit `setTimeScale`; the active highlight follows `timeScaleChanged` (so the debug T key and
// any other setter stay in sync with the toolbar).

interface TimeControlsProps {
    game: GameManager;
}

const BUTTONS: { scale: number; label: string; title: string }[] = [
    { scale: PAUSE_TIME_SCALE, label: '⏸', title: 'Pause' },
    { scale: TIME_SCALES[0]!, label: '▶', title: 'Normal speed' },
    { scale: TIME_SCALES[1]!, label: '▶▶', title: `${TIME_SCALES[1]}× speed` },
    { scale: TIME_SCALES[2]!, label: '▶▶▶', title: `${TIME_SCALES[2]}× speed` },
];

const TimeControls: FC<TimeControlsProps> = ({ game }) => {
    const [activeScale, setActiveScale] = useState<number>(game.getTimeScale());

    useEffect(() => {
        game.on('timeScaleChanged', { callback: (scale: number) => setActiveScale(scale) });
        return () => game.off('timeScaleChanged');
    }, [game]);

    return (
        <div className="time-controls" data-testid="time-controls">
            {BUTTONS.map(button => (
                <button
                    key={button.scale}
                    type="button"
                    title={button.title}
                    className={`time-controls-button${activeScale === button.scale ? ' active' : ''}`}
                    onClick={() => game.emit('setTimeScale', button.scale)}
                >
                    {button.label}
                </button>
            ))}
        </div>
    );
};

export default TimeControls;
