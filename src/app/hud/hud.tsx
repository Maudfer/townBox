import { FC, useEffect, useState } from 'react';

import Window from 'hud/Window';
import HouseDetails from 'hud/windows/HouseDetails';
import House from 'game/House';

import { HUDProps, WindowData, WindowTypes  } from 'types/HUD';

const windowMap = {
    [WindowTypes.HouseDetails]: HouseDetails,
    [WindowTypes.WorkplaceDetails]: null,
    [WindowTypes.PersonDetails]: null,
    [WindowTypes.VehicleDetails]: null,
    [WindowTypes.CityDetails]: null,
    [WindowTypes.GameOptions]: null,
    [WindowTypes.AvailableBuildings]: null,
};

const HUD: FC<HUDProps> = ({ game }) => {
    const [openWindows, setOpenWindows] = useState<WindowData[]>([]);

    game.on("HouseSelected", {callback: (house: House) => {
        // if a window of type HouseDetails is already open, close it first
        const existingWindow = openWindows.find(w => w.type === WindowTypes.HouseDetails);
        if (existingWindow) {
            const index = openWindows.indexOf(existingWindow);
            closeWindow(index);
        }

        const window = {
            type: WindowTypes.HouseDetails,
            data: house,
        };
        setOpenWindows([...openWindows, window]);
    }});

    function closeWindow(index: number) {
        const newWindows = [...openWindows];
        newWindows.splice(index, 1);
        setOpenWindows(newWindows);
    }

    useEffect(() => {
        console.log("HUD initialized", game);
    }, []);

    return (
        <div className="hud">
            {openWindows.map((window, index) => {
                const WindowComponent = windowMap[window.type];
                if (!WindowComponent) {
                    return null;
                }
                
                return (
                    <WindowComponent 
                        key={index}
                        game={game}
                        index={index}
                        data={window.data}
                        onClose={closeWindow}
                    />
                );
            })}

            <Window 
                game={game} 
                index={99}
                title={'test1'}
                onClose={closeWindow}
            >
                <p>
                    Game size: {game.gridParams.width}x{game.gridParams.height}
                </p>
                <p>
                    City: {game.city?.getName()}
                </p>
            </Window>
        </div>
    );
};

export default HUD;