import { FC, useEffect, useState } from 'react';

import Window from 'hud/Window';

import { DetailsWindowProps } from 'types/HUD';

const HouseDetails: FC<DetailsWindowProps> = ({game, index, data, onClose}) => {

    useEffect(() => {
        console.log("House details initialized", data, game);
    }, []);

    return (
        <Window
            game={game}
            index={index}
            title={'House details'}
            onClose={onClose}
        >
            <div className="house-details">
                <p>House details</p>
            </div>
        </Window>
    );
};

export default HouseDetails;