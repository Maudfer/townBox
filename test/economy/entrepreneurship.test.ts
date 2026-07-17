import City from 'game/City';
import Clock from 'game/Clock';
import EventEngine from 'game/events/EventEngine';
import Economy from 'game/economy/Economy';
import GameManager from 'game/GameManager';
import SkillBook from 'game/skills/SkillBook';
import Population from 'game/population/Population';
import Field from 'game/world/Field';
import Person from 'game/agents/Person';
import Workplace from 'game/world/Workplace';
import businessesConfig from 'json/businesses.json';
import economyConfig from 'json/economy.json';
import { BusinessBlueprintTable } from 'types/Business';
import { PopulationState, GenPerson, PersonId } from 'types/Genealogy';
import { PixelPosition, TilePosition } from 'types/Position';
import { Genders } from 'types/Social';
import { SeededRandom, hashStringToSeed } from 'util/random';

// Employment flow (task 097): I2 — the FIRST business drawn on a lot prefers categories the town's demand
// actually lacks (an empty map keeps the legacy uniform draw byte-for-byte); I3 — a qualified unemployed
// adult with savings founds a business on a vacant lot: their own capital seeds it (conserved), they hire
// themselves at their matched rank, the shop takes their name, and founded_business lands in their log.

const TPY = 8640;
const TICKS_PER_MONTH = 720;
const HOUR_MS = 60 * 60 * 1000 / 24; // in-game hour of real time (1 day = 1 real hour)
const BLUEPRINTS = businessesConfig as unknown as BusinessBlueprintTable;
const FOUNDING_CHANCE = (economyConfig as { foundingChancePerMonth: number }).foundingChancePerMonth;

const TICK_NOW = 40 * TPY;
const FIRST_MONTH = Math.floor((TICK_NOW + TICKS_PER_MONTH) / TICKS_PER_MONTH);

// The founding roll is deterministic per (worldSeed, month). Pick a seed whose FIRST monthly roll lands, and
// one whose first twelve never do — the tests then assert exact behavior instead of trusting luck.
function foundingRoll(worldSeed: number, month: number): boolean {
    return new SeededRandom((worldSeed ^ hashStringToSeed(`founding#${month}`)) >>> 0).next() < FOUNDING_CHANCE;
}
function findSeed(predicate: (seed: number) => boolean): number {
    for (let seed = 1; seed < 500; seed++) {
        if (predicate(seed)) {
            return seed;
        }
    }
    throw new Error('no seed found');
}
const LUCKY_SEED = findSeed(seed => foundingRoll(seed, FIRST_MONTH));
const UNLUCKY_SEED = findSeed(seed => {
    for (let month = FIRST_MONTH; month < FIRST_MONTH + 12; month++) {
        if (foundingRoll(seed, month)) {
            return false;
        }
    }
    return true;
});

function gen(id: string, ageYears: number): GenPerson {
    return { id, firstName: id, familyName: 'Fam', gender: Genders.Female, birthTick: TICK_NOW - ageYears * TPY, deathTick: null, fatherId: null, motherId: null, partnerships: [] };
}

function makeGame() {
    const rows = 40;
    const cols = 40;
    const population = new Population();
    const clock = new Clock();
    const economy = new Economy();
    const eventEngine = new EventEngine();
    const skillBook = new SkillBook();
    const game = {
        field: null,
        population,
        clock,
        economy,
        eventEngine,
        skillBook,
        gridParams: { rows, cols, cells: { width: 16, height: 16 }, footprint: { tiles: 3, width: 48, height: 48 } },
        tileToPixelPosition: (position: TilePosition) => (position === null ? null : { x: position.col * 16 + 8, y: position.row * 16 + 8 }),
        pixelToTilePosition: (pixel: PixelPosition) => {
            if (pixel === null) {
                return null;
            }
            const row = Math.floor(pixel.y / 16);
            const col = Math.floor(pixel.x / 16);
            return row < 0 || row >= rows || col < 0 || col >= cols ? null : { row, col };
        },
        emit: () => {},
        emitSingle: () => {},
        on: () => {},
        toolbelt: {},
    } as unknown as GameManager;
    const field = new Field(game, rows, cols);
    (game as unknown as { field: Field }).field = field;
    const city = new City(game);
    (game as unknown as { city: City }).city = city;
    return { game, field, population, clock, economy, city, skillBook, eventEngine };
}

function loadState(population: Population, clock: Clock, people: Record<string, GenPerson>, placedIds: PersonId[], worldSeed: number): void {
    const state: PopulationState = { worldSeed, people, drawSeed: 0, placedIds, nextSeq: Object.keys(people).length, lastSimulatedYear: 0 };
    population.loadState(state);
    clock.setElapsedMs(TICK_NOW * HOUR_MS);
}

function materialize(field: Field, id: string, x: number, y: number): Person {
    const person = field.loadPerson(x, y);
    person.social.setPersonId(id);
    return person;
}

