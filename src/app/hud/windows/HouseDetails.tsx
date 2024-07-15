import { FC, useEffect } from 'react';

import Window from 'hud/Window';
import House from 'game/House';

import { DetailsWindowProps } from 'types/HUD';

const HouseDetails: FC<DetailsWindowProps> = ({game, index, data, onClose}) => {
    const house = data as House;
    const family = house?.getFamily();

    useEffect(() => {
        console.log("House details", data);
    }, []);

    return (
        <Window
            game={game}
            index={index}
            title={`${family?.familyName}'s House`}
            onClose={onClose}
        >
            <div className="house-details">
                <p>House details</p>
            </div>
        </Window>
    );
};

export default HouseDetails;