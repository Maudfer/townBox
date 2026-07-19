import { v4 as uuidv4 } from 'uuid';

import GameManager from 'game/GameManager';
import Person from 'game/agents/Person';
import Vehicle from 'game/agents/Vehicle';
import { generateBuildingObjects } from 'game/objects/ObjectGeneration';
import LocalStorageProvider from 'game/save/LocalStorageProvider';
import { SaveProvider } from 'game/save/SaveProvider';
import { applyLegacySkills } from 'game/save/legacySkills';
import { migrateSnapshot } from 'game/save/migrations';
import Building from 'game/world/Building';
import House from 'game/world/House';
import Road from 'game/world/Road';
import Tile from 'game/world/Tile';
import Workplace from 'game/world/Workplace';
import businessesConfig from 'json/businesses.json';
import residencesConfig from 'json/residences.json';

const BUSINESS_BLUEPRINTS = businessesConfig as Record<string, { tags?: string[] }>;
const HOUSE_PLACEMENT_TAGS: readonly string[] = (residencesConfig as { house: { tags: string[] } }).house.tags;
import jobsConfig from 'json/jobs.json';

// Skill ids referenced by any job (the initialization employability bias, task 062) — mirrors City's set.
const JOB_CORE_SKILL_IDS: ReadonlySet<string> = new Set(
    Object.values(jobsConfig as Record<string, { requiredSkills?: string[] }>).flatMap(job => job.requiredSkills ?? [])
);

import { Household } from 'types/Household';
import {
    SAVE_VERSION,
    WorldSnapshot,
    StructureSnapshot,
    StructureType,
    PersonSnapshot,
    VehicleSnapshot,
    RelationshipSnapshot,
} from 'types/Save';
import { Relationships } from 'types/Social';
import { compress, decompress } from 'util/compress';

// Orchestrates capturing and restoring the entire game state. The snapshot is an id-based normalized model
// (people/vehicles get stable ids, structures/houses are referenced by their anchor key) so the cyclic
// relationship/ownership graph survives a JSON round-trip. The JSON is base64-encoded for storage.
//
// The storage backend is pluggable via SaveProvider; swap providers in one place (the constructor / setProvider)
// without touching any call sites.
export default class SaveManager {
    private game: GameManager;
    private provider: SaveProvider;

    constructor(game: GameManager, provider: SaveProvider = new LocalStorageProvider()) {
        this.game = game;
        this.provider = provider;
    }

    getProvider(): SaveProvider {
        return this.provider;
    }

    setProvider(provider: SaveProvider): void {
        this.provider = provider;
    }

    async save(slot: string): Promise<void> {
        const data = this.serialize();
        await this.provider.save(slot, data);
    }

    async load(slot: string): Promise<boolean> {
        const data = await this.provider.load(slot);
        if (!data) {
            return false;
        }
        this.deserialize(data);
        return true;
    }

    async hasSave(slot: string): Promise<boolean> {
        const data = await this.provider.load(slot);
        return data !== null;
    }

    // --- Serialization -----------------------------------------------------

    serialize(): string {
        const snapshot = this.buildSnapshot();
        return compress(JSON.stringify(snapshot));
    }

