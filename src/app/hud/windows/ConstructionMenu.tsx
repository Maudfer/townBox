import React from 'react';

import Window from 'hud/Window';
import constructionConfig from 'json/construction.json';
import { Tool } from 'types/Cursor';
import { DetailsWindowProps } from 'types/HUD';

// The construction menu (task 108): a grid of placeable buildings. Picking one arms the placement cursor
// (constructionSelected → MainScene) with the entry's tool, pinned blueprint, and placeholder asset —
// civic buildings (colored squares, no art pass yet) can ONLY enter the world through this menu.

interface ConstructionEntry {
    id: string;
    label: string;
    tool: 'house' | 'work';
    blueprint?: string;
    color?: string;
}

const ENTRIES = (constructionConfig as { entries: ConstructionEntry[] }).entries;

const INITIAL_SIZE = { width: 380, height: 320 };



const ConstructionMenu: React.FC<DetailsWindowProps> = ({ game, index, z, onFocus, onClose }) => {
    const pick = (entry: ConstructionEntry): void => {
        game.emit('constructionSelected', {
            tool: entry.tool === 'house' ? Tool.House : Tool.Work,
            ...(entry.blueprint !== undefined ? { blueprintKey: entry.blueprint } : {}),
            ...(entry.color !== undefined ? { asset: `civic_${entry.id}` } : {}),
        });
        onClose?.(index);
    };

    return (
        <Window game={game} index={index} z={z} onFocus={onFocus} title="Construction" testId="window-construction" initialSize={INITIAL_SIZE} onClose={onClose}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, padding: 8 }} data-testid="construction-grid">
                {ENTRIES.map(entry => (
                    <button
                        key={entry.id}
                        data-testid={`construction-${entry.id}`}
                        onClick={() => pick(entry)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, cursor: 'pointer' }}
                    >
                        <span style={{
                            width: 24, height: 24, borderRadius: 3, flexShrink: 0,
                            background: entry.color ?? (entry.tool === 'house' ? '#c9a227' : '#7d8aa0'),
                            border: '1px solid rgba(0,0,0,0.4)',
                        }} />
                        <span>{entry.label}</span>
                    </button>
                ))}
            </div>
        </Window>
    );
};

export default ConstructionMenu;
