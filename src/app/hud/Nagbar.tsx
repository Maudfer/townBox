import { FC, useEffect, useState } from 'react';

import GameManager from 'game/GameManager';
import servicesConfig from 'json/services.json';
import { ServiceCoverage, ServicesConfig } from 'types/Services';
import { ServiceWarning, computeServiceWarnings, warningsKey } from 'util/services';

// The services nagbar (task 114): a persistent, dismissable top banner naming what the town lacks and
// what it costs — fed live by the daily coverage sweep (servicesChanged). Dismissal is per-service-SET
// (util/services.warningsKey): dismissing today's warnings holds until the set itself changes, so a NEW
// degrading service re-arms the banner. Clicking the text opens the Services window.

const SERVICES = servicesConfig as unknown as ServicesConfig;

interface NagbarProps {
    game: GameManager;
}

const Nagbar: FC<NagbarProps> = ({ game }) => {
    const [warnings, setWarnings] = useState<ServiceWarning[]>([]);
    const [dismissedKey, setDismissedKey] = useState<string | null>(null);

    useEffect(() => {
        game.on('servicesChanged', {
            callback: (lines: ServiceCoverage[]) => setWarnings(computeServiceWarnings(lines, SERVICES)),
        });
        return () => {
            game.off('servicesChanged');
        };
    }, [game]);

    const key = warningsKey(warnings);
    if (warnings.length === 0 || key === dismissedKey) {
        return null;
    }
    const worst = warnings[0]!;

    return (
        <div
            data-testid="services-nagbar"
            style={{
                position: 'fixed', top: 0, left: '50%', transform: 'translateX(-50%)',
                zIndex: 40, display: 'flex', alignItems: 'center', gap: 10,
                background: 'rgba(120, 30, 25, 0.92)', color: '#fff',
                padding: '6px 14px', borderRadius: '0 0 8px 8px', fontSize: 13,
                maxWidth: '70%', pointerEvents: 'auto',
            }}
        >
            <span
                data-testid="services-nagbar-text"
                style={{ cursor: 'pointer' }}
                onClick={() => game.emit('ServicesSelected', game.city)}
                title="Open the city services overview"
            >
                {worst.warning}
                {warnings.length > 1 && ` (+${warnings.length - 1} more service${warnings.length > 2 ? 's' : ''} struggling)`}
            </span>
            <button
                data-testid="services-nagbar-dismiss"
                onClick={() => setDismissedKey(key)}
                style={{ background: 'transparent', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
                title="Dismiss (returns if another service degrades)"
            >
                ✕
            </button>
        </div>
    );
};

export default Nagbar;
