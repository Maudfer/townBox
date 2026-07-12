import City from 'game/City';
import GameManager from 'game/GameManager';
import Person from 'game/agents/Person';
import Economy from 'game/economy/Economy';
import Population from 'game/population/Population';
import Field from 'game/world/Field';
import House from 'game/world/House';
import Workplace from 'game/world/Workplace';
import { BusinessBlueprint, BusinessBlueprintTable } from 'types/Business';
import { GenPerson, PersonId, PersonTable } from 'types/Genealogy';
import { HouseholdArrangements } from 'types/Household';
import { PixelPosition, TilePosition } from 'types/Position';
import { Genders, Gender } from 'types/Social';
import { JobPosition } from 'types/Work';
import { TICKS_PER_MONTH, TICKS_PER_YEAR } from 'util/time';
import businessesConfig from 'json/businesses.json';

const BLUEPRINTS = businessesConfig as unknown as BusinessBlueprintTable;

// City.processMonthlyEconomy (task 018-022/033/035/037/076) is the once-a-month gate that chains payroll,
// demand-driven P&L (growth/shrink/bankruptcy/B2B), vacant-lot re-occupancy, cost of living, eviction, and
// homeless recovery. economy/*.test.ts already exercises this from ITS OWN module's tests; this file
// re-derives the same behavior from execution's OWN tests (jest.config.js scopes City.ts into the
// `execution` module, so those other suites' coverage doesn't count toward this module's own number).

function job(title: string, salary: number): JobPosition {
    return { title, salary, requirements: [], shiftStart: 540, shiftEnd: 1020 };
}

function gen(id: string, gender: Gender, ageYears: number, tickNow: number, parents: { fatherId?: string; motherId?: string } = {}): GenPerson {
    return {
        id, firstName: id, familyName: 'Fam', gender,
        birthTick: tickNow - ageYears * TICKS_PER_YEAR, deathTick: null,
        fatherId: parents.fatherId ?? null, motherId: parents.motherId ?? null, partnerships: [],
    };
}

interface Harness { field: Field; population: Population; economy: Economy; city: City; emitted: { event: string; payload: unknown }[] }

function makeGame(rows: number, cols: number): Harness {
    const population = new Population();
    const economy = new Economy();
    const emitted: { event: string; payload: unknown }[] = [];
    const game = {
        field: null, population, economy,
        gridParams: { rows, cols, cells: { width: 16, height: 16 }, footprint: { tiles: 3, width: 48, height: 48 } },
        tileToPixelPosition: (p: TilePosition) => (p === null ? null : { x: p.col * 16 + 8, y: p.row * 16 + 8 }),
        pixelToTilePosition: (p: PixelPosition) => (p === null ? null : { row: Math.floor(p.y / 16), col: Math.floor(p.x / 16) }),
        emit: (event: string, payload: unknown) => { emitted.push({ event, payload }); return Promise.resolve([]); },
        emitSingle: () => {}, on: () => {}, toolbelt: {},
    } as unknown as GameManager;
    const field = new Field(game, rows, cols);
    (game as unknown as { field: Field }).field = field;
    const city = new City(game);
    return { field, population, economy, city, emitted };
}

function loadState(population: Population, people: PersonTable, placedIds: PersonId[]): void {
    population.loadState({ worldSeed: 9, people, drawSeed: 0, placedIds, nextSeq: Object.keys(people).length, lastSimulatedYear: 0 });
}

function materialize(field: Field, house: House | null, id: string, x: number, y: number): Person {
    const person = field.loadPerson(x, y);
    person.social.setPersonId(id);
    if (house) {
        person.social.setHome(house);
        house.addResident(person);
        house.addOccupant(person);
    }
    return person;
}

