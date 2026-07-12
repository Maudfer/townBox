// A local mirror of the window.__townbox API surface (src/app/game/TestHarness.ts). Kept as a self-contained
// copy so the Playwright suite stays decoupled from the app's TypeScript/aliases/Phaser build — the tests only
// need the shape to type page.evaluate calls. When the harness API changes, update this mirror to match.

export interface TileInfo {
    type: 'road' | 'house' | 'work' | 'soil' | 'none';
    row: number;
    col: number;
    occupied?: boolean;
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

// Mirrors game/TestHarness.ts CityStats-returning method loosely; only the fields tests read are typed here.
export interface CityStatsLike {
    name: string;
    population: number;
    households: number;
    businesses: number;
    employedAdults: number;
    unemployedAdults: number;
    births: number;
    deaths: number;
    [key: string]: unknown;
}

export interface TownboxTestApi {
    stepTicks(n?: number): Promise<void>;
    pumpFrames(count?: number, deltaMs?: number): Promise<void>;
    pause(): void;
    resume(): void;
    getTick(): number;
    getDate(): string;
    focusTile(row: number, col: number): ScreenPoint | null;
    savePayload(): string;
    build(tool: 'road' | 'soil' | 'house' | 'work', row: number, col: number): Promise<string | null>;
    bulldoze(row: number, col: number): Promise<void>;
    tileAt(row: number, col: number): TileInfo;
    structureCounts(): StructureCounts;
    buildings(): { houses: string[]; workplaces: string[] };
    people(): PersonInfo[];
    personById(personId: string): PersonInfo | null;
    vehicles(): VehicleInfo[];
    cityStats(): CityStatsLike | null;
    historyLength(personId: string): number;
}

declare global {
    interface Window {
        __townbox?: TownboxTestApi;
        __TOWNBOX_TEST?: boolean;
    }
}
