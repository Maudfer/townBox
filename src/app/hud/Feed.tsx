import { FC, useEffect, useRef, useState } from 'react';

import GameManager from 'game/GameManager';
import { getFollowed, subscribeFollow } from 'hud/followStore';
import { CityEvent } from 'types/Events';
import { formatTick } from 'util/time';

const MAX_ENTRIES = 60;
const FOLLOW_POLL_MS = 1500;

interface FeedProps {
    game: GameManager;
}

// A persistent, collapsible panel that streams notable city happenings (births, deaths, marriages, hires,
// layoffs, illness) as they occur (task 029). Fed purely by the `cityEvent` bus signal; clicking an entry with
// a subject opens that person's inspector. Capped to the most recent MAX_ENTRIES.
//
// Task 081 (proposal J4): kind filter chips over whatever kinds are present, plus "followed people" — the
// feed polls followed residents' life logs (read-only engine accessors) and streams their entries as
// `follow`-kind items, turning the feed into a serialized-novel view for the lives the player cares about.
const Feed: FC<FeedProps> = ({ game }) => {
    const [events, setEvents] = useState<CityEvent[]>([]);
    const [followEvents, setFollowEvents] = useState<CityEvent[]>([]);
    const [collapsed, setCollapsed] = useState(false);
    // Active kind filters; empty set = show everything.
    const [activeKinds, setActiveKinds] = useState<Set<string>>(new Set());
    // Per-person high-water mark so each poll only emits NEW log entries (initialized to the current end of
    // log at follow time — following someone doesn't dump their whole history into the feed).
    const lastSeenSeq = useRef(new Map<string, number>());

    useEffect(() => {
        // `cityEvent` has only this HUD handler, so game.off is safe on unmount.
        game.on('cityEvent', {
            callback: (event: CityEvent) => setEvents(prev => [event, ...prev].slice(0, MAX_ENTRIES)),
        });
        return () => game.off('cityEvent');
    }, [game]);

    useEffect(() => {
        const poll = (): void => {
            const followed = getFollowed();
            const seen = lastSeenSeq.current;
            for (const id of [...seen.keys()]) {
                if (!followed.some(person => person.personId === id)) {
                    seen.delete(id); // unfollowed — forget the mark so a re-follow starts fresh
                }
            }
            const fresh: CityEvent[] = [];
            for (const { personId, name } of followed) {
                const log = game.eventEngine?.getPersonLog(personId) ?? [];
                const mark = seen.get(personId);
                if (mark === undefined) {
                    seen.set(personId, log[log.length - 1]?.seq ?? 0);
                    continue;
                }
                for (const entry of log) {
                    if (entry.seq <= mark) {
                        continue;
                    }
                    if (entry.kind === 'action' && entry.lifecycle !== 'performed' && entry.lifecycle !== 'completed') {
                        continue; // starts/blocks are noise; completions and discretes tell the story
                    }
                    const label = entry.kind === 'action'
                        ? game.actionEngine?.getActionLabel(entry.defId) ?? entry.defId
                        : game.eventEngine?.getEventLabel(entry.defId) ?? entry.defId;
                    fresh.push({ kind: 'follow', message: `${name} — ${label}`, tick: entry.tick, person: null });
                }
                seen.set(personId, log[log.length - 1]?.seq ?? mark);
            }
            if (fresh.length > 0) {
                setFollowEvents(prev => [...fresh.reverse(), ...prev].slice(0, MAX_ENTRIES));
            }
        };
        const id = setInterval(poll, FOLLOW_POLL_MS);
        const unsubscribe = subscribeFollow(poll);
        return () => {
            clearInterval(id);
            unsubscribe();
        };
    }, [game]);

    const merged = [...events, ...followEvents].sort((a, b) => b.tick - a.tick).slice(0, MAX_ENTRIES);
    const presentKinds = [...new Set(merged.map(event => event.kind))].sort();
    const visible = activeKinds.size === 0 ? merged : merged.filter(event => activeKinds.has(event.kind));

    const toggleKind = (kind: string): void => {
        setActiveKinds(prev => {
            const next = new Set(prev);
            if (next.has(kind)) {
                next.delete(kind);
            } else {
                next.add(kind);
            }
            return next;
        });
    };

    return (
        <div className="city-feed glass" data-testid="city-feed">
            <div className="city-feed-header" data-testid="city-feed-header" onClick={() => setCollapsed(value => !value)}>
                <span>City Feed</span>
                <span>{collapsed ? '▴' : '▾'}</span>
            </div>
            {!collapsed && presentKinds.length > 1 && (
                <div data-testid="city-feed-filters" style={{ display: 'flex', flexWrap: 'wrap', gap: 3, padding: '2px 6px' }}>
                    {presentKinds.map(kind => (
                        <span
                            key={kind}
                            data-testid={`feed-filter-${kind}`}
                            onClick={() => toggleKind(kind)}
                            style={{
                                fontSize: 10, padding: '1px 6px', borderRadius: 8, cursor: 'pointer',
                                border: '1px solid rgba(127,127,127,0.5)',
                                opacity: activeKinds.size === 0 || activeKinds.has(kind) ? 1 : 0.45,
                            }}
                        >
                            {kind}
                        </span>
                    ))}
                </div>
            )}
            {!collapsed && (
                <div className="city-feed-list" data-testid="city-feed-list">
                    {visible.length === 0 ? (
                        <div className="city-feed-empty">No news yet…</div>
                    ) : (
                        visible.map((event, index) => (
                            <div
                                key={index}
                                data-testid="city-feed-entry"
                                className={`city-feed-entry${event.person ? ' clickable' : ''}${event.kind === 'follow' ? ' followed' : ''}`}
                                onClick={() => event.person && game.emit('PersonSelected', event.person)}
                            >
                                <span className="city-feed-date">{formatTick(event.tick)}</span> {event.message}
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
};

export default Feed;