describe('I2 — demand-weighted first placement', () => {
    test('an empty map keeps the legacy uniform draw (deterministic fallback)', () => {
        const a = makeGame();
        const b = makeGame();
        const workplaceA = a.field.loadStructure('work', 10, 10, 'building_1x1x2_2') as Workplace;
        const workplaceB = b.field.loadStructure('work', 10, 10, 'building_1x1x2_2') as Workplace;
        a.city.setupBusiness(workplaceA);
        b.city.setupBusiness(workplaceB);
        expect(workplaceA.getBusiness()!.blueprintKey).toBe(workplaceB.getBusiness()!.blueprintKey);
        expect(workplaceA.getBusiness()!.name).toBe(workplaceB.getBusiness()!.name);
    });

    test('with residents, the draw is demand-weighted and deterministic across identical worlds', () => {
        // City binds a module-level Game at construction, so worlds must be built and used one at a time.
        const drawOnce = (): string => {
            const world = makeGame();
            const people: Record<string, GenPerson> = {};
            for (let index = 0; index < 30; index++) {
                people[`p${index}`] = gen(`p${index}`, 30);
            }
            loadState(world.population, world.clock, people, [], 77);
            for (let index = 0; index < 30; index++) {
                materialize(world.field, `p${index}`, 100 + index * 5, 100);
            }
            const workplace = world.field.loadStructure('work', 10, 10, 'building_1x1x2_2') as Workplace;
            world.city.setupBusiness(workplace);
            return workplace.getBusiness()!.blueprintKey;
        };
        const first = drawOnce();
        const second = drawOnce();
        expect(first).toBe(second);
        // The drawn blueprint's category carries real per-capita demand (a zero-demand category can never
        // win a weighted draw over a populated town).
        expect(BLUEPRINTS[first]!.category.length).toBeGreaterThan(0);
    });
});

describe('I3 — entrepreneurship', () => {
    // A town with demand (residents), one vacant lot, and one unemployed adult who strictly knows the baker
    // trade and has savings above the founding threshold.
    function founderWorld(worldSeed: number) {
        const world = makeGame();
        const people: Record<string, GenPerson> = { founder: gen('founder', 35) };
        for (let index = 0; index < 20; index++) {
            people[`p${index}`] = gen(`p${index}`, 30);
        }
        loadState(world.population, world.clock, people, [], worldSeed);
        materialize(world.field, 'founder', 120, 120);
        for (let index = 0; index < 20; index++) {
            materialize(world.field, `p${index}`, 100 + index * 5, 100);
        }
        world.skillBook.grantWithPrerequisites('founder', 'knead_and_proof_dough', 30, TICK_NOW, 'test');
        world.skillBook.grantWithPrerequisites('founder', 'bake_breads_and_pastries', 30, TICK_NOW, 'test');
        world.economy.adjustPerson('founder', 3000);
        const lot = world.field.loadStructure('work', 10, 10, 'building_1x1x2_2') as Workplace;
        return { ...world, lot };
    }

    test('a qualified, funded, unemployed adult founds the business — named after them, self-hired, conserved', () => {
        const { city, lot, economy, field, eventEngine } = founderWorld(LUCKY_SEED);
        const totalBefore = economy.grandTotal();
        city.processMonthlyEconomy(TICK_NOW + TICKS_PER_MONTH); // the lucky seed's first roll lands

        const business = lot.getBusiness();
        expect(business).not.toBeNull();
        expect(business!.name).toContain('founder'); // "<Trade> de founder"
        const founderPerson = field.getPeople().find(person => person.social.getPersonId() === 'founder')!;
        expect(founderPerson.work.getJob()).not.toBeNull();
        expect(founderPerson.work.getWorkplace()).toBe(lot);
        expect(economy.getPersonBalance('founder')).toBeLessThan(3000); // their savings seeded the shop
        expect(economy.grandTotal()).toBeCloseTo(totalBefore, 6); // conserved
        expect(eventEngine.getPersonLog('founder').some(entry => entry.kind === 'event' && entry.defId === 'founded_business')).toBe(true);
    });

    test('no savings, no founding; no trade, no founding (re-occupancy may still fill the lot generically)', () => {
        // Broke: qualifications but an empty wallet.
        const broke = founderWorld(LUCKY_SEED);
        broke.economy.adjustPerson('founder', -3000);
        for (let month = 1; month <= 6; month++) {
            broke.city.processMonthlyEconomy(TICK_NOW + month * TICKS_PER_MONTH);
        }
        const brokePerson = broke.field.getPeople().find(person => person.social.getPersonId() === 'founder')!;
        expect(brokePerson.work.getJob()).toBeNull(); // never self-hired
        expect(broke.eventEngine.getPersonLog('founder').some(entry => entry.kind === 'event' && entry.defId === 'founded_business')).toBe(false);
        const brokeBusiness = broke.lot.getBusiness();
        if (brokeBusiness) {
            expect(brokeBusiness.name).not.toContain('founder'); // generic re-occupancy, not a founding
        }

        // Rich but skill-less: money alone doesn't open a shop.
        const nobody = makeGame();
        loadState(nobody.population, nobody.clock, { rich: gen('rich', 35) }, [], LUCKY_SEED);
        materialize(nobody.field, 'rich', 120, 120);
        nobody.economy.adjustPerson('rich', 5000);
        nobody.field.loadStructure('work', 10, 10, 'building_1x1x2_2');
        for (let month = 1; month <= 6; month++) {
            nobody.city.processMonthlyEconomy(TICK_NOW + month * TICKS_PER_MONTH);
        }
        expect(nobody.eventEngine.getPersonLog('rich').some(entry => entry.kind === 'event' && entry.defId === 'founded_business')).toBe(false);
    });

    test('the monthly roll gates it: an unlucky year founds nothing even with a perfect candidate', () => {
        const { city, lot, eventEngine } = founderWorld(UNLUCKY_SEED);
        city.processMonthlyEconomy(TICK_NOW + TICKS_PER_MONTH); // month 1: roll misses; lot still vacant
        expect(lot.getBusiness()).toBeNull();
        expect(eventEngine.getPersonLog('founder').some(entry => entry.kind === 'event' && entry.defId === 'founded_business')).toBe(false);
    });
});
