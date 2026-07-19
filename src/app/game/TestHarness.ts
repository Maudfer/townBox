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
    // The current sprite key (roads change theirs with auto-tiling as neighbours appear).
    assetName?: string | null;
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
    // Drives the render/movement loop deterministically: emits `count` `update` frames of `deltaMs` each, so
    // on-map travel (people walking, cars driving via Field.update) progresses a known amount per call instead
    // of at wall-clock RAF pace. The clock stays paused; only positions/travel advance.
    pumpFrames(count?: number, deltaMs?: number): Promise<void>;
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
    // `blueprintKey` (W7): pins the business exactly like a construction-menu pick — scenario scripts can
    // place a hospital/police station without hand-emitting tileClicked (the aliveness-3 session's #1 gap).
    build(tool: 'road' | 'soil' | 'house' | 'work', row: number, col: number, blueprintKey?: string): Promise<string | null>;

    // Scenario staffing (W7): a REAL hire into a specific workplace and job title — WorkLife set, rank
    // recorded, the position consumed — so forced scenarios (a doctor on duty, an officer on shift) don't
    // monkey-patch Workplace internals. Returns true when the hire landed.
    hireAs(personId: string, workplaceKey: string, title: string): boolean;

    // Scenario event forcing (W7): EventEngine.invoke with the live state/clock plumbed — one call to make
    // someone fall seriously ill, get arrested, or adopt a dog. Returns the invoke outcome's ok.
    forceEvent(eventId: string, personId: string, params?: Record<string, string | number | boolean>): boolean;

    // Payload-safe person selection (W7): opens the person inspector through the same bus event a real
    // click dispatches — the PersonSelected payload is the Person INSTANCE, and hand-built payloads have
    // crashed the HUD before (the W0 error boundary now contains it; this makes it unnecessary).
    selectPerson(personId: string): boolean;
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

    // --- Debug escape hatch (observation sessions) -----------------------
    // The live GameManager, for read-only console inspection of every engine/store (needs, mood, the
    // social graph, the per-person log, incidents, …) during manual observation passes. Test mode only —
    // the harness itself never installs outside test mode, so this leaks nothing into normal play.
    debug(): unknown;

    // Advances `ticks` in-game hours, interleaving `framesPerTick` update frames after each tick so on-map
    // movement (commutes, venue walks, chases) actually progresses between ticks. stepTicks alone starves
    // LiveWorld transitions — nobody arrives anywhere, so location-gated actions (sleep at home, work at
    // the workplace) silently stall. This is the honest way to fast-forward live play in an observation
    // or scenario session.
    stepGame(ticks: number, framesPerTick?: number, deltaMs?: number): Promise<void>;

    // Sprite-vs-state invariants (W8 / proposal simulation-aliveness-3): the standing audit every
    // observation session and the integration suite can assert. All-zero counters = a truthful street.
    auditSprites(): {
        vehicles: number;
        peopleInFlight: number;          // travelStep !== idle
        orphanControlledVehicles: number; // controlled but no person links to it — the P0-2 leak class
        occupiedDriverlessVehicles: number; // occupant flag set but no person links — phantom drivers
        visibleIndoorsPeople: number;     // sim says inside, sprite says visible — the linger class
    };
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
        async pumpFrames(count = 60, deltaMs = 16): Promise<void> {
            for (let i = 0; i < count; i++) {
                // The clock's advanceTime handler is paused in test mode, so this drives ONLY Field.update
                // (movement) — not the simulation clock.
                await game.emit('update', { time: i * deltaMs, timeDelta: deltaMs });
            }
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

        async build(tool: 'road' | 'soil' | 'house' | 'work', row: number, col: number, blueprintKey?: string): Promise<string | null> {
            const field = game.field;
            if (!field) {
                return null;
            }
            const toolEnum = BUILD_TOOLS[tool];
            const placement = field.resolvePlacement(toolEnum, { row, col });
            if (!placement.valid || !placement.position) {
                return null;
            }
            await game.emit('tileClicked', {
                position: placement.position, tool: toolEnum,
                // A pinned blueprint rides exactly like a construction-menu pick (task 108) — including the
                // civic placeholder texture the menu would arm (W7: no more hand-built asset keys).
                ...(blueprintKey !== undefined ? { blueprintKey, asset: `civic_${blueprintKey}` } : {}),
            });
            // Field.build fires houseBuilt/workplaceBuilt fire-and-forget; its household/business setup runs on
            // microtasks. Yield a macrotask so those complete before we return (materialized residents present).
            await new Promise<void>(resolve => setTimeout(resolve, 0));
            return `${placement.position.row}-${placement.position.col}`;
        },

        hireAs(personId: string, workplaceKey: string, title: string): boolean {
            const field = game.field;
            const person = (field ? field.getPeople() : []).find(candidate => candidate.social.getPersonId() === personId);
            const workplace = field?.getStructures().find(structure =>
                structure instanceof Workplace && structure.getIdentifier() === workplaceKey) as Workplace | undefined;
            if (!person || !workplace || person.work.getJob() !== null) {
                return false;
            }
            const preferred = workplace.getOpenPositions().find(position => position.title === title);
            if (!preferred) {
                return false;
            }
            const job = workplace.hire(person, () => true, preferred);
            if (!job) {
                return false;
            }
            person.work.setJob(job);
            person.work.setWorkplace(workplace);
            return true;
        },

        forceEvent(eventId: string, personId: string, params?: Record<string, string | number | boolean>): boolean {
            const engine = game.eventEngine;
            const population = game.population;
            const clock = game.clock;
            if (!engine || !population || !clock) {
                return false;
            }
            const { outcome } = engine.invoke(
                population.getState(), eventId, personId, clock.getCurrentTick(), clock.getTicksPerYear(),
                { source: 'system', causationId: null }, {}, {}, params
            );
            return outcome.ok;
        },

        selectPerson(personId: string): boolean {
            const person = (game.field ? game.field.getPeople() : []).find(candidate => candidate.social.getPersonId() === personId);
            if (!person) {
                return false;
            }
            void game.emit('PersonSelected', person);
            return true;
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
            const assetName = tile ? tile.getAssetName() : null;
            if (tile instanceof House) {
                return { type: 'house', row, col, occupied: tile.getResidents().length > 0, assetName };
            }
            if (tile instanceof Workplace) {
                return { type: 'work', row, col, occupied: tile.getBusiness() !== null, assetName };
            }
            if (tile instanceof Road) {
                return { type: 'road', row, col, assetName };
            }
            if (tile instanceof Soil) {
                return { type: 'soil', row, col, assetName };
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

        debug(): unknown {
            return game;
        },

        async stepGame(ticks: number, framesPerTick = 60, deltaMs = 32): Promise<void> {
            for (let t = 0; t < ticks; t++) {
                await game.advanceTicks(1);
                for (let i = 0; i < framesPerTick; i++) {
                    await game.emit('update', { time: i * deltaMs, timeDelta: deltaMs });
                }
            }
        },

        auditSprites() {
            const field = game.field;
            const people = field ? field.getPeople() : [];
            const vehicles = field ? field.getVehicles() : [];
            const linked = new Set(people.map(person => person.getVehicle()).filter(vehicle => vehicle !== null));
            return {
                vehicles: vehicles.length,
                peopleInFlight: people.filter(person => String(person.getTravelStep()) !== 'idle').length,
                orphanControlledVehicles: vehicles.filter(vehicle => vehicle.isControlled() && !linked.has(vehicle)).length,
                occupiedDriverlessVehicles: vehicles.filter(vehicle => vehicle.isOccupied() && !linked.has(vehicle)).length,
                visibleIndoorsPeople: people.filter(person => person.isIndoors() && person.getAsset()?.visible === true).length,
            };
        },
    };
}
