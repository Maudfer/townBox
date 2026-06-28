import SaveManager from '../src/app/game/save/SaveManager';
import Field from '../src/app/game/Field';
import House from '../src/app/game/House';
import Road from '../src/app/game/Road';
import Workplace from '../src/app/game/Workplace';
import GameManager from '../src/app/game/GameManager';
import City from '../src/app/game/City';
import Population from '../src/app/game/Population';
import Clock from '../src/app/game/Clock';

import { HouseholdArrangements } from '../src/types/Household';

import { SaveProvider } from '../src/app/game/save/SaveProvider';
import { encodeBase64, decodeBase64 } from '../src/util/base64';
import { Genders, Relationships } from '../src/types/Social';
import { JobRequirements } from '../src/types/Work';
import { PixelPosition, TilePosition } from '../src/types/Position';

// A provider backed by an in-memory map. Using it in tests proves the SaveProvider abstraction is the only
// thing SaveManager depends on (no localStorage required).
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
        getName() { return this._name; },
        setName(name: string) { this._name = name; },
        getPopulation() { return this._population; },
        setPopulation(population: number) { this._population = population; },
    };
    return city as unknown as City;
}

function makeWorld(rows: number, cols: number): { game: GameManager; field: Field; city: City; population: Population; clock: Clock } {
    const city = makeCity();
    const population = new Population();
    const clock = new Clock();
    const game = {
        field: null,
        city,
        population,
        clock,
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

    return { game, field, city, population, clock };
}

describe('base64 codec', () => {
    test('round-trips unicode strings', () => {
        const original = JSON.stringify({ city: 'São Paulo', note: 'açaí & coração' });
        expect(decodeBase64(encodeBase64(original))).toBe(original);
    });
});

describe('SaveManager round-trip', () => {
    test('save then load through a provider reproduces the world', async () => {
        const provider = new MemoryProvider();

        // --- Build and populate a source world -----------------------------
        const source = makeWorld(15, 15);
        source.city.setName('Testville');
        source.city.setPopulation(2);

        // A small genealogy pool to prove it round-trips through the save.
        source.population.generate(99, {
            ticksPerYear: 360,
            founderCouples: 10,
            generations: 2,
            childDistribution: [0.1, 0.3, 0.4, 0.2],
            pairingProbability: 0.8,
            immigrantSpouseProbability: 0.4,
            spouseMaxAgeGapYears: 12,
            parentMinAgeYears: 20,
            parentMaxAgeYears: 42,
            generationGapYears: 31,
            lifespanMeanYears: 78,
            lifespanSpreadYears: 16,
            maxPopulation: 2000,
        });
        expect(source.population.size()).toBeGreaterThan(0);

        // Clock advanced to a known time.
        source.clock.setElapsedMs(5 * 3_600_000 + 1_800_000); // 5.5 in-game days

        const house = source.field.loadStructure('house', 4, 4, 'building_1x1x1_1') as House;
        source.field.loadStructure('road', 7, 7, 'road_1100');
        const work = source.field.loadStructure('work', 10, 10, 'building_1x1x2_2') as Workplace;
        work.setBusiness({
            blueprintKey: 'supermarket',
            name: 'Round-Trip Mart',
            lineOfWork: 'Super Market',
            size: 4,
            positions: [
                { title: 'Checkout Clerk', salary: 1300, requirements: [JobRequirements.RetailSkill], shiftStart: 540, shiftEnd: 1020 },
                { title: 'Janitor', salary: 1100, requirements: [JobRequirements.CleaningSkill], shiftStart: 540, shiftEnd: 1020 },
            ],
        });

        const parent = source.field.loadPerson(72, 56);
        parent.social.setFirstName('Bob');
        parent.social.setFamilyName('Silva');
        parent.social.setAge(40);
        parent.social.setGender(Genders.Male);
        parent.social.setHome(house);
        parent.work.setSkills([JobRequirements.ConstructionSkill]);
        parent.work.setJob({ title: 'Constructor', salary: 1400, requirements: [JobRequirements.ConstructionSkill], shiftStart: 540, shiftEnd: 1020 });

        const child = source.field.loadPerson(72, 60);
        child.social.setFirstName('Cleo');
        child.social.setFamilyName('Silva');
        child.social.setAge(10);
        child.social.setGender(Genders.Female);
        child.social.setHome(house);

        parent.social.addRelationship(Relationships.Child, child);
        child.social.addRelationship(Relationships.Father, parent);

        house.addResident(parent);
        house.addResident(child);

        house.setHousehold({
            id: 'hh-4-4',
            houseKey: house.getIdentifier(),
            headId: 'p0',
            memberIds: ['p0', 'p1'],
            arrangement: HouseholdArrangements.Nuclear,
        });

        const sourceManager = new SaveManager(source.game, provider);
        await sourceManager.save('slot1');

        // --- Restore into a fresh world ------------------------------------
        const restored = makeWorld(15, 15);
        const restoredManager = new SaveManager(restored.game, provider);
        const loaded = await restoredManager.load('slot1');
        expect(loaded).toBe(true);

        // City
        expect(restored.city.getName()).toBe('Testville');
        expect(restored.city.getPopulation()).toBe(2);

        // Structures
        const structures = restored.field.getStructures();
        expect(structures).toHaveLength(3);
        const restoredHouse = restored.field.getTile(4, 4);
        expect(restoredHouse).toBeInstanceOf(House);
        expect(restored.field.getTile(7, 7)).toBeInstanceOf(Road);
        expect(restored.field.getTile(10, 10)).toBeInstanceOf(Workplace);

        // Business round-trips on the work building (v4).
        const restoredBusiness = (restored.field.getTile(10, 10) as Workplace).getBusiness();
        expect(restoredBusiness).not.toBeNull();
        expect(restoredBusiness!.name).toBe('Round-Trip Mart');
        expect(restoredBusiness!.lineOfWork).toBe('Super Market');
        expect(restoredBusiness!.size).toBe(4);
        expect(restoredBusiness!.positions).toHaveLength(2);

        // People + identity
        const people = restored.field.getPeople();
        expect(people).toHaveLength(2);

        const restoredParent = people.find(p => p.social.getInfo().firstName === 'Bob')!;
        const restoredChild = people.find(p => p.social.getInfo().firstName === 'Cleo')!;
        expect(restoredParent).toBeDefined();
        expect(restoredChild).toBeDefined();

        expect(restoredParent.social.getInfo().age).toBe(40);
        expect(restoredParent.social.getInfo().gender).toBe(Genders.Male);
        expect(restoredChild.social.getInfo().age).toBe(10);
        expect(restoredParent.getPosition()).toEqual({ x: 72, y: 56 });

        // Work
        expect(restoredParent.work.getJob()?.title).toBe('Constructor');
        expect(restoredParent.work.getSkills()).toContain(JobRequirements.ConstructionSkill);

        // Relationship graph (cyclic) reconstructed by reference
        const restoredChildren = restoredParent.social.getInfo().relationships[Relationships.Child];
        expect(restoredChildren).toBeDefined();
        expect(restoredChildren!.map(person => person.social.getInfo().firstName)).toContain('Cleo');
        expect(restoredChild.social.getInfo().relationships[Relationships.Father]).toBe(restoredParent);

        // Home linkage resolves to the restored house instance
        expect(restoredParent.social.getHome()).toBe(restoredHouse);

        // Household + occupancy
        const restoredHousehold = (restoredHouse as House).getHousehold();
        expect(restoredHousehold).not.toBeNull();
        expect(restoredHousehold!.arrangement).toBe(HouseholdArrangements.Nuclear);
        expect(restoredHousehold!.memberIds).toEqual(['p0', 'p1']);
        expect((restoredHouse as House).getResidents()).toHaveLength(2);

        // Genealogy pool survives the round-trip intact.
        expect(restored.population.size()).toBe(source.population.size());
        expect(restored.population.getState()).toEqual(source.population.getState());

        // Clock state survives the round-trip.
        expect(restored.clock.getElapsedMs()).toBe(source.clock.getElapsedMs());
        expect(restored.clock.getTimestamp().absoluteDay).toBe(5);
    });

    test('load returns false when the slot is empty', async () => {
        const provider = new MemoryProvider();
        const world = makeWorld(9, 9);
        const manager = new SaveManager(world.game, provider);

        expect(await manager.load('missing')).toBe(false);
    });
});
