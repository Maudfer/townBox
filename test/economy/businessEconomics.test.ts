import City from 'game/City';
import GameManager from 'game/GameManager';
import Person from 'game/agents/Person';
import Economy from 'game/economy/Economy';
import Field from 'game/world/Field';
import Workplace from 'game/world/Workplace';
import businessesConfig from 'json/businesses.json';
import demandConfig from 'json/demand.json';
import materialsConfig from 'json/materials.json';
import { BusinessBlueprint, BusinessBlueprintTable } from 'types/Business';
import { DemandTable } from 'types/Demand';
import { PixelPosition, TilePosition } from 'types/Position';
import {JobPosition} from 'types/Work';
import { unitMaterialCost } from 'util/businessFinance';
import { evaluateCurve } from 'util/curve';
import { TICKS_PER_MONTH } from 'util/time';

const BLUEPRINTS = businessesConfig as unknown as BusinessBlueprintTable;
const DEMAND = demandConfig as unknown as DemandTable;
const PRICES: Record<string, number> = Object.fromEntries(
    Object.entries(materialsConfig as Record<string, { basePrice: number }>).map(([k, v]) => [k, v.basePrice])
);

function job(title: string, salary: number): JobPosition {
    return { title, salary, requirements: ['assist_customers'], shiftStart: 540, shiftEnd: 1020 };
}

function makeWorld(): { city: City; field: Field; economy: Economy; game: GameManager } {
    const rows = 40;
    const cols = 40;
    const economy = new Economy();
    const game = {
        field: null,
        economy,
        gridParams: { rows, cols, cells: { width: 16, height: 16 }, footprint: { tiles: 3, width: 48, height: 48 } },
        tileToPixelPosition: (p: TilePosition) => (p === null ? null : { x: p.col * 16 + 8, y: p.row * 16 + 8 }),
        pixelToTilePosition: (p: PixelPosition) => (p === null ? null : { row: Math.floor(p.y / 16), col: Math.floor(p.x / 16) }),
        emit: () => Promise.resolve([]),
        emitSingle: () => {},
        on: () => {},
        toolbelt: {},
    } as unknown as GameManager;
    const field = new Field(game, rows, cols);
    (game as unknown as { field: Field }).field = field;
    const city = new City(game);
    return { city, field, economy, game };
}

describe('Workplace.expandPositions (task 020 growth)', () => {
    test('appends open slots, bumps size, and leaves employees untouched', () => {
        const workplace = new Workplace(0, 0, null);
        workplace.setBusiness({ blueprintKey: 'x', name: 'A', lineOfWork: 'X', size: 1, positions: [job('Clerk', 1000)] });
        const employee = new Person(0, 0);
        workplace.addEmployee(employee);

        const openBefore = workplace.getOpenPositions().length;
        workplace.expandPositions(2, [job('Clerk', 1000), job('Clerk', 1000)], [job('Clerk', 1000)]);

        expect(workplace.getBusiness()!.size).toBe(2);
        expect(workplace.getOpenPositions()).toHaveLength(openBefore + 1);
        expect(workplace.getEmployees()).toContain(employee);
    });
});

describe('Workplace.closeBusiness (task 021 bankruptcy)', () => {
    test('clears employees, open positions, and the business; returns the laid-off staff', () => {
        const workplace = new Workplace(0, 0, null);
        workplace.setBusiness({ blueprintKey: 'x', name: 'A', lineOfWork: 'X', size: 1, positions: [job('Clerk', 1000)] });
        const employee = new Person(0, 0);
        workplace.addEmployee(employee);

        const laidOff = workplace.closeBusiness();

        expect(laidOff).toContain(employee);
        expect(workplace.getBusiness()).toBeNull();
        expect(workplace.getEmployees()).toHaveLength(0);
        expect(workplace.getOpenPositions()).toHaveLength(0);
    });
});

