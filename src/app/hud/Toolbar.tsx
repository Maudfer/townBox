import React from 'react';
import Icon from '@mdi/react';
import { mdiCursorPointer, mdiOfficeBuildingPlus, mdiBulldozer, mdiCog } from '@mdi/js';

import { HUDProps } from 'types/HUD';

const Toolbar: React.FC<HUDProps> = (_props) => {

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

            <button>
                <Icon path={mdiCog} size={2} />
            </button>
        </div>
    );
};

export default Toolbar;