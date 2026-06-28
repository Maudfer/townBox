import { Direction } from 'types/Movement';
import { Gender, Relationships } from 'types/Social';
import { JobPosition, JobRequirements } from 'types/Work';
import { PopulationState } from 'types/Genealogy';
import { Household } from 'types/Household';
import { BusinessInstance } from 'types/Business';
import { EventHistoryTable } from 'types/LifeEvent';
import { EconomyState } from 'types/Economy';

// Bump whenever the snapshot shape changes in a backwards-incompatible way. Loaders may use this to migrate.
// v1 → v2: added the genealogy `population` pool (v1 saves load with an empty pool); families → households.
// v2 → v3: added `clock` state (older saves load with the clock at the epoch).
// v3 → v4: added per-workplace `business` (older saves load with no business; positions stay unseeded).
// v4 → v5: added per-person `eventHistory` (older saves load with empty history).
// v5 → v6: added the `economy` (money balances; older saves load with empty balances).
export const SAVE_VERSION = 6;

// The default save slot used by the in-game save button, Ctrl+S, and the title-screen "Load Game" option.
export const DEFAULT_SAVE_SLOT = 'autosave';

export type StructureType = 'road' | 'house' | 'work';

// A placed road or building. Soil/grass is the implicit default and is not serialized; loads are applied over a
// fresh, all-grass field. The anchor (row, col) is the footprint centre and doubles as the structure's address.
export interface StructureSnapshot {
    type: StructureType;
    row: number;
    col: number;
    assetName: string | null;
    // Building occupancy (ids reference people/vehicles by their snapshot id).
    residentIds?: string[];
    occupantIds?: string[];
    employeeIds?: string[];
    garageIds?: string[];
    // The generated business on a work building (v4+). Absent on houses/roads and on legacy saves.
    business?: BusinessInstance;
}

export type RelationshipSnapshot = Partial<Record<Relationships, string | string[]>>;

export interface PersonSnapshot {
    id: string;
    x: number;
    y: number;
    direction: Direction;
    indoors: boolean;
    // SocialLife
    personId: string | null; // link to the genealogy pool record (for age + death reconciliation)
    firstName: string;
    familyName: string;
    age: number;
    birthTick: number | null; // genealogy tick; when set, age derives from the clock
    gender: Gender;
    homeId: string | null; // house anchor "row-col"
    relationships: RelationshipSnapshot;
    // WorkLife
    job: JobPosition | null;
    skills: JobRequirements[];
    // Links
    vehicleId: string | null;
}

export interface VehicleSnapshot {
    id: string;
    x: number;
    y: number;
}

export interface CitySnapshot {
    name: string;
    population: number;
}

// Clock state is just the elapsed real time since the epoch; everything else derives from it.
export interface ClockSnapshot {
    elapsedMs: number;
}

export interface WorldSnapshot {
    version: number;
    city: CitySnapshot;
    structures: StructureSnapshot[];
    people: PersonSnapshot[];
    vehicles: VehicleSnapshot[];
    // Household records reference pool people by id; the pool itself is serialized below.
    households: Household[];
    // The genealogy pool (v2+). Optional so v1 saves still parse; absent on legacy saves.
    population?: PopulationState;
    // In-game clock state (v3+). Optional so older saves load at the epoch.
    clock?: ClockSnapshot;
    // Per-person life-event history (v5+). Optional so older saves load with empty history.
    eventHistory?: EventHistoryTable;
    // Money balances (v6+). Optional so older saves load with empty balances.
    economy?: EconomyState;
}
