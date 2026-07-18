import ActionEngine from 'game/actions/ActionEngine';
import GameManager from 'game/GameManager';
import Economy from 'game/economy/Economy';
import EventEngine from 'game/events/EventEngine';
import Inventory from 'game/objects/Inventory';
import Population from 'game/population/Population';
import Clock from 'game/Clock';
import City from 'game/City';
import SaveManager from 'game/save/SaveManager';
import { SaveProvider } from 'game/save/SaveProvider';
import SchoolRegistry from 'game/skills/SchoolRegistry';
import SkillBook from 'game/skills/SkillBook';
import Field from 'game/world/Field';
import House from 'game/world/House';
import Workplace from 'game/world/Workplace';
import { Direction } from 'types/Movement';
import { PixelPosition, TilePosition } from 'types/Position';
import { SAVE_VERSION, WorldSnapshot } from 'types/Save';
import { Genders, Relationships } from 'types/Social';
import { compress, decompress } from 'util/compress';

// Covers SaveManager/behavior gaps the round-trip tests in saveLoad.test.ts don't reach: provider
// passthrough, the field/city preconditions, corrupt/future-version rejection, employee/vehicle/garage
// wiring, defensive handling of a corrupted relationship entry, and the six optional-engine wiring branches
// (event history/log/schedule, economy, inventory, actions, schools) plus the contextual object-fill sweep
// that runs over structures already standing on the target field at load time.

class MemoryProvider implements SaveProvider {
    private store = new Map<string, string>();
    async save(slot: string, data: string): Promise<void> {
        this.store.set(slot, data);
    }
    async load(slot: string): Promise<string | null> {
        return this.store.get(slot) ?? null;
    }
    async list(): Promise<string[]> {
        return [...this.store.keys()];
    }
    async delete(slot: string): Promise<void> {
        this.store.delete(slot);
    }
}

function makeCity(): City {
    const city = {
        _name: '',
        _population: 0,
        _homeless: [] as unknown[],
        getName() { return this._name; },
        setName(name: string) { this._name = name; },
        getPopulation() { return this._population; },
        setPopulation(population: number) { this._population = population; },
        getHomelessHouseholds() { return this._homeless; },
        setHomelessHouseholds(households: unknown[]) { this._homeless = households; },
    };
    return city as unknown as City;
}

// Builds a world with every OPTIONAL engine SaveManager knows about wired up with real instances (mirroring
// what GameManager itself constructs on a new game), so the `snapshot.xxx?.` branches in buildSnapshot() and
// the `if (snapshot.xxx) { engine?.loadXxx(...) }` branches in deserialize() are exercised for real instead
// of through a mock.
function makeWorld(rows: number, cols: number): {
    game: GameManager; field: Field; city: City; population: Population; clock: Clock;
    eventEngine: EventEngine; economy: Economy; inventory: Inventory; actionEngine: ActionEngine;
    schools: SchoolRegistry; skillBook: SkillBook;
} {
    const city = makeCity();
    const population = new Population();
    const clock = new Clock();
    const eventEngine = new EventEngine();
    const economy = new Economy();
    const inventory = new Inventory();
    const actionEngine = new ActionEngine();
    const schools = new SchoolRegistry();
    const skillBook = new SkillBook();

    const game = {
        field: null,
        city,
        population,
        clock,
        eventEngine,
        economy,
        inventory,
        actionEngine,
        schools,
        skillBook,
        gridParams: {
            rows,
            cols,
            cells: { width: 16, height: 16 },
            footprint: { tiles: 3, width: 48, height: 48 },
        },
        tileToPixelPosition: (position: TilePosition) =>
            position === null ? null : { x: position.col * 16 + 8, y: position.row * 16 + 8 },
        pixelToTilePosition: (pixel: PixelPosition) => {
            if (pixel === null) {
                return null;
            }
            const row = Math.floor(pixel.y / 16);
            const col = Math.floor(pixel.x / 16);
            if (row < 0 || row >= rows || col < 0 || col >= cols) {
                return null;
            }
            return { row, col };
        },
        emit: () => {},
        on: () => {},
        toolbelt: {},
    } as unknown as GameManager;

    const field = new Field(game, rows, cols);
    (game as unknown as { field: Field }).field = field;

    return { game, field, city, population, clock, eventEngine, economy, inventory, actionEngine, schools, skillBook };
}

