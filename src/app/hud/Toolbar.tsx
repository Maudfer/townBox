import React from 'react';
import Icon from '@mdi/react';
import { mdiCursorPointer, mdiOfficeBuildingPlus, mdiBulldozer, mdiContentSave, mdiCog } from '@mdi/js';

import { HUDProps } from 'types/HUD';

const Toolbar: React.FC<HUDProps> = ({ game }) => {

    return (
        <div className="toolbar glass">
            <button>
                <Icon path={mdiCursorPointer} size={2} />
            </button>

            <button>
                <Icon path={mdiOfficeBuildingPlus} size={2} />
            </button>

            <button>
                <Icon path={mdiBulldozer} size={2} />
            </button>

            <button title="Save game" onClick={() => game.emit("saveGameRequest")}>
                <Icon path={mdiContentSave} size={2} />
            </button>

            <button>
                <Icon path={mdiCog} size={2} />
            </button>
        </div>
    );
};

export default Toolbar;