describe('processMonthlyEconomy: month gating', () => {
    test('is a no-op without an economy, and runs at most once per in-game month', () => {
        const game = {
            field: null, economy: null,
            gridParams: { rows: 5, cols: 5, cells: { width: 16, height: 16 }, footprint: { tiles: 3, width: 48, height: 48 } },
            tileToPixelPosition: () => null, pixelToTilePosition: () => null,
            emit: () => {}, emitSingle: () => {}, on: () => {}, toolbelt: {},
        } as unknown as GameManager;
        const field = new Field(game, 5, 5);
        (game as unknown as { field: Field }).field = field;
        const bareCity = new City(game);
        expect(() => bareCity.processMonthlyEconomy(0)).not.toThrow();

        const { economy, city } = makeGame(10, 10);
        city.processMonthlyEconomy(0);
        const monthAfterFirst = economy.getLastEconomyMonth();
        city.processMonthlyEconomy(1); // same month — gated, no re-run
        expect(economy.getLastEconomyMonth()).toBe(monthAfterFirst);
        city.processMonthlyEconomy(TICKS_PER_MONTH); // next month
        expect(economy.getLastEconomyMonth()).toBe(monthAfterFirst + 1);
    });
});

describe('runPayroll (task 018)', () => {
    test('pays salaries from the employer balance to the employee, and flags a business that goes into debt', () => {
        const { field, economy, city, emitted } = makeGame(20, 20);
        const workplace = field.loadStructure('work', 10, 10, 'w') as Workplace;
        workplace.setBusiness({ blueprintKey: 'x', name: 'Acme', lineOfWork: 'Test', size: 1, positions: [job('Clerk', 1000)] });
        const employee = field.loadPerson(160, 160);
        employee.social.setPersonId('e1');
        employee.work.setJob(job('Clerk', 1000));
        workplace.addEmployee(employee);
        const key = workplace.getIdentifier();
        economy.setBusinessBalance(key, 500); // less than payroll — goes into debt
        economy.setPersonBalance('e1', 0);

        city.processMonthlyEconomy(0);

        expect(economy.getPersonBalance('e1')).toBe(1000);
        expect(economy.getBusinessBalance(key)).toBe(-500);
        expect(emitted.some(e => e.event === 'cityEvent' && (e.payload as { kind: string }).kind === 'businessStress')).toBe(true);
    });
});

