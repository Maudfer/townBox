import { Direction } from 'types/Movement';
import { Gender, Relationships } from 'types/Social';
import { JobPosition, JobRequirements } from 'types/Work';

// Bump whenever the snapshot shape changes in a backwards-incompatible way. Loaders may use this to migrate.
export const SAVE_VERSION = 1;

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
    familyId?: string | null;
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

export interface FamilySnapshot {
    familyId: string;
    familyName: string;
    householdId: string | null; // house anchor "row-col"
    memberIds: string[];
}

export interface WorldSnapshot {
    version: number;
    city: CitySnapshot;
    structures: StructureSnapshot[];
    people: PersonSnapshot[];
    vehicles: VehicleSnapshot[];
    families: FamilySnapshot[];
}