describe('City demand-driven business economics (task 033)', () => {
    test('revenue is driven by population demand; P&L applied to the balance and recorded', () => {
        const { city, field, economy } = makeWorld();

        // A supermarket with one clerk, plus consumers so groceries demand stays below capacity.
        const workplace = field.loadStructure('work', 10, 10, 'w') as Workplace;
        const supermarket: BusinessBlueprint = BLUEPRINTS['supermarket']!;
        workplace.setBusiness({ blueprintKey: 'supermarket', name: 'Mart', lineOfWork: supermarket.friendlyName, size: 1, positions: [] });
        const clerk = field.loadPerson(160, 160);
        clerk.social.setPersonId('e1');
        clerk.work.setJob(job('Clerk', 1000));
        workplace.addEmployee(clerk);
        for (let i = 0; i < 9; i++) {
            field.loadPerson(160 + i * 4, 200); // consumers
        }

        const key = workplace.getIdentifier();
        economy.setBusinessBalance(key, 100000);

        const population = field.getPeople().length; // 10
        const demand = population * DEMAND['groceries']!.perCapita;
        const capacity = 1 * DEMAND['groceries']!.throughputPerEmployee;
        const unitsSold = Math.min(capacity, demand);
        const price = DEMAND['groceries']!.pricePerUnit * (supermarket.economics?.priceMarkup ?? 1);
        const revenue = unitsSold * price;
        const materials = unitsSold * unitMaterialCost(supermarket, PRICES);
        const fixed = evaluateCurve(supermarket.economics!.fixedCostsPerMonth!, 1);

        city.processMonthlyEconomy(0);

        expect(economy.getBusinessBalance(key)).toBe(100000 - 1000 + (revenue - materials - fixed));
        expect(workplace.getBusiness()!.lastPnl).toBe(revenue - materials - fixed - 1000);
        expect(economy.getPersonBalance('e1')).toBe(1000); // employee paid
    });

    test('a larger population yields more revenue (higher P&L) below capacity', () => {
        function pnlWithPopulation(extraConsumers: number): number {
            const { city, field, economy } = makeWorld();
            const workplace = field.loadStructure('work', 10, 10, 'w') as Workplace;
            workplace.setBusiness({ blueprintKey: 'supermarket', name: 'Mart', lineOfWork: 'Super Market', size: 1, positions: [] });
            const clerk = field.loadPerson(160, 160);
            clerk.work.setJob(job('Clerk', 1000));
            workplace.addEmployee(clerk);
            for (let i = 0; i < extraConsumers; i++) {
                field.loadPerson(200 + i * 4, 200);
            }
            economy.setBusinessBalance(workplace.getIdentifier(), 100000);
            city.processMonthlyEconomy(0);
            return workplace.getBusiness()!.lastPnl ?? 0;
        }

        expect(pnlWithPopulation(12)).toBeGreaterThan(pnlWithPopulation(2));
    });
});

describe('City business bankruptcy (task 021)', () => {
    test('a sustainedly insolvent business closes: staff laid off, building vacated, debt written off', () => {
        const { city, field, economy, game } = makeWorld();
        const emit = jest.fn((..._args: unknown[]) => Promise.resolve([]));
        (game as unknown as { emit: typeof emit }).emit = emit;

        const workplace = field.loadStructure('work', 10, 10, 'w') as Workplace;
        workplace.setBusiness({ blueprintKey: 'supermarket', name: 'Mart', lineOfWork: 'Super Market', size: 1, positions: [] });
        const clerk = field.loadPerson(160, 160);
        clerk.social.setPersonId('e1');
        clerk.work.setJob(job('Clerk', 1000));
        clerk.work.setWorkplace(workplace);
        workplace.addEmployee(clerk);

        const key = workplace.getIdentifier();
        economy.setBusinessBalance(key, -100000); // deep in the red, below the debt floor

        // Insolvent every month → bankruptcy on the third consecutive one (bankruptcyMonths = 3).
        city.processMonthlyEconomy(0);
        expect(workplace.getBusiness()).not.toBeNull();
        city.processMonthlyEconomy(TICKS_PER_MONTH);
        expect(workplace.getBusiness()).not.toBeNull();
        city.processMonthlyEconomy(2 * TICKS_PER_MONTH);

        expect(workplace.getBusiness()).toBeNull(); // closed → vacant
        expect(workplace.getEmployees()).toHaveLength(0); // everyone laid off
        expect(clerk.work.getJob()).toBeNull(); // job cleared → re-enters the market (015)
        expect(clerk.work.getWorkplace()).toBeNull();
        expect(economy.getBusinessBalance(key)).toBe(0); // unrecoverable debt written off
        expect(emit.mock.calls.some(call => call[0] === 'cityEvent' && (call[1] as { kind: string }).kind === 'businessClosed')).toBe(true);
    });

    test('a solvent business is left alone', () => {
        const { city, field, economy } = makeWorld();
        const workplace = field.loadStructure('work', 10, 10, 'w') as Workplace;
        workplace.setBusiness({ blueprintKey: 'supermarket', name: 'Mart', lineOfWork: 'Super Market', size: 1, positions: [] });
        const key = workplace.getIdentifier();
        economy.setBusinessBalance(key, 100000); // comfortably above the debt floor

        for (let month = 0; month < 5; month++) {
            city.processMonthlyEconomy(month * TICKS_PER_MONTH);
        }

        expect(workplace.getBusiness()).not.toBeNull();
        expect(workplace.getBusiness()!.insolventMonths ?? 0).toBe(0);
    });
});