describe('runBusinessEconomics (tasks 020/021/033/035/076-M6)', () => {
    function staffedSupermarket(field: Field, economy: Economy, size: number, capital: number): Workplace {
        const workplace = field.loadStructure('work', 10, 10, 'w') as Workplace;
        workplace.setBusiness({ blueprintKey: 'supermarket', name: 'Mart', lineOfWork: 'Super Market', size, positions: [] });
        economy.setBusinessBalance(workplace.getIdentifier(), capital);
        return workplace;
    }

    test('a business with no open positions and sustained profit grows a size step', () => {
        const { field, economy, city, emitted } = makeGame(30, 30);
        const workplace = staffedSupermarket(field, economy, 1, 1_000_000);
        const clerk = field.loadPerson(160, 160);
        clerk.work.setJob(job('Clerk', 1000));
        workplace.addEmployee(clerk);
        for (let i = 0; i < 40; i++) {
            field.loadPerson(200 + i * 4, 260); // consumers -> plenty of demand
        }

        for (let month = 0; month <= 3; month++) {
            city.processMonthlyEconomy(month * TICKS_PER_MONTH);
        }

        expect(workplace.getBusiness()!.size).toBeGreaterThan(1);
        expect(emitted.some(e => e.event === 'cityEvent' && (e.payload as { kind: string }).kind === 'businessGrew')).toBe(true);
    });

    test('a solvent, sustainedly unprofitable, above-min business shrinks via layoffs (task 076/M6)', () => {
        const { field, economy, city, emitted } = makeGame(20, 20);
        const workplace = staffedSupermarket(field, economy, 2, 5_000_000); // above min(1); no consumers -> guaranteed losses
        for (let month = 0; month <= 4; month++) {
            city.processMonthlyEconomy(month * TICKS_PER_MONTH);
        }
        expect(workplace.getBusiness()).not.toBeNull();
        expect(workplace.getBusiness()!.size).toBe(1);
        expect(economy.getBusinessBalance(workplace.getIdentifier())).toBeGreaterThan(0);
        expect(emitted.some(e => e.event === 'cityEvent' && (e.payload as { kind: string }).kind === 'businessShrank')).toBe(true);
    });

    test('a sustainedly insolvent business goes bankrupt: laid off, cleared, debt written off, feed announces', () => {
        const { field, economy, city, emitted } = makeGame(20, 20);
        const workplace = staffedSupermarket(field, economy, 1, -1_000_000); // deep in the red
        const employee = field.loadPerson(160, 160);
        employee.social.setPersonId('e1');
        employee.work.setJob(job('Clerk', 1000));
        employee.work.setWorkplace(workplace);
        workplace.addEmployee(employee);
        const key = workplace.getIdentifier();

        // bankruptcyMonths = 3: closes on the third consecutive insolvent month (0, 1, 2). Stop there —
        // one more month would let runReoccupancy (which runs after runBusinessEconomics in the same
        // processMonthlyEconomy call) immediately re-fill the newly-vacant lot, which is a different test.
        for (let month = 0; month <= 2; month++) {
            city.processMonthlyEconomy(month * TICKS_PER_MONTH);
        }

        expect(workplace.getBusiness()).toBeNull();
        expect(employee.work.getJob()).toBeNull();
        expect(employee.work.getWorkplace()).toBeNull();
        expect(economy.getBusinessBalance(key)).toBe(0);
        expect(emitted.some(e => e.event === 'cityEvent' && (e.payload as { kind: string }).kind === 'businessClosed')).toBe(true);
        expect(emitted.some(e => e.event === 'cityEvent' && (e.payload as { kind: string }).kind === 'massLayoff')).toBe(true);
    });

    test('a producer earns B2B revenue only when downstream consumer demand exists (task 035)', () => {
        function farmPnl(withDownstreamDemand: boolean): number {
            const { field, economy, city } = makeGame(20, 20);
            for (let i = 0; i < 10; i++) {
                field.loadPerson(160 + i * 4, 200); // households drive groceries demand
            }
            const farm = field.loadStructure('work', 4, 4, 'f') as Workplace;
            farm.setBusiness({ blueprintKey: 'farm', name: 'Green Acres', lineOfWork: 'Farm', size: 1, positions: [] });
            const farmhand = field.loadPerson(70, 70);
            farmhand.work.setJob(job('Laborer', 1000));
            farm.addEmployee(farmhand);
            economy.setBusinessBalance(farm.getIdentifier(), 100_000);
            if (withDownstreamDemand) {
                const mart = field.loadStructure('work', 10, 10, 'm') as Workplace;
                mart.setBusiness({ blueprintKey: 'supermarket', name: 'Mart', lineOfWork: 'Super Market', size: 1, positions: [] });
                const clerk = field.loadPerson(160, 160);
                clerk.work.setJob(job('Clerk', 1000));
                mart.addEmployee(clerk);
                economy.setBusinessBalance(mart.getIdentifier(), 100_000);
            }
            city.processMonthlyEconomy(0);
            return farm.getBusiness()!.lastPnl ?? 0;
        }
        expect(farmPnl(true)).toBeGreaterThan(farmPnl(false));
    });
});

describe('runReoccupancy (task 037)', () => {
    test('a vacant lot attracts a new, different business after the cooldown given unmet demand', () => {
        const { field, economy, city, emitted } = makeGame(20, 20);
        const workplace = field.loadStructure('work', 10, 10, 'w') as Workplace;
        for (let i = 0; i < 12; i++) {
            field.loadPerson(160 + i * 4, 200);
        }

        city.processMonthlyEconomy(0);
        expect(workplace.getBusiness()).toBeNull();
        expect(workplace.getVacantMonths()).toBe(1);

        city.processMonthlyEconomy(TICKS_PER_MONTH);
        expect(workplace.getBusiness()).not.toBeNull();
        expect(workplace.getVacantMonths()).toBe(0);
        expect(economy.getBusinessBalance(workplace.getIdentifier())).toBeGreaterThan(0);
        expect(emitted.some(e => e.event === 'cityEvent' && (e.payload as { kind: string }).kind === 'businessOpened')).toBe(true);
    });

    test('a vacant lot with no unmet demand anywhere stays vacant indefinitely', () => {
        const { field, city } = makeGame(15, 15);
        const workplace = field.loadStructure('work', 10, 10, 'w') as Workplace;
        for (let month = 0; month < 6; month++) {
            city.processMonthlyEconomy(month * TICKS_PER_MONTH);
        }
        expect(workplace.getBusiness()).toBeNull();
    });
});

