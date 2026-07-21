import { FC, useEffect, useState } from 'react';

import City from 'game/City';
import Window from 'hud/Window';
import constructionConfig from 'json/construction.json';
import servicesConfig from 'json/services.json';
import { Tool } from 'types/Cursor';
import { DetailsWindowProps } from 'types/HUD';
import { ServicesConfig } from 'types/Services';

// The Services window (task 114): the 096 dashboard panel promoted to its own window — one row per
// service line (ratio, providers, facilities) plus WHAT TO BUILD: the construction-menu entries whose
// blueprints host the service, derived from construction.json (never hand-duplicated). Clicking a build
// button arms the placement cursor exactly like the construction menu does.

const SERVICES = servicesConfig as unknown as ServicesConfig;

interface ConstructionEntry {
    id: string;
    label: string;
    tool: 'house' | 'work';
    blueprint?: string;
    color?: string;
}

const CONSTRUCTION_ENTRIES = (constructionConfig as { entries: ConstructionEntry[] }).entries;

const INITIAL_SIZE = { width: 380, height: 420 };
const REFRESH_MS = 2000;

function buildEntriesFor(service: string): ConstructionEntry[] {
    const facilities = SERVICES.services[service]?.facilityBlueprints ?? [];
    return CONSTRUCTION_ENTRIES.filter(entry => entry.blueprint !== undefined && facilities.includes(entry.blueprint));
}

const ServicesDetails: FC<DetailsWindowProps> = ({ game, index, data, z, onFocus, onClose }) => {
    const city = data as City;
    const [lines, setLines] = useState(() => city?.getCityStats().services ?? []);

    useEffect(() => {
        const id = setInterval(() => setLines(city?.getCityStats().services ?? []), REFRESH_MS);
        return () => clearInterval(id);
    }, [city]);

    if (!city) {
        return null;
    }

    const build = (entry: ConstructionEntry): void => {
        game.emit('constructionSelected', {
            tool: entry.tool === 'house' ? Tool.House : Tool.Work,
            ...(entry.blueprint !== undefined ? { blueprintKey: entry.blueprint } : {}),
            ...(entry.color !== undefined ? { asset: `civic_${entry.id}` } : {}),
        });
        onClose?.(index);
    };

    return (
        <Window game={game} index={index} z={z} onFocus={onFocus} title="City services" testId="window-services" initialSize={INITIAL_SIZE} onClose={onClose}>
            <div style={{ padding: '4px 10px' }} data-testid="services-rows">
                {lines.length === 0 && <p>The coverage ledger has not measured the town yet.</p>}
                {lines.map(line => {
                    const critical = line.ratio < SERVICES.advisoryBelow;
                    return (
                        <section key={line.service} data-testid={`service-row-${line.service}`} style={{ marginBottom: 10 }}>
                            <h4 style={{ margin: '4px 0', color: critical ? '#c0392b' : undefined }}>
                                {line.label}: {(line.ratio * 100).toFixed(0)}%
                            </h4>
                            <div style={{ fontSize: 12 }}>
                                {line.facilities === 0
                                    ? 'No facility'
                                    : `${line.providers} provider${line.providers === 1 ? '' : 's'} · ${line.facilities} facilit${line.facilities === 1 ? 'y' : 'ies'} · ${line.needed} needed`}
                                {critical && SERVICES.services[line.service] && (
                                    <div style={{ color: '#c0392b', marginTop: 2 }}>{SERVICES.services[line.service]!.warning}</div>
                                )}
                            </div>
                            {buildEntriesFor(line.service).length > 0 && (
                                <div style={{ marginTop: 4, display: 'flex', gap: 6 }}>
                                    {buildEntriesFor(line.service).map(entry => (
                                        <button key={entry.id} data-testid={`services-build-${entry.id}`} onClick={() => build(entry)} style={{ cursor: 'pointer' }}>
                                            Build: {entry.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </section>
                    );
                })}
            </div>
        </Window>
    );
};

export default ServicesDetails;
