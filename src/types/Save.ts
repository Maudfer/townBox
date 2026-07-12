import { ActionEngineState } from 'types/Action';
import { BusinessInstance } from 'types/Business';
import { EconomyState } from 'types/Economy';
import { PopulationState } from 'types/Genealogy';
import { Household } from 'types/Household';
import { EventHistoryTable, EventLogTable, ScheduleState } from 'types/LifeEvent';
import { Direction } from 'types/Movement';
import { AgendaState } from 'types/Agenda';
import { MoodState } from 'types/Mood';
import { NeedsState } from 'types/Needs';
import { InventoryState } from 'types/Objects';
import { SocialGraphState } from 'types/Relationship';
import { SchoolRegistryState } from 'types/School';
import { SkillBookState } from 'types/Skill';
import { Gender, Relationships } from 'types/Social';
import { JobPosition } from 'types/Work';

// Bump whenever the snapshot shape changes in a backwards-incompatible way. Loaders may use this to migrate.
// v1 → v2: added the genealogy `population` pool (v1 saves load with an empty pool); families → households.
// v2 → v3: added `clock` state (older saves load with the clock at the epoch).
// v3 → v4: added per-workplace `business` (older saves load with no business; positions stay unseeded).
// v4 → v5: added per-person `eventHistory` (older saves load with empty history).
// v5 → v6: added the `economy` (money balances; older saves load with empty balances).
// v6 → v7: added `homelessHouseholds` (evicted households with no home; older saves load with none).
// v7 → v8: the canonical tick became the in-game HOUR (task 040; 24 ticks/day). Every persisted tick
//          (birth/death ticks, partnership ticks, event-history ticks) is multiplied by 24 on load
//          (game/save/migrations.ts). The clock's elapsedMs is scale-independent and needs no migration.
//          v8 also carries the append-only event log (040) and object instances/Possessions (041); both are
//          additive optional fields (older saves load with a synthesized log and no objects).
// v8 → v9: added school assignments (task 058). Additive optional field; older saves load with no
//          assignments and the daily sweep enrolls eligible children on the next simulated day.
// v9 → v10: skills moved off WorkLife into the central SkillBook (tasks 059–062): `skillBook` carries the
//          proficiency records; `PersonSnapshot.skills` became a read-only legacy field. Loading an older
//          save re-initializes each person deterministically and grants the mapped legacy skills on top
//          (game/save/legacySkills.ts).
// v10 → v11: job ranks (task 064). Serialized JobPositions gain rankId + work-day counters; the migration
//          defaults existing employees to their job's entry rank with zeroed counters.
// v11 → v12: contextual building objects (task 070). Structures gain `objectsGenerated`; loading an older
//          save runs the fill once per existing building (SaveManager's load sweep) and marks them.
// v12 → v13: bounded fertility — every pool person gains an innate `maxChildren`. Older saves backfill it
//          deterministically from (worldSeed, personId) in migrations.
// v13 → v14: lazy history hydration (task 012 follow-up). `historyHydration` pins which asset dir/window the
//          game was selected from + who has already been hydrated, so households placed AFTER a load keep
//          receiving pre-game histories. Additive optional field; older saves load with hydration disabled
//          (people placed later simply arrive without pre-game logs — the sim itself never needed them).
// v14 → v15: the elective social graph (task 083). `socialGraph` carries friendship/rivalry/romance edges;
//          additive — absent reads as an empty graph (edges regrow from real interactions).
// v15 → v16: the needs ledger (task 084). `needs` carries per-person meters; additive — absent re-seeds
//          lazily and deterministically per person on first read.
export const SAVE_VERSION = 16;

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
    // Re-occupancy bookkeeping on a work building (task 037): months vacant since the last closure, and the
    // count of businesses the lot has hosted (varies the re-occupancy seed). Absent on legacy saves (read as 0).
    vacantMonths?: number;
    businessGenerations?: number;
    // Whether the contextual object fill (task 070, v12) already ran for this building. Absent on older
    // saves: the load sweep generates once and sets it.
    objectsGenerated?: boolean;
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
    // LEGACY (pre-v10): the boolean skill list. v10 moved skills to the central skillBook section; this
    // field is only read by the legacy reconciliation on load (save/legacySkills.ts) and never written.
    skills?: string[];
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
    // Evicted households with no home (v7+, task 022). Their members stay materialized (home = null), so the
    // people themselves serialize in `people`; only the homeless household roster needs a separate slot since it
    // is no longer attached to any house. Optional so older saves load with none.
    homelessHouseholds?: Household[];
    // The genealogy pool (v2+). Optional so v1 saves still parse; absent on legacy saves.
    population?: PopulationState;
    // In-game clock state (v3+). Optional so older saves load at the epoch.
    clock?: ClockSnapshot;
    // Per-person life-event history (v5+). Optional so older saves load with empty history.
    eventHistory?: EventHistoryTable;
    // The append-only per-person event log + its next commit seq (v8, task 040). Older saves synthesize a
    // minimal log from the aggregate history on migration.
    eventLog?: EventLogTable;
    eventLogSeq?: number;
    // Pending automated event triggers (v8, task 042). Optional so older saves load with an empty queue.
    eventSchedule?: ScheduleState;
    // Money balances (v6+). Optional so older saves load with empty balances.
    economy?: EconomyState;
    // Object instances & Possessions (v8, task 041). Optional so older saves load with none.
    objects?: InventoryState;
    // Action instances + aggregate action history (v8, task 043). Optional so older saves load with none.
    actions?: ActionEngineState;
    // School assignments (v9, task 058). Optional so older saves load with none (the daily sweep enrolls).
    schools?: SchoolRegistryState;
    // Skill proficiency records (v10, tasks 059–062). Optional: older saves reconstruct via deterministic
    // re-initialization + the legacy mapping (save/legacySkills.ts).
    skillBook?: SkillBookState;
    // Lazy history hydration (v14, task 012 follow-up): the asset ref (dir/window/createdAt fingerprint) plus
    // who has already been hydrated. Optional: absent = hydration disabled (cold-start worlds, older saves).
    historyHydration?: HistoryHydrationSave;
    // The elective social graph (v15, task 083). Optional so older saves load with an empty graph.
    socialGraph?: SocialGraphState;
    // The needs ledger (v16, task 084). Optional so older saves lazily re-seed per person.
    needs?: NeedsState;
    // The agenda (v16, task 085). Optional so older saves load with no pending plans (routines re-plan).
    agenda?: AgendaState;
    // Mood impulses (v16 family, task 091). Optional so older saves rest at the baseline.
    mood?: MoodState;
}

// See WorldSnapshot.historyHydration. `dir` and `createdAt` identify the exact asset generation the world was
// selected from; `window` is the selected present tick (per-person rebasing depends on it); `hydratedIds` are
// the people whose pre-game histories are already installed (their logs live in the save itself).
export interface HistoryHydrationSave {
    dir: string;
    window: number;
    createdAt: string;
    hydratedIds: string[];
}