describe('City vacant-lot re-occupancy (task 037)', () => {
    test('a vacant lot attracts a new business only after the cooldown, given unmet demand', () => {
        const { city, field, economy, game } = makeWorld();
        const emit = jest.fn((..._args: unknown[]) => Promise.resolve([]));
        (game as unknown as { emit: typeof emit }).emit = emit;

        // A vacant work building (loadStructure does not run setupBusiness) plus consumers → unmet demand.
        const workplace = field.loadStructure('work', 10, 10, 'w') as Workplace;
        expect(workplace.getBusiness()).toBeNull();
        for (let i = 0; i < 10; i++) {
            field.loadPerson(160 + i * 4, 200);
        }

        // reoccupancyMonths = 2: still vacant after one month, re-occupied after the second.
        city.processMonthlyEconomy(0);
        expect(workplace.getBusiness()).toBeNull();
        expect(workplace.getVacantMonths()).toBe(1);

        city.processMonthlyEconomy(TICKS_PER_MONTH);
        expect(workplace.getBusiness()).not.toBeNull();
        expect(economy.getBusinessBalance('10-10')).toBeGreaterThan(0); // capital reseeded
        expect(workplace.getVacantMonths()).toBe(0);
        expect(emit.mock.calls.some(call => call[0] === 'cityEvent' && (call[1] as { kind: string }).kind === 'businessOpened')).toBe(true);
    });

    test('a vacant lot with no demand (no consumers) stays vacant', () => {
        const { city, field } = makeWorld();
        const workplace = field.loadStructure('work', 10, 10, 'w') as Workplace;

        for (let month = 0; month < 6; month++) {
            city.processMonthlyEconomy(month * TICKS_PER_MONTH);
        }

        expect(workplace.getBusiness()).toBeNull();
    });

    test('a re-occupied lot draws a different business than the one that failed (varied generation)', () => {
        const { city, field } = makeWorld();
        const workplace = field.loadStructure('work', 10, 10, 'w') as Workplace;

        city.setupBusiness(workplace); // generation 0
        const firstName = workplace.getBusiness()!.name;
        expect(workplace.getBusinessGenerations()).toBe(1);

        // Simulate bankruptcy + an elapsed cooldown, with consumers to create demand.
        workplace.closeBusiness();
        workplace.setVacantMonths(99);
        for (let i = 0; i < 10; i++) {
            field.loadPerson(160 + i * 4, 200);
        }

        city.processMonthlyEconomy(0);

        expect(workplace.getBusiness()).not.toBeNull();
        expect(workplace.getBusinessGenerations()).toBe(2);
        expect(workplace.getBusiness()!.name).not.toBe(firstName);
    });
});

describe('City B2B supply chain (task 035)', () => {
    // A producer (farm) earns revenue only when downstream consumers create demand for the material it makes.
    function farmPnl(withConsumerDemand: boolean): number {
        const { city, field, economy } = makeWorld();
        for (let i = 0; i < 10; i++) {
            field.loadPerson(160 + i * 4, 200); // households (groceries demand)
        }

        const farm = field.loadStructure('work', 4, 4, 'f') as Workplace;
        farm.setBusiness({ blueprintKey: 'farm', name: 'Green Acres', lineOfWork: 'Farm', size: 1, positions: [] });
        const farmhand = field.loadPerson(70, 70);
        farmhand.social.setPersonId('fh');
        farmhand.work.setJob(job('Laborer', 1000));
        farm.addEmployee(farmhand);
        economy.setBusinessBalance(farm.getIdentifier(), 100000);

        if (withConsumerDemand) {
            // A supermarket sells groceries to the households, which makes it buy groceries_wholesale — the
            // material the farm produces, so the farm gets B2B revenue.
            const mart = field.loadStructure('work', 10, 10, 'm') as Workplace;
            mart.setBusiness({ blueprintKey: 'supermarket', name: 'Mart', lineOfWork: 'Super Market', size: 1, positions: [] });
            const clerk = field.loadPerson(160, 160);
            clerk.social.setPersonId('c1');
            clerk.work.setJob(job('Clerk', 1000));
            mart.addEmployee(clerk);
            economy.setBusinessBalance(mart.getIdentifier(), 100000);
        }

        city.processMonthlyEconomy(0);
        return farm.getBusiness()!.lastPnl ?? 0;
    }

    test('a producer earns B2B revenue from downstream material demand', () => {
        expect(farmPnl(true)).toBeGreaterThan(farmPnl(false));
    });

    test('with no downstream demand the producer only bleeds costs (negative P&L)', () => {
        expect(farmPnl(false)).toBeLessThan(0);
    });
});

