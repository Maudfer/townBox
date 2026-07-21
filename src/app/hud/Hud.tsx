import { FC, useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

import City from 'game/City';
import Person from 'game/agents/Person';
import House from 'game/world/House';
import Workplace from 'game/world/Workplace';
import Clock from 'hud/Clock';
import Feed from 'hud/Feed';
import Toasts, { ToastItem, ToastType } from 'hud/Toasts';
import Toolbar from 'hud/Toolbar';
import Nagbar from 'hud/Nagbar';
import TimeControls from 'hud/TimeControls';
import WindowErrorBoundary from 'hud/WindowErrorBoundary';
import CityDetails from 'hud/windows/CityDetails';
import ConstructionMenu from 'hud/windows/ConstructionMenu';
import HouseDetails from 'hud/windows/HouseDetails';
import PersonDetails from 'hud/windows/PersonDetails';
import ServicesDetails from 'hud/windows/ServicesDetails';
import WorkplaceDetails from 'hud/windows/WorkplaceDetails';
import { HUDProps, WindowData, WindowTypes, WindowPayload } from 'types/HUD';
import { Tool } from 'types/Cursor';

const TOAST_DURATION_MS = 3200;

// How a newly requested window reconciles with already-open ones.
type OpenMode = 'append' | 'replaceType' | 'dedupeData';

// The next stacking order (one above the current frontmost). Pure — hoisted out of the component so the
// open/focus handlers stay stable for the once-on-mount effect (task 131 follow-up #2).
const nextZ = (windows: WindowData[]): number => windows.reduce((max, w) => Math.max(max, w.z), 0) + 1;

const windowMap = {
    [WindowTypes.HouseDetails]: HouseDetails,
    [WindowTypes.WorkplaceDetails]: WorkplaceDetails,
    [WindowTypes.PersonDetails]: PersonDetails,
    [WindowTypes.VehicleDetails]: null,
    [WindowTypes.CityDetails]: CityDetails,
    [WindowTypes.GameOptions]: null,
    [WindowTypes.AvailableBuildings]: null,
    [WindowTypes.ConstructionMenu]: ConstructionMenu,
    [WindowTypes.ServicesDetails]: ServicesDetails,
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
    // - replaceType: at most ONE window of this type (the house/city/services/construction singletons AND the
    //   person inspector — task 131 follow-up #2: opening a person closes any other person window). Re-opening
    //   updates its data and brings it to the front (no flicker, no duplicate).
    // - dedupeData: allow many of this type but not the same entity twice (e.g. several workplace windows).
    // Either way, opening a dialog that's already up just brings it to the front (task 131 follow-up #2).
    function openWindow(type: WindowTypes, data: WindowPayload, mode: OpenMode = 'append') {
        setOpenWindows(prev => {
            const z = nextZ(prev);
            const singleton = mode === 'replaceType';
            const matchIndex = prev.findIndex(w => w.type === type && (singleton || w.data === data));
            if (matchIndex >= 0) {
                const next = prev.slice();
                next[matchIndex] = { ...next[matchIndex]!, data, z }; // update payload + bring to front
                return next;
            }
            return [...prev, { id: uuidv4(), type, data, z }];
        });
    }

    // Bring a window to the front (task 131 follow-up #2): clicking or dragging any window raises it.
    function bringToFront(id: string) {
        setOpenWindows(prev => {
            const target = prev.find(w => w.id === id);
            if (!target || target.z === nextZ(prev) - 1) {
                return prev; // already frontmost — no state churn
            }
            const z = nextZ(prev);
            return prev.map(w => (w.id === id ? { ...w, z } : w));
        });
    }

    function closeWindow(index: number) {
        setOpenWindows(prev => prev.filter((_, i) => i !== index));
    }

    // Tell the scene which people are being inspected (V6 / aliveness-4 M1): activity labels render only over
    // people with an open inspector, so the street isn't a wall of overlapping text. Re-emitted whenever the
    // set of open person windows changes.
    useEffect(() => {
        const inspectedIds = openWindows
            .filter(w => w.type === WindowTypes.PersonDetails)
            .map(w => (w.data as Person | null)?.social?.getPersonId?.() ?? null)
            .filter((id): id is string => id !== null);
        void game.emit('inspectedPeopleChanged', inspectedIds);
    }, [openWindows, game]);

    useEffect(() => {
        // Selection events are HUD-only (no game-side handler), so game.off here is safe.
        game.on("HouseSelected", { callback: (house: House) => openWindow(WindowTypes.HouseDetails, house, 'replaceType') });
        // One person inspector at a time (task 131 follow-up #2): opening another person replaces it (and the
        // activity-label set follows, so only that person's label shows unless debug show-all is on).
        game.on("PersonSelected", { callback: (person: Person) => openWindow(WindowTypes.PersonDetails, person, 'replaceType') });
        game.on("WorkplaceSelected", { callback: (workplace: Workplace) => openWindow(WindowTypes.WorkplaceDetails, workplace, 'dedupeData') });
        game.on("CitySelected", { callback: (city: City | null) => city && openWindow(WindowTypes.CityDetails, city, 'replaceType') });
        // The services window (task 114): opened from the nagbar (or anything else emitting ServicesSelected).
        game.on("ServicesSelected", { callback: (city: City | null) => city && openWindow(WindowTypes.ServicesDetails, city, 'replaceType') });
        // The construction menu (task 108): selecting the Construction tool opens the building grid.
        game.on("toolSelected", { callback: (tool: Tool) => tool === Tool.Construction && openWindow(WindowTypes.ConstructionMenu, null, 'replaceType') });

        return () => {
            game.off("HouseSelected");
            game.off("PersonSelected");
            game.off("WorkplaceSelected");
            game.off("CitySelected");
            game.off("ServicesSelected");
            game.off("toolSelected");
        };
    }, [game]);

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
    }, [game]);

    return (
        <div className="hud" data-testid="hud">
            {openWindows.map((window, index) => {
                const WindowComponent = windowMap[window.type];
                if (!WindowComponent) {
                    return null;
                }

                // Error boundary per window (W0 / P0-5): one crashing inspector must never take down the
                // whole HUD — the boundary closes the offending window and the session continues. The key is
                // the window's STABLE id (task 131 follow-up #2) — a per-render uuid used to remount every
                // window on every state change, resetting position and z-order.
                return (
                    <WindowErrorBoundary
                        key={window.id}
                        onWindowCrash={() => {
                            closeWindow(index);
                            pushToast('A window crashed and was closed', 'error');
                        }}
                    >
                        <WindowComponent
                            game={game}
                            index={index}
                            data={window.data}
                            z={window.z}
                            onFocus={() => bringToFront(window.id)}
                            onClose={closeWindow}
                        />
                    </WindowErrorBoundary>
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
            <TimeControls game={game} />
            <Feed game={game} />
            <Toolbar game={game} />
            <Nagbar game={game} />
            <Toasts toasts={toasts} />
        </div>
    );
};

export default HUD;