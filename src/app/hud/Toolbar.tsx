import {
    mdiCursorDefault,
    mdiRoadVariant,
    mdiHomeCity,
    mdiBulldozer,
    mdiContentSave,
} from '@mdi/js';
import Icon from '@mdi/react';
import React, { useEffect, useState } from 'react';

import { Tool } from 'types/Cursor';
import { HUDProps } from 'types/HUD';

// Toolbar buttons select tools by emitting the `toolSelected` bus event (task 030); MainScene consumes it,
// and the F1–F6 keys emit the same event, so keyboard and toolbar stay in sync. The active tool is tracked
// by listening to `toolSelected` and highlighted.
// Consolidated toolbar (task 108): House/Work/Soil are gone — Construction opens the building menu (which
// arms placement), and Bulldoze alone reverts ANY tile to grass with the coherent logical teardown.
const TOOL_BUTTONS: { tool: Tool; icon: string; label: string }[] = [
    { tool: Tool.Select, icon: mdiCursorDefault, label: 'Select / Inspect (F1)' },
    { tool: Tool.Road, icon: mdiRoadVariant, label: 'Road (F2)' },
    { tool: Tool.Construction, icon: mdiHomeCity, label: 'Construction (F3)' },
    { tool: Tool.Bulldoze, icon: mdiBulldozer, label: 'Bulldoze (F4)' },
];

const Toolbar: React.FC<HUDProps> = ({ game }) => {
    const [activeTool, setActiveTool] = useState<Tool>(Tool.Road); // matches MainScene's initial cursor

    useEffect(() => {
        game.on('toolSelected', { callback: (tool: Tool) => setActiveTool(tool) });
        return () => game.off('toolSelected');
    }, [game]);

    return (
        <div className="toolbar glass" data-testid="toolbar">
            {TOOL_BUTTONS.map(({ tool, icon, label }) => (
                <button
                    key={tool}
                    title={label}
                    data-testid={`tool-${tool}`}
                    data-active={activeTool === tool}
                    className={activeTool === tool ? 'active' : ''}
                    onClick={() => game.emit('toolSelected', tool)}
                >
                    <Icon path={icon} size={2} />
                </button>
            ))}

            <button title="Save game (Ctrl+S)" data-testid="tool-save" onClick={() => game.emit('saveGameRequest')}>
                <Icon path={mdiContentSave} size={2} />
            </button>
        </div>
    );
};

export default Toolbar;
