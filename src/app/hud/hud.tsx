import { FC, useEffect, useState } from 'react';

import HouseDetails from 'hud/windows/HouseDetails';
import House from 'game/House';

import { HUDProps, WindowData, WindowTypes, WindowPayload } from 'types/HUD';

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

    function openWindow(type: WindowTypes, data: WindowPayload, closeExisting: boolean = false) {
        if (closeExisting) {
            const existingWindow = openWindows.find(w => w.type === type);
            if (existingWindow) {
                const index = openWindows.indexOf(existingWindow);
                closeWindow(index);
            }
        }

        const window = {
            type,
            data,
        };
        setOpenWindows([...openWindows, window]);
    }

    function closeWindow(index: number) {
        console.log("Close", index);
        const newWindows = [...openWindows];
        newWindows.splice(index, 1);
        setOpenWindows(newWindows);
    }

    useEffect(() => {
        game.on("HouseSelected", {callback: (house: House) => {
            openWindow(WindowTypes.HouseDetails, house, true);
        }});

        return () => {
            game.off("HouseSelected");
        };
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

            {/*
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
            */}
        </div>
    );
};

export default HUD;