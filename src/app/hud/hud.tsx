import { FC, useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

import Toolbar from 'hud/Toolbar';
import Toasts, { ToastItem, ToastType } from 'hud/Toasts';
import HouseDetails from 'hud/windows/HouseDetails';
import House from 'game/House';

import { HUDProps, WindowData, WindowTypes, WindowPayload } from 'types/HUD';

const TOAST_DURATION_MS = 3200;

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
    const [toasts, setToasts] = useState<ToastItem[]>([]);

    function pushToast(message: string, type: ToastType) {
        const id = uuidv4();
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(toast => toast.id !== id));
        }, TOAST_DURATION_MS);
    }

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

    useEffect(() => {
        // Toast feedback for save/load. Register listeners BEFORE signalling hudReady so a queued load (title or
        // auto-load) applied on hudReady never fires its toast before we are listening.
        game.on("gameSaved", { callback: () => pushToast('Game saved', 'success') });
        game.on("gameLoaded", { callback: () => pushToast('Game loaded', 'success') });
        game.on("saveFailed", { callback: (message: string) => pushToast(`Save failed: ${message}`, 'error') });
        game.on("loadFailed", { callback: (message: string) => pushToast(`Load failed: ${message}`, 'error') });

        // Ctrl/Cmd+S saves the game and suppresses the browser's save dialog.
        const onKeyDown = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && (event.key === 's' || event.key === 'S')) {
                event.preventDefault();
                game.emit("saveGameRequest");
            }
        };
        window.addEventListener('keydown', onKeyDown);

        game.emit("hudReady");

        return () => {
            game.off("gameSaved");
            game.off("gameLoaded");
            game.off("saveFailed");
            game.off("loadFailed");
            window.removeEventListener('keydown', onKeyDown);
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
                        key={uuidv4()}
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

            <Toolbar game={game} />
            <Toasts toasts={toasts} />
        </div>
    );
};

export default HUD;