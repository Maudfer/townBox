import Field from '../src/app/game/Field';
import Workplace from '../src/app/game/Workplace';
import Person from '../src/app/game/Person';
import City from '../src/app/game/City';
import Economy from '../src/app/game/Economy';
import GameManager from '../src/app/game/GameManager';

import { computeBusinessPnl } from '../src/util/businessFinance';
import { BusinessBlueprint, BusinessBlueprintTable } from '../src/types/Business';
import { JobPosition, JobRequirements } from '../src/types/Work';
import { PixelPosition, TilePosition } from '../src/types/Position';

import businessesConfig from '../src/json/businesses.json';
import materialsConfig from '../src/json/materials.json';

const BLUEPRINTS = businessesConfig as unknown as BusinessBlueprintTable;
const PRICES: Record<string, number> = Object.fromEntries(
    Object.entries(materialsConfig as Record<string, { basePrice: number }>).map(([k, v]) => [k, v.basePrice])
);

function job(title: string, salary: number): JobPosition {
    return { title, salary, requirements: [JobRequirements.RetailSkill], shiftStart: 540, shiftEnd: 1020 };
}

function makeWorld(): { city: City; field: Field; economy: Economy } {
    const rows = 30;
    const cols = 30;
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

describe('City business economics (task 020)', () => {
    test('applies the monthly P&L to the business balance and records it', () => {
        const { city, field, economy } = makeWorld();
        const workplace = field.loadStructure('work', 10, 10, 'w') as Workplace;
        const size = 1;
        const supermarket: BusinessBlueprint = BLUEPRINTS['supermarket']!;
        workplace.setBusiness({ blueprintKey: 'supermarket', name: 'Mart', lineOfWork: supermarket.friendlyName, size, positions: [] });

        const employee = field.loadPerson(160, 160);
        employee.social.setPersonId('e1');
        employee.work.setJob(job('Clerk', 1000));
        workplace.addEmployee(employee);

        const key = workplace.getIdentifier();
        economy.setBusinessBalance(key, 100000);
        economy.setPersonBalance('e1', 0);

        const expected = computeBusinessPnl(supermarket, size, 1000, PRICES);

        city.processMonthlyEconomy(0);

        // Payroll (1000) was paid out, then the income side (revenue − materials − fixed) was applied.
        const incomeSide = expected.revenue - expected.materialsCost - expected.fixedCosts;
        expect(economy.getBusinessBalance(key)).toBe(100000 - 1000 + incomeSide);
        expect(workplace.getBusiness()!.lastPnl).toBe(expected.pnl);
        // The seeded supermarket runs at a loss at size 1, so the streak goes negative.
        expect(workplace.getBusiness()!.profitStreak).toBeLessThan(0);
        expect(economy.getPersonBalance('e1')).toBe(1000); // employee was paid
    });
});