// B2B closure (task 076/M5): every material a business CONSUMES must be produced by some blueprint, or its
// demand is captured by nobody and the money paid for it silently leaves the economy.
describe('B2B supply-chain closure (task 076/M5)', () => {
    test('every consumed material is produced by at least one blueprint', () => {
        const blueprints = businessesConfig as Record<string, { materialsPerUnit?: Record<string, number>; products?: Record<string, number> }>;
        const consumed = new Set<string>();
        const produced = new Set<string>();
        for (const blueprint of Object.values(blueprints)) {
            for (const material of Object.keys(blueprint.materialsPerUnit ?? {})) consumed.add(material);
            for (const material of Object.keys(blueprint.products ?? {})) produced.add(material);
        }
        const unsupplied = [...consumed].filter(material => !produced.has(material)).sort();
        expect(unsupplied).toEqual([]);
    });
});

// Business shrink-via-layoffs (task 076/M6): a solvent but sustainedly loss-making, over-min business
// downsizes instead of only ever growing or bankrupting.
describe('City business shrink-via-layoffs (task 076/M6)', () => {
    test('a solvent, sustainedly unprofitable, over-min business sheds a size step and lays off surplus', () => {
        const { city, field, economy, game } = makeWorld();
        const emit = jest.fn((..._args: unknown[]) => Promise.resolve([]));
        (game as unknown as { emit: typeof emit }).emit = emit;

        const workplace = field.loadStructure('work', 10, 10, 'w') as Workplace;
        // Size 2 (above supermarket's min of 1); no consumers → guaranteed monthly losses; solvent balance so
        // it never bankrupts (stays above the debt floor) — the shrink path, not the bankruptcy path.
        workplace.setBusiness({ blueprintKey: 'supermarket', name: 'Mart', lineOfWork: 'Super Market', size: 2, positions: [] });
        const key = workplace.getIdentifier();
        economy.setBusinessBalance(key, 5_000_000);

        for (let month = 0; month <= 4; month++) {
            city.processMonthlyEconomy(month * TICKS_PER_MONTH);
        }

        expect(workplace.getBusiness()).not.toBeNull();          // solvent — did NOT bankrupt
        expect(workplace.getBusiness()!.size).toBe(1);           // shrank one step
        expect(economy.getBusinessBalance(key)).toBeGreaterThan(0);
        expect(emit.mock.calls.some(call => call[0] === 'cityEvent' && (call[1] as { kind: string }).kind === 'businessShrank')).toBe(true);
    });
});

// Money conservation across the live monthly economy (task 076/H3): the grand total (local + external) must
// not drift over repeated economic ticks — the property that lets a long offline run stay stable.
describe('economy-wide money conservation (task 076/H3)', () => {
    test('the grand total is invariant across many monthly economic ticks', () => {
        const { city, field, economy } = makeWorld();
        expect(economy.grandTotal()).toBe(0);

        // A couple of businesses (capital injected from external) and some resident-consumers.
        const a = field.loadStructure('work', 10, 10, 'wa') as Workplace;
        a.setBusiness({ blueprintKey: 'supermarket', name: 'A', lineOfWork: 'Super Market', size: 2, positions: [] });
        economy.adjustBusiness(a.getIdentifier(), 40000);
        const b = field.loadStructure('work', 20, 20, 'wb') as Workplace;
        b.setBusiness({ blueprintKey: 'restaurant', name: 'B', lineOfWork: 'Restaurant', size: 2, positions: [] });
        economy.adjustBusiness(b.getIdentifier(), 40000);
        for (let i = 0; i < 12; i++) {
            const person = field.loadPerson(200 + i * 4, 200);
            economy.adjustPerson(`c${i}`, 3000);
            person.social.setPersonId(`c${i}`);
        }

        for (let month = 0; month < 8; month++) {
            city.processMonthlyEconomy(month * TICKS_PER_MONTH);
            expect(economy.grandTotal()).toBe(0); // conserved every month — no minting/burning drift
        }
    });
});