describe('SaveManager: provider passthrough', () => {
    test('getProvider/setProvider expose and swap the configured provider', () => {
        const world = makeWorld(5, 5);
        const providerA = new MemoryProvider();
        const providerB = new MemoryProvider();
        const manager = new SaveManager(world.game, providerA);

        expect(manager.getProvider()).toBe(providerA);
        manager.setProvider(providerB);
        expect(manager.getProvider()).toBe(providerB);
    });

    test('hasSave reflects whether the slot has data', async () => {
        const world = makeWorld(5, 5);
        const provider = new MemoryProvider();
        const manager = new SaveManager(world.game, provider);

        expect(await manager.hasSave('slot1')).toBe(false);
        await manager.save('slot1');
        expect(await manager.hasSave('slot1')).toBe(true);
    });
});

describe('SaveManager: preconditions', () => {
    test('serialize throws when the field or city do not exist yet', () => {
        const bareGame = { field: null, city: null } as unknown as GameManager;
        const manager = new SaveManager(bareGame, new MemoryProvider());
        expect(() => manager.serialize()).toThrow('Cannot serialize before the field and city exist');
    });

    test('deserialize throws when the field or city do not exist yet', () => {
        const bareGame = { field: null, city: null } as unknown as GameManager;
        const manager = new SaveManager(bareGame, new MemoryProvider());
        const payload = compress(JSON.stringify({ version: SAVE_VERSION }));
        expect(() => manager.deserialize(payload)).toThrow('Cannot deserialize before the field and city exist');
    });

    test('deserialize rejects corrupt payloads (missing/invalid version)', () => {
        const world = makeWorld(5, 5);
        const manager = new SaveManager(world.game, new MemoryProvider());

        const payload = compress(JSON.stringify({ notASnapshot: true }));
        expect(() => manager.deserialize(payload)).toThrow('Invalid or corrupt save data');
    });

    test('deserialize rejects a save version newer than this build supports', () => {
        const world = makeWorld(5, 5);
        const manager = new SaveManager(world.game, new MemoryProvider());

        const future = compress(JSON.stringify({ version: SAVE_VERSION + 1, city: { name: 'x', population: 0 }, structures: [], people: [], vehicles: [], households: [] }));
        expect(() => manager.deserialize(future)).toThrow(`Save version ${SAVE_VERSION + 1} is newer than supported ${SAVE_VERSION}`);
    });
});

