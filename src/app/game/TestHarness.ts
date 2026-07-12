import type GameManager from 'game/GameManager';

import Person from 'game/agents/Person';
import Vehicle from 'game/agents/Vehicle';
import House from 'game/world/House';
import Road from 'game/world/Road';
import Soil from 'game/world/Soil';
import Workplace from 'game/world/Workplace';
import { CityStats } from 'types/City';
import { Tool } from 'types/Cursor';
import { formatTimestamp } from 'util/time';

// The integration-test determinism hook (task 008). Installed on `window.__townbox` ONLY in test mode
// (GameManager.isTestMode) — never in normal production — so the opaque Phaser canvas + real-time sim become
// deterministically assertable from Playwright. It is a read + control seam over the live game, exposed through
// GameManager (which owns the Clock/Field/City) so tests never reach into game internals directly.
//
// Time control: on install the RAF-driven clock is PAUSED, so in-game time only advances when a test calls
// stepTicks(n). stepTicks drives the exact same newDay/newTick/timeChanged cadence the frame loop does, one
// tick at a time and awaited, so `place → stepTicks(24) → assert arrived` has zero wall-clock flakiness.

// Maps the harness's string tool names to the Tool enum used by the placement/build path.
const BUILD_TOOLS: Record<'road' | 'soil' | 'house' | 'work', Tool> = {
    road: Tool.Road,
    soil: Tool.Soil,
    house: Tool.House,
    work: Tool.Work,
};

export interface TileInfo {
    type: 'road' | 'house' | 'work' | 'soil' | 'none';
    row: number;
    col: number;
    // For buildings: whether it is occupied (a house with residents / a workplace with a business).
    occupied?: boolean;
}

export interface PersonInfo {
    personId: string | null;
    name: string;
    x: number;
    y: number;
    indoors: boolean;
    travelStep: string;
    currentBuilding: string | null;
    jobTitle: string | null;
    homeKey: string | null;
    age: number;
}

export interface VehicleInfo {
    x: number;
    y: number;
}

export interface StructureCounts {
    roads: number;
    houses: number;
    workplaces: number;
    occupiedHouses: number;
    businesses: number;
}

export interface ScreenPoint {
    x: number;
    y: number;
}

export interface TownboxTestApi {
    // --- Time control ---------------------------------------------------
    // Advance the simulation deterministically by `n` in-game hour ticks (default 1), awaiting each tick's
    // full newDay/newTick lifecycle. Resolves once the sim has fully processed all `n` ticks.
    stepTicks(n?: number): Promise<void>;
    pause(): void;
    resume(): void;
    getTick(): number;
    getDate(): string;

    // --- Canvas targeting + save (for real clicks / fixture recording) --
    // Centers the camera on tile (row, col) and returns the viewport pixel where that tile now sits, so a test
    // can issue a REAL canvas click there. Returns null if the tile/camera isn't available.
    focusTile(row: number, col: number): ScreenPoint | null;
    // The current world serialized to the save-string format (compressed + base64). Used by the fixture
    // recorder to capture a built scenario without going through localStorage.
    savePayload(): string;

    // --- Deterministic build controls (fixture recording) ---------------
    // Places a structure via the SAME resolve-placement + `tileClicked` path a real click uses (roads snap to
    // the supertile grid, buildings soft-snap to a road side), AWAITING the async household/business setup.
    // Returns the resolved anchor "row-col", or null when the placement is invalid. `tool` is one of
    // 'road' | 'soil' | 'house' | 'work'. (Real canvas clicks are still exercised by the canvas suite.)
    build(tool: 'road' | 'soil' | 'house' | 'work', row: number, col: number): Promise<string | null>;
    // Bulldozes whatever occupies the tile (coherent teardown), awaiting eviction/closure side effects.
    bulldoze(row: number, col: number): Promise<void>;

    // --- World reads ----------------------------------------------------
    tileAt(row: number, col: number): TileInfo;
    structureCounts(): StructureCounts;
    // Anchor identifiers ("row-col") of the placed buildings, split by kind — for targeting a click.
    buildings(): { houses: string[]; workplaces: string[] };
    people(): PersonInfo[];
    personById(personId: string): PersonInfo | null;
    vehicles(): VehicleInfo[];
    cityStats(): CityStats | null;

    // --- Event history --------------------------------------------------
    // The number of committed life-event/action log entries for a pool person (for asserting the sim ran).
    historyLength(personId: string): number;
}

