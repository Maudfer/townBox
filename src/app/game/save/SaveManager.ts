import { v4 as uuidv4 } from 'uuid';

import GameManager from 'game/GameManager';
import Tile from 'game/Tile';
import Road from 'game/Road';
import House from 'game/House';
import Workplace from 'game/Workplace';
import Person from 'game/Person';
import Vehicle from 'game/Vehicle';

import { SaveProvider } from 'game/save/SaveProvider';
import LocalStorageProvider from 'game/save/LocalStorageProvider';

import { compress, decompress } from 'util/compress';
import { Relationships } from 'types/Social';
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
            population: this.game.population?.getState(),
            clock: { elapsedMs: this.game.clock?.getElapsedMs() ?? 0 },
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

        if (structure instanceof House) {
            snapshot.residentIds = this.idsFor(structure.getResidents(), personIds);
            snapshot.occupantIds = this.idsFor(structure.getOccupants(), personIds);
            snapshot.garageIds = this.idsFor(structure.getVehicles(), vehicleIds);
        } else if (structure instanceof Workplace) {
            snapshot.employeeIds = this.idsFor(structure.getEmployees(), personIds);
            snapshot.occupantIds = this.idsFor(structure.getOccupants(), personIds);
            snapshot.garageIds = this.idsFor(structure.getVehicles(), vehicleIds);
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
            skills: work.skills,
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
            person.work.setSkills(personSnapshot.skills);
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

        // Building occupancy.
        for (const structureSnapshot of snapshot.structures) {
            const structure = structureByKey.get(`${structureSnapshot.row}-${structureSnapshot.col}`);
            if (structure instanceof House) {
                this.restorePeople(structureSnapshot.residentIds, personById, person => structure.addResident(person));
                this.restorePeople(structureSnapshot.occupantIds, personById, person => structure.addOccupant(person));
                this.restoreVehicles(structureSnapshot.garageIds, vehicleById, vehicle => structure.addVehicle(vehicle));
            } else if (structure instanceof Workplace) {
                this.restorePeople(structureSnapshot.employeeIds, personById, person => structure.addEmployee(person));
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