describe('SaveManager: employees, garaged vehicles and a person-owned vehicle', () => {
    test('round-trips workplace employees, garage vehicles on both a house and a workplace, and a resident\'s own car', async () => {
        const provider = new MemoryProvider();
        const source = makeWorld(20, 20);
        source.city.setName('Motorville');

        const house = source.field.loadStructure('house', 4, 4, 'h') as House;
        const work = source.field.loadStructure('work', 10, 10, 'w') as Workplace;
        work.setBusiness({
            blueprintKey: 'supermarket',
            name: 'Employer Mart',
            lineOfWork: 'Super Market',
            size: 2,
            positions: [{ title: 'Checkout Clerk', salary: 1300, requirements: [], shiftStart: 540, shiftEnd: 1020 }],
        });

        const resident = source.field.loadPerson(72, 56);
        resident.social.setFirstName('Rui');
        resident.social.setHome(house);
        house.addResident(resident);

        const employee = source.field.loadPerson(160, 160);
        employee.social.setFirstName('Ana');
        employee.work.setJob({ title: 'Checkout Clerk', salary: 1300, requirements: [], shiftStart: 540, shiftEnd: 1020 });
        work.addEmployee(employee);

        const personalCar = source.field.loadVehicle(72, 60);
        resident.setVehicle(personalCar);

        const houseGarageCar = source.field.loadVehicle(80, 80);
        house.addVehicle(houseGarageCar);

        const workGarageCar = source.field.loadVehicle(170, 170);
        work.addVehicle(workGarageCar);

        expect(source.field.getVehicles()).toHaveLength(3);

        const sourceManager = new SaveManager(source.game, provider);
        await sourceManager.save('fleet');

        const target = makeWorld(20, 20);
        const targetManager = new SaveManager(target.game, provider);
        expect(await targetManager.load('fleet')).toBe(true);

        const restoredHouse = target.field.getTile(4, 4) as House;
        const restoredWork = target.field.getTile(10, 10) as Workplace;

        expect(restoredHouse.getVehicles()).toHaveLength(1);
        expect(restoredWork.getVehicles()).toHaveLength(1);
        expect(restoredWork.getEmployees()).toHaveLength(1);
        expect(restoredWork.getEmployees()[0]!.social.getInfo().firstName).toBe('Ana');
        // The employee<->employer link is restored both ways (commute scheduling depends on it).
        expect(restoredWork.getEmployees()[0]!.work.getWorkplace()).toBe(restoredWork);

        const restoredResident = target.field.getPeople().find(p => p.social.getInfo().firstName === 'Rui')!;
        expect(restoredResident.getVehicle()).not.toBeNull();
        // The resident's own car is a distinct vehicle instance from either garage's car.
        expect(restoredResident.getVehicle()).not.toBe(restoredHouse.getVehicles()[0]);
    });
});

describe('SaveManager: defensive handling of a corrupted relationship entry', () => {
    test('serialize skips a relationship key holding a falsy value instead of crashing', () => {
        const source = makeWorld(10, 10);
        const alice = source.field.loadPerson(16, 16);
        const bob = source.field.loadPerson(32, 32);
        alice.social.setFirstName('Alice');
        bob.social.setFirstName('Bob');
        alice.social.addRelationship(Relationships.Spouse, bob);

        // Corrupt the live relationships map directly (bypassing addRelationship) — e.g. what a bad migration
        // or a future bug might leave behind: a key present but pointing at nothing.
        (alice.social.getInfo().relationships as Record<string, unknown>)[Relationships.Sibling] = null;

        const manager = new SaveManager(source.game, new MemoryProvider());
        expect(() => manager.serialize()).not.toThrow();

        const snapshot = JSON.parse(decompress(manager.serialize())) as WorldSnapshot;
        const aliceSnapshot = snapshot.people.find(p => p.firstName === 'Alice')!;
        // The corrupted key was skipped entirely rather than serialized as a broken reference.
        expect(aliceSnapshot.relationships[Relationships.Sibling]).toBeUndefined();
        // A legitimate relationship set alongside it still round-trips normally.
        expect(aliceSnapshot.relationships[Relationships.Spouse]).toBeDefined();
    });

    test('deserialize skips a relationship key holding a falsy value instead of crashing', () => {
        const target = makeWorld(10, 10);
        target.field.loadStructure('house', 2, 2, 'h');

        const snapshot: WorldSnapshot = {
            version: SAVE_VERSION,
            city: { name: 'Testville', population: 2 },
            structures: [],
            people: [
                {
                    id: 'u1', x: 16, y: 16, direction: Direction.South, indoors: false, personId: null,
                    firstName: 'Alice', familyName: '', age: 30, birthTick: null, gender: Genders.Female,
                    homeId: null, relationships: { [Relationships.Sibling]: null as unknown as string }, job: null, vehicleId: null,
                },
                {
                    id: 'u2', x: 32, y: 32, direction: Direction.South, indoors: false, personId: null,
                    firstName: 'Bob', familyName: '', age: 30, birthTick: null, gender: Genders.Male,
                    homeId: null, relationships: {}, job: null, vehicleId: null,
                },
            ],
            vehicles: [],
            households: [],
        };

        const targetManager = new SaveManager(target.game, new MemoryProvider());
        expect(() => targetManager.deserialize(compress(JSON.stringify(snapshot)))).not.toThrow();

        const alice = target.field.getPeople().find(p => p.social.getInfo().firstName === 'Alice')!;
        expect(alice.social.hasRelationship(Relationships.Sibling)).toBe(false);
    });
});