describe('runCostOfLiving + runEvictions + runRecovery (tasks 019/022/076-L3)', () => {
    test('a household that cannot cover cost of living accrues arrears until evicted, becoming homeless', () => {
        const { field, population, economy, city } = makeGame(20, 20);
        const a = gen('a', Genders.Female, 40, 0);
        loadState(population, { a }, ['a']);
        const house = field.loadStructure('house', 4, 4, 'building_1x1x1_1') as House;
        const personA = materialize(field, house, 'a', 72, 72);
        house.setHousehold({ id: 'hh-1', houseKey: house.getIdentifier(), headId: 'a', memberIds: ['a'], arrangement: HouseholdArrangements.Single });
        economy.setPersonBalance('a', 0);

        // 3 months of unaffordable cost of living -> arrears reaches the eviction threshold.
        for (let month = 0; month < 3; month++) {
            city.processMonthlyEconomy(month * TICKS_PER_MONTH);
        }

        expect(house.getHousehold()).toBeNull();
        expect(personA.social.getHome()).toBeNull();
        expect(personA.isIndoors()).toBe(true);
        expect(city.getHomelessHouseholds()).toHaveLength(1);
    });

    test('an evicted member is taken in by a solvent relative instead of becoming homeless', () => {
        const { field, population, economy, city } = makeGame(30, 30);
        const dad = gen('dad', Genders.Male, 80, 0); dad.deathTick = -1;
        const a = gen('a', Genders.Female, 40, 0, { fatherId: 'dad' });
        const sib = gen('sib', Genders.Male, 44, 0, { fatherId: 'dad' });
        loadState(population, { dad, a, sib }, ['a', 'sib']);

        const house1 = field.loadStructure('house', 4, 4, 'building_1x1x1_1') as House;
        const personA = materialize(field, house1, 'a', 72, 72);
        house1.setHousehold({ id: 'hh-1', houseKey: house1.getIdentifier(), headId: 'a', memberIds: ['a'], arrangement: HouseholdArrangements.Single });
        economy.setPersonBalance('a', 0);

        const house2 = field.loadStructure('house', 16, 16, 'building_1x1x1_1') as House;
        materialize(field, house2, 'sib', 256, 256);
        house2.setHousehold({ id: 'hh-2', houseKey: house2.getIdentifier(), headId: 'sib', memberIds: ['sib'], arrangement: HouseholdArrangements.Single });
        economy.setPersonBalance('sib', 100_000);

        for (let month = 0; month < 3; month++) {
            city.processMonthlyEconomy(month * TICKS_PER_MONTH);
        }

        expect(personA.social.getHome()).toBe(house2);
        expect(house2.getHousehold()!.memberIds).toContain('a');
        expect(city.getHomelessHouseholds()).toHaveLength(0);
    });

    test('a homeless household recovers into a fully vacant house once funds recover', () => {
        const { field, population, economy, city } = makeGame(20, 20);
        const a = gen('a', Genders.Female, 40, 0);
        loadState(population, { a }, ['a']);
        const personA = materialize(field, null, 'a', 72, 72);
        personA.setIndoors(true);
        economy.setPersonBalance('a', 5000); // above recoveryFunds
        city.setHomelessHouseholds([{ id: 'homeless-1', houseKey: '', headId: 'a', memberIds: ['a'], arrangement: HouseholdArrangements.Homeless }]);
        const vacant = field.loadStructure('house', 8, 8, 'building_1x1x1_1') as House;

        city.processMonthlyEconomy(0);

        expect(personA.social.getHome()).toBe(vacant);
        expect(vacant.getHousehold()!.memberIds).toEqual(['a']);
        expect(city.getHomelessHouseholds()).toHaveLength(0);
    });

    test('with no fully-vacant house, recovery falls back to a home with spare capacity (task 076/L3)', () => {
        const { field, population, economy, city } = makeGame(20, 20);
        const a = gen('a', Genders.Female, 40, 0);
        const b = gen('b', Genders.Male, 42, 0);
        loadState(population, { a, b }, ['a', 'b']);

        const occupied = field.loadStructure('house', 8, 8, 'building_1x1x1_1') as House;
        materialize(field, occupied, 'b', 130, 130);
        occupied.setHousehold({ id: 'hh-8-8', houseKey: occupied.getIdentifier(), headId: 'b', memberIds: ['b'], arrangement: HouseholdArrangements.Single });

        const personA = materialize(field, null, 'a', 72, 72);
        personA.setIndoors(true);
        economy.setPersonBalance('a', 5000);
        city.setHomelessHouseholds([{ id: 'homeless-1', houseKey: '', headId: 'a', memberIds: ['a'], arrangement: HouseholdArrangements.Homeless }]);

        city.processMonthlyEconomy(0);

        expect(personA.social.getHome()).toBe(occupied);
        expect(occupied.getHousehold()!.memberIds.sort()).toEqual(['a', 'b']);
    });

    test('a homeless household under the recovery threshold, or whose sole member has since died, stays put / gets pruned', () => {
        const { field, population, economy, city } = makeGame(20, 20);
        const a = gen('a', Genders.Female, 40, 0);
        const dead = gen('dead', Genders.Male, 90, 0);
        dead.deathTick = -1; // already dead at tick 0
        loadState(population, { a, dead }, ['a']);
        field.loadStructure('house', 8, 8, 'building_1x1x1_1'); // a vacant house exists, but funds are too low
        const personA = materialize(field, null, 'a', 72, 72);
        personA.setIndoors(true);
        economy.setPersonBalance('a', 10); // below recoveryFunds

        city.setHomelessHouseholds([
            { id: 'homeless-1', houseKey: '', headId: 'a', memberIds: ['a'], arrangement: HouseholdArrangements.Homeless },
            { id: 'homeless-2', houseKey: '', headId: 'dead', memberIds: ['dead'], arrangement: HouseholdArrangements.Homeless },
        ]);

        city.processMonthlyEconomy(0);

        // The low-funds household is untouched (still homeless); the all-dead household record is dropped.
        const remaining = city.getHomelessHouseholds();
        expect(remaining.map(h => h.id)).toEqual(['homeless-1']);
        expect(personA.social.getHome()).toBeNull();
    });
});