    buildSnapshot(): WorldSnapshot {
        const field = this.game.field;
        const city = this.game.city;
        if (!field || !city) {
            throw new Error('[SaveManager] Cannot serialize before the field and city exist');
        }

        const people = field.getPeople();
        const vehicles = field.getVehicles();

        const personIds = new Map<Person, string>();
        people.forEach(person => personIds.set(person, uuidv4()));

        const vehicleIds = new Map<Vehicle, string>();
        vehicles.forEach(vehicle => vehicleIds.set(vehicle, uuidv4()));

        const structures: StructureSnapshot[] = [];
        const households: Household[] = [];

        for (const structure of field.getStructures()) {
            const structureSnapshot = this.serializeStructure(structure, personIds, vehicleIds);
            if (!structureSnapshot) {
                continue;
            }
            structures.push(structureSnapshot);

            if (structure instanceof House) {
                const household = structure.getHousehold();
                if (household) {
                    households.push(household);
                }
            }
        }

        const peopleSnapshots: PersonSnapshot[] = people.map(person =>
            this.serializePerson(person, personIds, vehicleIds)
        );

        const vehicleSnapshots: VehicleSnapshot[] = vehicles.map(vehicle => {
            const position = vehicle.getPosition();
            return {
                id: vehicleIds.get(vehicle)!,
                x: position?.x ?? 0,
                y: position?.y ?? 0,
            };
        });

        return {
            version: SAVE_VERSION,
            city: {
                name: city.getName(),
                population: city.getPopulation(),
            },
            structures,
            people: peopleSnapshots,
            vehicles: vehicleSnapshots,
            households,
            // Homeless households (v7, task 022) live in the City, not on any house.
            homelessHouseholds: city.getHomelessHouseholds?.() ?? [],
            population: this.game.population?.getState(),
            clock: { elapsedMs: this.game.clock?.getElapsedMs() ?? 0 },
            eventHistory: this.game.eventEngine?.getHistory(),
            // Live-era entries only (LP-1): hydrated pre-game pasts are a hydration-time view — they made
            // JSON.stringify throw RangeError at ~32 residents and could never fit localStorage. Load
            // re-installs them from the pinned asset (GameManager.rehydratePersonLogs).
            eventLog: this.game.eventEngine?.getLiveLog(),
            eventLogSeq: this.game.eventEngine?.getNextLogSeq(),
            eventSchedule: this.game.eventEngine?.getScheduleState(),
            eventOverlay: this.game.eventEngine?.getOverlayState(),
            economy: this.game.economy?.getState(),
            objects: this.game.inventory?.getState(),
            actions: this.game.actionEngine?.getState(),
            schools: this.game.schools?.getState(),
            skillBook: this.game.skillBook?.getState(),
            // The elective social graph (v15, task 083).
            socialGraph: this.game.socialGraph?.serialize(),
            // The needs ledger (v16, task 084).
            needs: this.game.needs?.serialize(),
            // The agenda (v16, task 085).
            agenda: this.game.agenda?.serialize(),
            // Mood impulses (v16 family, task 091).
            mood: this.game.mood?.serialize(),
            habits: this.game.habits?.serialize(),
            incidents: this.game.incidents?.serialize(),
            detention: this.game.detention?.serialize(),
            buildingConditions: this.game.buildingConditions?.serialize(),
            pets: this.game.pets?.serialize(),
            knownFacts: this.game.knownFacts?.serialize(),
            // Lazy history hydration (v14): pin the asset ref + who is already hydrated, so households placed
            // after a load keep receiving pre-game histories. Absent for cold-start worlds.
            historyHydration: this.game.getHistoryHydrationState?.(),
        };
    }

    private serializeStructure(
        structure: Tile,
        personIds: Map<Person, string>,
        vehicleIds: Map<Vehicle, string>
    ): StructureSnapshot | null {
        let type: StructureType;
        if (structure instanceof House) {
            type = 'house';
        } else if (structure instanceof Workplace) {
            type = 'work';
        } else if (structure instanceof Road) {
            type = 'road';
        } else {
            return null;
        }

        const snapshot: StructureSnapshot = {
            type,
            row: structure.getRow(),
            col: structure.getCol(),
            assetName: structure.getAssetName(),
        };

        if (structure instanceof House || structure instanceof Workplace) {
            snapshot.objectsGenerated = structure.isObjectsGenerated();
        }
        if (structure instanceof House) {
            snapshot.residentIds = this.idsFor(structure.getResidents(), personIds);
            snapshot.occupantIds = this.idsFor(structure.getOccupants(), personIds);
            snapshot.garageIds = this.idsFor(structure.getVehicles(), vehicleIds);
        } else if (structure instanceof Workplace) {
            snapshot.employeeIds = this.idsFor(structure.getEmployees(), personIds);
            snapshot.occupantIds = this.idsFor(structure.getOccupants(), personIds);
            snapshot.garageIds = this.idsFor(structure.getVehicles(), vehicleIds);
            const business = structure.getBusiness();
            if (business) {
                snapshot.business = business;
            }
            // Re-occupancy bookkeeping (task 037).
            snapshot.vacantMonths = structure.getVacantMonths();
            snapshot.businessGenerations = structure.getBusinessGenerations();
        }

        return snapshot;
    }

    private serializePerson(
        person: Person,
        personIds: Map<Person, string>,
        vehicleIds: Map<Vehicle, string>
    ): PersonSnapshot {
        const position = person.getPosition();
        const info = person.social.getInfo();
        const work = person.work.getInfo();
        const home = person.social.getHome();
        const vehicle = person.getVehicle();

        const relationships: RelationshipSnapshot = {};
        for (const key of Object.keys(info.relationships) as Relationships[]) {
            const related = info.relationships[key];
            if (!related) {
                continue;
            }

            if (Array.isArray(related)) {
                relationships[key] = this.idsFor(related, personIds);
            } else {
                const id = personIds.get(related);
                if (id) {
                    relationships[key] = id;
                }
            }
        }

        return {
            id: personIds.get(person)!,
            x: position?.x ?? 0,
            y: position?.y ?? 0,
            direction: person.getDirection(),
            indoors: person.isIndoors(),
            personId: person.social.getPersonId(),
            firstName: info.firstName,
            familyName: info.familyName,
            age: info.age,
            birthTick: person.social.getBirthTick(),
            gender: info.gender,
            homeId: home ? home.getIdentifier() : null,
            relationships,
            job: work.job,
            vehicleId: vehicle ? vehicleIds.get(vehicle) ?? null : null,
        };
    }

