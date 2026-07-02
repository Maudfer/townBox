import { FC, useEffect, useState } from 'react';

import GameManager from 'game/GameManager';
import { BootstrapProgress } from 'game/HistoryBootstrap';

// Full-screen loading overlay shown while the pre-game history bootstrap (task 036) runs in its Web Worker.
// Purely event-driven off the GameManager bus (bootstrapStarted/Progress/Finished) — no polling. Absent on
// loads (the bootstrap is skipped) and after it finishes, at which point the HUD mounts.
const BootstrapLoader: FC<{ game: GameManager }> = ({ game }) => {
    const [active, setActive] = useState(false);
    const [progress, setProgress] = useState<BootstrapProgress | null>(null);

    useEffect(() => {
        game.on('bootstrapStarted', { callback: () => setActive(true) });
        game.on('bootstrapProgress', { callback: (value: BootstrapProgress) => setProgress(value) });
        game.on('bootstrapFinished', { callback: () => setActive(false) });
        return () => {
            game.off('bootstrapStarted');
            game.off('bootstrapProgress');
            game.off('bootstrapFinished');
        };
    }, []);

    if (!active) {
        return null;
    }

    const pct = progress ? Math.min(100, Math.round((progress.yearsDone / Math.max(1, progress.yearsTotal)) * 100)) : 0;

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(12, 16, 24, 0.92)', color: '#e8ecf2', fontFamily: 'sans-serif' }}>
            <div style={{ textAlign: 'center', width: 'min(80vw, 420px)' }}>
                <h2 style={{ margin: '0 0 8px', fontWeight: 600 }}>Simulating history…</h2>
                <p style={{ margin: '0 0 16px', opacity: 0.8 }}>
                    {progress
                        ? `Year ${progress.yearsDone} of ${progress.yearsTotal} · ${progress.living.toLocaleString()} living`
                        : 'Preparing the founding families…'}
                </p>
                <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: '#5db0ff', transition: 'width 120ms linear' }} />
                </div>
            </div>
        </div>
    );
};

export default BootstrapLoader;