describe('SaveManager: optional-engine wiring + the contextual object-fill sweep', () => {
    test('event history/log/schedule, economy, inventory, and action/school state round-trip through real engine instances', async () => {
        const provider = new MemoryProvider();
        const source = makeWorld(10, 10);
        source.population.generate(777);
        const worldSeed = source.population.getState().worldSeed;

        // Seed every optional engine with real, distinguishable state through its own public API.
        source.eventEngine.loadHistory({ p1: { fell_ill: { count: 3, lastTick: 40 } } });
        source.eventEngine.loadLog(
            { p1: [{ seq: 0, tick: 40, kind: 'event', defId: 'fell_ill', roles: { subject: 'p1' }, triggerSource: 'system', causationId: null }] },
            1
        );
        source.eventEngine.loadScheduleState({ queue: [], nextScheduleSeq: 9 });
        source.economy.loadState({ personBalances: { p1: 500 }, businessBalances: {}, lastEconomyMonth: 4, externalBalance: -500 });
        source.inventory.loadState({ instances: {}, nextInstanceSeq: 0 });
        source.actionEngine.loadState({ instances: {}, nextInstanceSeq: 2, actionHistory: {} });
        source.schools.loadState({ assignments: {} });

        const sourceManager = new SaveManager(source.game, provider);
        await sourceManager.save('rich');

        // The target field already has a house, a business-occupied workplace, and a VACANT workplace
        // standing on it before the load — the load sweep (task 070) operates on whatever is already on the
        // field, filling any building whose `objectsGenerated` flag is still false and skipping vacant lots.
        const target = makeWorld(10, 10);
        const existingHouse = target.field.loadStructure('house', 2, 2, 'h') as House;
        const occupiedWork = target.field.loadStructure('work', 5, 5, 'w') as Workplace;
        occupiedWork.setBusiness({
            blueprintKey: 'supermarket',
            name: 'Pre-existing Mart',
            lineOfWork: 'Super Market',
            size: 2,
            positions: [],
        });
        const vacantWork = target.field.loadStructure('work', 8, 8, 'v') as Workplace;
        expect(existingHouse.isObjectsGenerated()).toBe(false);
        expect(occupiedWork.isObjectsGenerated()).toBe(false);
        expect(vacantWork.isObjectsGenerated()).toBe(false);

        const targetManager = new SaveManager(target.game, provider);
        expect(await targetManager.load('rich')).toBe(true);

        // Event history/log/schedule wiring.
        expect(target.eventEngine.getHistory()).toEqual({ p1: { fell_ill: { count: 3, lastTick: 40 } } });
        expect(target.eventEngine.getLog()['p1']).toHaveLength(1);
        expect(target.eventEngine.getScheduleState().nextScheduleSeq).toBe(9);

        // Economy wiring.
        expect(target.economy.getState().personBalances['p1']).toBe(500);
        expect(target.economy.getState().lastEconomyMonth).toBe(4);

        // Inventory wiring (the loaded, empty state, distinct from whatever the sweep fills in afterward).
        expect(target.inventory.getState().nextInstanceSeq).toBeGreaterThanOrEqual(0);

        // Action engine + school registry wiring.
        expect(target.actionEngine.getState().nextInstanceSeq).toBe(2);
        expect(target.schools.getState()).toEqual({ assignments: {} });

        // The contextual object-fill sweep (070): ran once for the pre-existing house and the occupied
        // workplace (both now marked generated), but skipped the vacant workplace (no business to key off).
        expect(existingHouse.isObjectsGenerated()).toBe(true);
        expect(occupiedWork.isObjectsGenerated()).toBe(true);
        expect(vacantWork.isObjectsGenerated()).toBe(false);

        // The sweep actually created object instances somewhere (the house or the business got at least its
        // guaranteed essentials) — proves it's not a no-op silently marking things "generated".
        const instanceCount = Object.keys(target.inventory.getState().instances).length;
        expect(instanceCount).toBeGreaterThan(0);

        expect(worldSeed).toEqual(target.population.getState().worldSeed);
    });
});