    private idsFor<T>(items: T[], ids: Map<T, string>): string[] {
        const result: string[] = [];
        for (const item of items) {
            const id = ids.get(item);
            if (id) {
                result.push(id);
            }
        }
        return result;
    }

    // --- Deserialization ---------------------------------------------------

    deserialize(data: string): void {
        const field = this.game.field;
        const city = this.game.city;
        if (!field || !city) {
            throw new Error('[SaveManager] Cannot deserialize before the field and city exist');
        }

        const snapshot = JSON.parse(decompress(data)) as WorldSnapshot;
        if (!snapshot || typeof snapshot.version !== 'number') {
            throw new Error('[SaveManager] Invalid or corrupt save data');
        }
        if (snapshot.version > SAVE_VERSION) {
            throw new Error(`[SaveManager] Save version ${snapshot.version} is newer than supported ${SAVE_VERSION}`);
        }
        migrateSnapshot(snapshot);

        city.setName(snapshot.city.name);
        city.setPopulation(snapshot.city.population);

        // Genealogy pool (v2+). v1 saves carry none; the pool simply stays empty.
        if (snapshot.population) {
            this.game.population?.loadState(snapshot.population);
        }

        // Clock (v3+). Older saves carry none; the clock stays at the epoch.
        if (snapshot.clock) {
            this.game.clock?.setElapsedMs(snapshot.clock.elapsedMs);
        }

        // Event history (v5+). Older saves carry none; history stays empty.
        if (snapshot.eventHistory) {
            this.game.eventEngine?.loadHistory(snapshot.eventHistory);
        }

        // Append-only event log (v8+, task 040). Pre-v8 saves arrive here with a log synthesized by the
        // migration from the aggregate history.
        if (snapshot.eventLog) {
            this.game.eventEngine?.loadLog(snapshot.eventLog, snapshot.eventLogSeq);
        }

        // Pending automated triggers (v8+, task 042). Older saves carry none; the queue starts empty.
        if (snapshot.eventSchedule) {
            this.game.eventEngine?.loadScheduleState(snapshot.eventSchedule);
        }

        // The attribute overlay (LP-6): sick stays sick, retired stays retired, pregnant stays pregnant.
        if (snapshot.eventOverlay) {
            this.game.eventEngine?.loadOverlayState(snapshot.eventOverlay as never);
        }

        // Economy (v6+). Older saves carry none; balances stay empty.
        if (snapshot.economy) {
            this.game.economy?.loadState(snapshot.economy);
        }

        // Object instances & Possessions (v8+, task 041). Older saves carry none; the inventory stays empty.
        if (snapshot.objects) {
            this.game.inventory?.loadState(snapshot.objects);
        }

        // Action instances + history (v8+, task 043). Older saves carry none; the engine starts idle.
        if (snapshot.actions) {
            this.game.actionEngine?.loadState(snapshot.actions);
        }

        // School assignments (v9+, task 058). Older saves carry none; the daily sweep enrolls.
        if (snapshot.schools) {
            this.game.schools?.loadState(snapshot.schools);
        }

        // Contextual-object load sweep (task 070): pre-v12 saves (or buildings placed before the fill
        // existed) get their one-time fill now, marked so it never reruns. Deterministic per anchor + seed.
        if (this.game.inventory && snapshot.population) {
            const worldSeed = snapshot.population.worldSeed;
            const tick = this.game.clock ? this.game.clock.getCurrentTick() : 0;
            for (const structure of this.game.field?.getStructures() ?? []) {
                if (structure instanceof House && !structure.isObjectsGenerated()) {
                    generateBuildingObjects({ anchorKey: structure.getIdentifier(), tags: HOUSE_PLACEMENT_TAGS, host: 'house', worldSeed, tick }, this.game.inventory);
                    structure.setObjectsGenerated(true);
                } else if (structure instanceof Workplace && !structure.isObjectsGenerated()) {
                    const business = structure.getBusiness();
                    if (!business) {
                        continue; // vacant lots fill on re-occupancy
                    }
                    const blueprint = (BUSINESS_BLUEPRINTS as Record<string, { tags?: string[] }>)[business.blueprintKey];
                    generateBuildingObjects({
                        anchorKey: structure.getIdentifier(), tags: blueprint?.tags ?? [], host: 'business',
                        worldSeed, generationIndex: Math.max(0, structure.getBusinessGenerations() - 1), tick,
                    }, this.game.inventory);
                    structure.setObjectsGenerated(true);
                }
            }
        }

        // Lazy history hydration (v14+, task 012 follow-up). Older saves carry none → hydration disabled
        // (people placed later arrive without pre-game histories; the sim itself never needed them).
        this.game.setHistoryHydrationState?.(snapshot.historyHydration);

        // The elective social graph (v15, task 083). Absent (older saves) loads empty — edges regrow.
        this.game.socialGraph?.loadState(snapshot.socialGraph);

        // The needs ledger (v16, task 084). Absent (older saves) re-seeds lazily per person.
        this.game.needs?.loadState(snapshot.needs);

        // The agenda (v16, task 085). Absent (older saves) loads empty — routines re-plan.
        this.game.agenda?.loadState(snapshot.agenda);

        // Mood impulses (v16 family, task 091). Absent rests at the baseline.
        this.game.mood?.loadState(snapshot.mood);
        this.game.habits?.loadState(snapshot.habits);
        this.game.incidents?.loadState(snapshot.incidents);
        this.game.detention?.loadState(snapshot.detention);
        this.game.buildingConditions?.loadState(snapshot.buildingConditions);
        this.game.pets?.loadState(snapshot.pets);
        this.game.knownFacts?.loadState(snapshot.knownFacts);

        // Traits are derived, not stored — but the memo keyed the OLD world; drop it (task 087).
        this.game.traits?.reset();

        // Skill records (v10+, tasks 059-062). Pre-v10 saves carry none: every loaded person is
        // re-initialized deterministically (same seed convention as materialization) and their legacy
        // boolean skills are granted on top via the 061 mapping, so a MedicalSkill person stays medical.
        if (snapshot.skillBook) {
            this.game.skillBook?.loadState(snapshot.skillBook);
        } else if (this.game.skillBook && snapshot.population) {
            const skillBook = this.game.skillBook;
            const clock = this.game.clock;
            const tick = clock ? clock.getCurrentTick() : 0;
            const ticksPerYear = clock ? clock.getTicksPerYear() : 8640;
            const worldSeed = snapshot.population.worldSeed;
            for (const personSnapshot of snapshot.people) {
                const personId = personSnapshot.personId;
                const genPerson = personId ? snapshot.population.people[personId] : undefined;
                if (!personId || !genPerson) {
                    continue;
                }
                const ageYears = Math.floor((tick - genPerson.birthTick) / ticksPerYear);
                skillBook.initialize(personId, ageYears, genPerson.birthTick, tick, worldSeed, JOB_CORE_SKILL_IDS);
                if (personSnapshot.skills && personSnapshot.skills.length > 0) {
                    applyLegacySkills(skillBook, personId, personSnapshot.skills, tick);
                }
            }
        }

        // Structures first, so houses/workplaces exist to be referenced by people and families.
        const structureByKey = new Map<string, Tile>();
        for (const structureSnapshot of snapshot.structures) {
            const structure = field.loadStructure(
                structureSnapshot.type,
                structureSnapshot.row,
                structureSnapshot.col,
                structureSnapshot.assetName
            );
            if (structure) {
                structureByKey.set(`${structureSnapshot.row}-${structureSnapshot.col}`, structure);
            }
        }

        // Vehicles.
        const vehicleById = new Map<string, Vehicle>();
        for (const vehicleSnapshot of snapshot.vehicles) {
            vehicleById.set(vehicleSnapshot.id, field.loadVehicle(vehicleSnapshot.x, vehicleSnapshot.y));
        }

        // People — pass 1: create and restore scalar/identity/work state.
        const personById = new Map<string, Person>();
        for (const personSnapshot of snapshot.people) {
            const person = field.loadPerson(personSnapshot.x, personSnapshot.y);
            person.setDirection(personSnapshot.direction);
            person.setIndoors(personSnapshot.indoors);
            person.social.setFirstName(personSnapshot.firstName);
            person.social.setFamilyName(personSnapshot.familyName);
            person.social.setAge(personSnapshot.age);
            person.social.setBirthTick(personSnapshot.birthTick);
            person.social.setPersonId(personSnapshot.personId);
            person.social.setGender(personSnapshot.gender);
            if (personSnapshot.job) {
                person.work.setJob(personSnapshot.job);
            }
            personById.set(personSnapshot.id, person);
        }

        // People — pass 2: relink the object graph now that every person/structure exists.
        for (const personSnapshot of snapshot.people) {
            const person = personById.get(personSnapshot.id);
            if (!person) {
                continue;
            }

            if (personSnapshot.homeId) {
                const home = structureByKey.get(personSnapshot.homeId);
                if (home instanceof House) {
                    person.social.setHome(home);
                }
            }

            // Re-derive the physical building link from the restored position (W8 follow-up): the snapshot
            // carries `indoors` but not currentBuilding, and a null link deadlocked located actions after
            // every load (the pump's arrival identity check could never pass). The tile under the person's
            // pixel is the ground truth — footprint cells all reference the structure.
            if (personSnapshot.indoors) {
                const tilePosition = this.game.pixelToTilePosition(person.getPosition());
                const tile = tilePosition ? field.getTile(tilePosition.row, tilePosition.col) : null;
                if (tile instanceof Building) {
                    person.setCurrentBuilding(tile);
                }
            }

            if (personSnapshot.vehicleId) {
                const vehicle = vehicleById.get(personSnapshot.vehicleId);
                if (vehicle) {
                    person.setVehicle(vehicle);
                }
            }

            for (const key of Object.keys(personSnapshot.relationships) as Relationships[]) {
                const related = personSnapshot.relationships[key];
                if (!related) {
                    continue;
                }
                const relatedIds = Array.isArray(related) ? related : [related];
                for (const relatedId of relatedIds) {
                    const other = personById.get(relatedId);
                    if (other) {
                        person.social.addRelationship(key, other);
                    }
                }
            }
        }

        // Households (v2+). Records reference pool people by id; restored straight onto the house.
        for (const household of snapshot.households ?? []) {
            const house = structureByKey.get(household.houseKey);
            if (house instanceof House) {
                house.setHousehold(household);
            }
        }

        // Homeless households (v7+, task 022). Not attached to any house; their members are restored as
        // home-less people above (homeId null), so only the roster needs re-registering on the City.
        city.setHomelessHouseholds?.(snapshot.homelessHouseholds ?? []);

        // Building occupancy.
        for (const structureSnapshot of snapshot.structures) {
            const structure = structureByKey.get(`${structureSnapshot.row}-${structureSnapshot.col}`);
            if (structure instanceof House) {
                structure.setObjectsGenerated(structureSnapshot.objectsGenerated ?? false);
                this.restorePeople(structureSnapshot.residentIds, personById, person => structure.addResident(person));
                this.restorePeople(structureSnapshot.occupantIds, personById, person => structure.addOccupant(person));
                this.restoreVehicles(structureSnapshot.garageIds, vehicleById, vehicle => structure.addVehicle(vehicle));
            } else if (structure instanceof Workplace) {
                if (structureSnapshot.business) {
                    structure.setBusiness(structureSnapshot.business);
                }
                // Re-occupancy bookkeeping (task 037). Legacy saves lack these: a lot that already hosts a
                // business has hosted at least one generation, so default an occupied lot to 1 (not 0) — else a
                // future re-occupancy would reuse the generation-0 seed and respawn the identical business.
                structure.setObjectsGenerated(structureSnapshot.objectsGenerated ?? false);
                structure.setVacantMonths(structureSnapshot.vacantMonths ?? 0);
                structure.setBusinessGenerations(structureSnapshot.businessGenerations ?? (structureSnapshot.business ? 1 : 0));
                // Rebuild the employee<->employer link so the commute (006) knows where each employee works.
                this.restorePeople(structureSnapshot.employeeIds, personById, person => {
                    structure.addEmployee(person);
                    person.work.setWorkplace(structure);
                });
                this.restorePeople(structureSnapshot.occupantIds, personById, person => structure.addOccupant(person));
                this.restoreVehicles(structureSnapshot.garageIds, vehicleById, vehicle => structure.addVehicle(vehicle));
            }
        }
    }

    private restorePeople(
        ids: string[] | undefined,
        personById: Map<string, Person>,
        apply: (person: Person) => void
    ): void {
        for (const id of ids ?? []) {
            const person = personById.get(id);
            if (person) {
                apply(person);
            }
        }
    }

    private restoreVehicles(
        ids: string[] | undefined,
        vehicleById: Map<string, Vehicle>,
        apply: (vehicle: Vehicle) => void
    ): void {
        for (const id of ids ?? []) {
            const vehicle = vehicleById.get(id);
            if (vehicle) {
                apply(vehicle);
            }
        }
    }
}
