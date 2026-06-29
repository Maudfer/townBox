import Field from '../src/app/game/Field';
import Workplace from '../src/app/game/Workplace';
import Person from '../src/app/game/Person';
import City from '../src/app/game/City';
import Economy from '../src/app/game/Economy';
import GameManager from '../src/app/game/GameManager';

import { unitMaterialCost } from '../src/util/businessFinance';
import { evaluateCurve } from '../src/util/curve';
import { BusinessBlueprint, BusinessBlueprintTable } from '../src/types/Business';
import { DemandTable } from '../src/types/Demand';
import { JobPosition, JobRequirements } from '../src/types/Work';
import { PixelPosition, TilePosition } from '../src/types/Position';

import businessesConfig from '../src/json/businesses.json';
import materialsConfig from '../src/json/materials.json';
import demandConfig from '../src/json/demand.json';

const BLUEPRINTS = businessesConfig as unknown as BusinessBlueprintTable;
const DEMAND = demandConfig as unknown as DemandTable;
const PRICES: Record<string, number> = Object.fromEntries(
    Object.entries(materialsConfig as Record<string, { basePrice: number }>).map(([k, v]) => [k, v.basePrice])
);

function job(title: string, salary: number): JobPosition {
    return { title, salary, requirements: [JobRequirements.RetailSkill], shiftStart: 540, shiftEnd: 1020 };
}

function makeWorld(): { city: City; field: Field; economy: Economy } {
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
    return { city, field, economy };
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
