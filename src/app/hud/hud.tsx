import { FC, useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

import Toolbar from 'hud/Toolbar';
import Toasts, { ToastItem, ToastType } from 'hud/Toasts';
import Clock from 'hud/Clock';
import HouseDetails from 'hud/windows/HouseDetails';
import PersonDetails from 'hud/windows/PersonDetails';
import House from 'game/House';
import Person from 'game/Person';
import Workplace from 'game/Workplace';

import { HUDProps, WindowData, WindowTypes, WindowPayload } from 'types/HUD';

const TOAST_DURATION_MS = 3200;

// How a newly requested window reconciles with already-open ones.
type OpenMode = 'append' | 'replaceType' | 'dedupeData';

const windowMap = {
    [WindowTypes.HouseDetails]: HouseDetails,
    [WindowTypes.WorkplaceDetails]: null,
    [WindowTypes.PersonDetails]: PersonDetails,
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

    // Functional updates so handlers registered once (in effects) never act on a stale window list.
    // - replaceType: at most one window of this type (e.g. the house tree) — used for singletons.
    // - dedupeData: allow many of this type but not the same entity twice (e.g. several person windows).
    function openWindow(type: WindowTypes, data: WindowPayload, mode: OpenMode = 'append') {
        setOpenWindows(prev => {
            if (mode === 'replaceType') {
                return [...prev.filter(w => w.type !== type), { type, data }];
            }
            if (mode === 'dedupeData' && prev.some(w => w.type === type && w.data === data)) {
                return prev;
            }
            return [...prev, { type, data }];
        });
    }

    function closeWindow(index: number) {
        setOpenWindows(prev => prev.filter((_, i) => i !== index));
    }

    useEffect(() => {
        // Selection events are HUD-only (no game-side handler), so game.off here is safe.
        game.on("HouseSelected", { callback: (house: House) => openWindow(WindowTypes.HouseDetails, house, 'replaceType') });
        game.on("PersonSelected", { callback: (person: Person) => openWindow(WindowTypes.PersonDetails, person, 'dedupeData') });
        game.on("WorkplaceSelected", { callback: (workplace: Workplace) => openWindow(WindowTypes.WorkplaceDetails, workplace, 'dedupeData') });

        return () => {
            game.off("HouseSelected");
            game.off("PersonSelected");
            game.off("WorkplaceSelected");
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

            <Clock game={game} />
            <Toolbar game={game} />
            <Toasts toasts={toasts} />
        </div>
    );
};

export default HUD;