describe('SaveManager: skill re-initialization skips a person with no matching genealogy record', () => {
    test('a pre-v10 snapshot with a personId absent from the pool is skipped without crashing', () => {
        const source = makeWorld(15, 15);
        source.population.generate(4242);
        const pool = source.population.getPeople();
        const anyAdultId = Object.keys(pool).sort().find(id => {
            const person = pool[id]!;
            return person.deathTick === null && person.birthTick <= -30 * 8640;
        })!;
        const genPerson = pool[anyAdultId]!;

        source.field.loadStructure('house', 4, 4, 'h');
        const matched = source.field.loadPerson(72, 72);
        matched.social.setPersonId(anyAdultId);
        matched.social.setBirthTick(genPerson.birthTick);

        // A second, manually-created person carries no personId link back to the pool at all (the normal
        // state for any test/debug-spawned person) — the fallback re-init loop must skip them, not throw.
        const orphan = source.field.loadPerson(80, 80);
        orphan.social.setFirstName('Orphan');

        const manager = new SaveManager(source.game, new MemoryProvider());
        const snapshot = JSON.parse(decompress(manager.serialize())) as Record<string, unknown>;
        snapshot['version'] = 9;
        delete snapshot['skillBook'];

        const target = makeWorld(15, 15);
        const targetManager = new SaveManager(target.game, new MemoryProvider());
        expect(() => targetManager.deserialize(compress(JSON.stringify(snapshot)))).not.toThrow();

        // The matched adult still gets re-initialized (basics at 60).
        expect(target.skillBook.proficiency(anyAdultId, 'math')).toBe(60);
    });
});

// LP-1 (proposal simulation-aliveness-2 P0-1): the snapshot carries ONLY live-era log entries — hydrated
// pre-game pasts (100k+ entries/person) overflowed JSON.stringify and localStorage; they re-install from
// the pinned asset at load (GameManager.rehydratePersonLogs).
describe('SaveManager: live-era log serialization (LP-1)', () => {
    test('serialized eventLog excludes hydrated pre-game entries and keeps live ones', () => {
        const world = makeWorld(5, 5);
        const manager = new SaveManager(world.game, new MemoryProvider());

        world.eventEngine.installPersonLog('p1', [
            { tick: -500, kind: 'action', defId: 'sleep', instanceId: null, lifecycle: 'performed', params: {}, parentInstanceId: null, triggerSource: 'brain', causationId: null, seq: 9000 },
            { tick: -1, kind: 'action', defId: 'sleep', instanceId: null, lifecycle: 'performed', params: {}, parentInstanceId: null, triggerSource: 'brain', causationId: null, seq: 9001 },
        ]);
        // A live commit after hydration (what the running sim appends).
        world.eventEngine.getLifeLog().append('p1', { tick: 10, kind: 'action', defId: 'wander', instanceId: null, lifecycle: 'performed', params: {}, parentInstanceId: null, triggerSource: 'brain', causationId: null } as never);

        const snapshot = JSON.parse(decompress(manager.serialize())) as WorldSnapshot;
        const entries = snapshot.eventLog?.['p1'] ?? [];
        expect(entries).toHaveLength(1);
        expect(entries[0]!.defId).toBe('wander');
        // The seq counter still spans the full history so re-hydrated seqs never collide.
        expect(snapshot.eventLogSeq).toBeGreaterThan(9001);
    });
});
