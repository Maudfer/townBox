import { FC } from 'react';

import Window from 'hud/Window';

import { HUDProps } from 'types/HUD';

const HUD: FC<HUDProps> = ({ game }) => {
    console.log("HUD initialized", game);

    return (
        <div className="hud">
            <Window game={game} title={'test1'} />
            <Window game={game} title={'test2'} />
        </div>
    );
};

export default HUD;