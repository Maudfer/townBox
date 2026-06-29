import { FC, useEffect, useState } from 'react';

import GameManager from 'game/GameManager';
import { Timestamp, TimeChangedEvent } from 'types/Time';
import { formatTimestamp } from 'util/time';

interface ClockProps {
    game: GameManager;
}

// A small persistent date/time widget. It seeds from the clock once and then updates purely from the
// `timeChanged` event bus signal (no polling of game internals), per the task's UI requirement.
const Clock: FC<ClockProps> = ({ game }) => {
    const [timestamp, setTimestamp] = useState<Timestamp | null>(game.clock?.getTimestamp() ?? null);

    useEffect(() => {
        game.on('timeChanged', {
            callback: (event: TimeChangedEvent) => setTimestamp(event.timestamp),
        });
        return () => {
            game.off('timeChanged');
        };
    }, []);

    if (!timestamp) {
        return null;
    }

    // Clicking the clock opens the city overview dashboard (task 031).
    return (
        <div
            className="clock-widget glass"
            style={{ cursor: 'pointer' }}
            title="Open city overview"
            onClick={() => game.emit('CitySelected', game.city)}
        >
            {formatTimestamp(timestamp)}
        </div>
    );
};

export default Clock;