describe('B2B closure invariant (task 076/M5) — sanity check reused from the economy module', () => {
    test('every consumed material is produced by at least one blueprint', () => {
        const blueprints = businessesConfig as Record<string, { materialsPerUnit?: Record<string, number>; products?: Record<string, number> }>;
        const consumed = new Set<string>();
        const produced = new Set<string>();
        for (const blueprint of Object.values(blueprints)) {
            for (const material of Object.keys(blueprint.materialsPerUnit ?? {})) consumed.add(material);
            for (const material of Object.keys(blueprint.products ?? {})) produced.add(material);
        }
        expect([...consumed].filter(material => !produced.has(material))).toEqual([]);
    });
});

describe('money conservation across repeated monthly ticks (task 076/H3)', () => {
    test('the grand total (people + businesses + external) is invariant', () => {
        const { field, economy, city } = makeGame(20, 20);
        expect(economy.grandTotal()).toBe(0);
        const a: BusinessBlueprint = BLUEPRINTS['supermarket']!;
        const workplace = field.loadStructure('work', 10, 10, 'w') as Workplace;
        workplace.setBusiness({ blueprintKey: 'supermarket', name: 'A', lineOfWork: a.friendlyName, size: 2, positions: [] });
        economy.adjustBusiness(workplace.getIdentifier(), 40000);
        for (let i = 0; i < 10; i++) {
            const person = field.loadPerson(200 + i * 4, 200);
            person.social.setPersonId(`c${i}`);
            economy.adjustPerson(`c${i}`, 3000);
        }
        for (let month = 0; month < 6; month++) {
            city.processMonthlyEconomy(month * TICKS_PER_MONTH);
            expect(economy.grandTotal()).toBe(0);
        }
    });
});
