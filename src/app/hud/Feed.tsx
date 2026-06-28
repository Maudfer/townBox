import { FC, useEffect, useState } from 'react';

import GameManager from 'game/GameManager';
import { CityEvent } from 'types/Events';
import { formatDay } from 'util/time';

const MAX_ENTRIES = 60;

interface FeedProps {
    game: GameManager;
}

// A persistent, collapsible panel that streams notable city happenings (births, deaths, marriages, hires,
// layoffs, illness) as they occur (task 029). Fed purely by the `cityEvent` bus signal; clicking an entry with
// a subject opens that person's inspector. Capped to the most recent MAX_ENTRIES.
const Feed: FC<FeedProps> = ({ game }) => {
    const [events, setEvents] = useState<CityEvent[]>([]);
    const [collapsed, setCollapsed] = useState(false);

    useEffect(() => {
        // `cityEvent` has only this HUD handler, so game.off is safe on unmount.
        game.on('cityEvent', {
            callback: (event: CityEvent) => setEvents(prev => [event, ...prev].slice(0, MAX_ENTRIES)),
        });
        return () => game.off('cityEvent');
    }, []);

    return (
        <div className="city-feed glass">
            <div className="city-feed-header" onClick={() => setCollapsed(value => !value)}>
                <span>City Feed</span>
                <span>{collapsed ? '▴' : '▾'}</span>
            </div>
            {!collapsed && (
                <div className="city-feed-list">
                    {events.length === 0 ? (
                        <div className="city-feed-empty">No news yet…</div>
                    ) : (
                        events.map((event, index) => (
                            <div
                                key={index}
                                className={`city-feed-entry${event.person ? ' clickable' : ''}`}
                                onClick={() => event.person && game.emit('PersonSelected', event.person)}
                            >
                                <span className="city-feed-date">{formatDay(event.tick)}</span> {event.message}
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
};

export default Feed;