// Builds the read/control API object over a live GameManager.
export function createTestApi(game: GameManager): TownboxTestApi {
    const describePerson = (person: Person): PersonInfo => {
        const position = person.getPosition();
        const building = person.getCurrentBuilding();
        const job = person.work.getJob();
        const home = person.social.getHome();
        return {
            personId: person.social.getPersonId(),
            name: person.social.getFullName(),
            x: position?.x ?? 0,
            y: position?.y ?? 0,
            indoors: person.isIndoors(),
            travelStep: String(person.getTravelStep()),
            currentBuilding: building ? building.getIdentifier() : null,
            jobTitle: job ? job.title : null,
            homeKey: home ? home.getIdentifier() : null,
            age: person.social.getAge(),
        };
    };

    return {
        async stepTicks(n = 1): Promise<void> {
            await game.advanceTicks(n);
        },
        pause(): void {
            game.pauseTime();
        },
        resume(): void {
            game.resumeTime();
        },
        getTick(): number {
            return game.clock?.getCurrentTick() ?? 0;
        },
        getDate(): string {
            return game.clock ? formatTimestamp(game.clock.getTimestamp()) : '';
        },

        focusTile(row: number, col: number): ScreenPoint | null {
            const pixel = game.tileToPixelPosition({ row, col });
            if (!pixel || !game.scene) {
                return null;
            }
            game.scene.centerCameraOn(pixel.x, pixel.y);
            const canvas = typeof document !== 'undefined' ? document.querySelector('canvas') : null;
            if (!canvas) {
                return null;
            }
            const rect = canvas.getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        },

        savePayload(): string {
            return game.saveManager.serialize();
        },

        async build(tool: 'road' | 'soil' | 'house' | 'work', row: number, col: number): Promise<string | null> {
            const field = game.field;
            if (!field) {
                return null;
            }
            const toolEnum = BUILD_TOOLS[tool];
            const placement = field.resolvePlacement(toolEnum, { row, col });
            if (!placement.valid || !placement.position) {
                return null;
            }
            await game.emit('tileClicked', { position: placement.position, tool: toolEnum });
            // Field.build fires houseBuilt/workplaceBuilt fire-and-forget; its household/business setup runs on
            // microtasks. Yield a macrotask so those complete before we return (materialized residents present).
            await new Promise<void>(resolve => setTimeout(resolve, 0));
            return `${placement.position.row}-${placement.position.col}`;
        },

        async bulldoze(row: number, col: number): Promise<void> {
            const field = game.field;
            if (!field) {
                return;
            }
            const placement = field.resolvePlacement(Tool.Bulldoze, { row, col });
            const position = placement.valid && placement.position ? placement.position : { row, col };
            await game.emit('tileClicked', { position, tool: Tool.Bulldoze });
            await new Promise<void>(resolve => setTimeout(resolve, 0));
        },

        tileAt(row: number, col: number): TileInfo {
            const field = game.field;
            if (!field || !field.isValidPosition(row, col)) {
                return { type: 'none', row, col };
            }
            const tile = field.getTile(row, col);
            if (tile instanceof House) {
                return { type: 'house', row, col, occupied: tile.getResidents().length > 0 };
            }
            if (tile instanceof Workplace) {
                return { type: 'work', row, col, occupied: tile.getBusiness() !== null };
            }
            if (tile instanceof Road) {
                return { type: 'road', row, col };
            }
            if (tile instanceof Soil) {
                return { type: 'soil', row, col };
            }
            return { type: 'none', row, col };
        },

        structureCounts(): StructureCounts {
            const field = game.field;
            const counts: StructureCounts = {
                roads: 0, houses: 0, workplaces: 0, occupiedHouses: 0, businesses: 0,
            };
            for (const structure of field ? field.getStructures() : []) {
                if (structure instanceof House) {
                    counts.houses += 1;
                    if (structure.getResidents().length > 0) {
                        counts.occupiedHouses += 1;
                    }
                } else if (structure instanceof Workplace) {
                    counts.workplaces += 1;
                    if (structure.getBusiness()) {
                        counts.businesses += 1;
                    }
                } else if (structure instanceof Road) {
                    counts.roads += 1;
                }
            }
            return counts;
        },

        buildings(): { houses: string[]; workplaces: string[] } {
            const houses: string[] = [];
            const workplaces: string[] = [];
            for (const structure of game.field ? game.field.getStructures() : []) {
                if (structure instanceof House) {
                    houses.push(structure.getIdentifier());
                } else if (structure instanceof Workplace) {
                    workplaces.push(structure.getIdentifier());
                }
            }
            return { houses, workplaces };
        },

        people(): PersonInfo[] {
            return (game.field ? game.field.getPeople() : []).map(describePerson);
        },

        personById(personId: string): PersonInfo | null {
            const match = (game.field ? game.field.getPeople() : []).find(
                person => person.social.getPersonId() === personId
            );
            return match ? describePerson(match) : null;
        },

        vehicles(): VehicleInfo[] {
            return (game.field ? game.field.getVehicles() : []).map((vehicle: Vehicle) => {
                const position = vehicle.getPosition();
                return { x: position?.x ?? 0, y: position?.y ?? 0 };
            });
        },

        cityStats(): CityStats | null {
            return game.city ? game.city.getCityStats() : null;
        },

        historyLength(personId: string): number {
            const log = game.eventEngine?.getPersonLog(personId);
            return log ? log.length : 0;
        },
    };
}
