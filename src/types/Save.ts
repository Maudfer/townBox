import { Direction } from 'types/Movement';
import { Gender, Relationships } from 'types/Social';
import { JobPosition, JobRequirements } from 'types/Work';
import { PopulationState } from 'types/Genealogy';
import { Household } from 'types/Household';

// Bump whenever the snapshot shape changes in a backwards-incompatible way. Loaders may use this to migrate.
// v1 → v2: added the genealogy `population` pool. v1 saves load with an empty pool (no migration synthesis yet).
export const SAVE_VERSION = 2;

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
}

export type RelationshipSnapshot = Partial<Record<Relationships, string | string[]>>;

export interface PersonSnapshot {
    id: string;
    x: number;
    y: number;
    direction: Direction;
    indoors: boolean;
    // SocialLife
    firstName: string;
    familyName: string;
    age: number;
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
}
