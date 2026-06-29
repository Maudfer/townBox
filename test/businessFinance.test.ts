import { computeBusinessPnl, unitMaterialCost, resolveDemand, positionDelta, DemandBusiness } from '../src/util/businessFinance';
import { BusinessBlueprint } from '../src/types/Business';
import { JobPosition, JobRequirements } from '../src/types/Work';

function pos(title: string): JobPosition {
    return { title, salary: 0, requirements: [JobRequirements.RetailSkill], shiftStart: 0, shiftEnd: 0 };
}

describe('unitMaterialCost (task 033)', () => {
    test('sums materialsPerUnit × material prices', () => {
        const blueprint: BusinessBlueprint = {
            friendlyName: 'Shop', category: 'groceries', size: { min: 1, max: 5 }, jobs: {},
            materialsPerUnit: { flour: 2, sugar: 1 },
        };
        expect(unitMaterialCost(blueprint, { flour: 3, sugar: 5 })).toBe(11); // 2×3 + 1×5
    });
});

describe('computeBusinessPnl (task 033)', () => {
    test('pnl = revenue − materials − fixed − payroll', () => {
        expect(computeBusinessPnl(1000, 400, 100, 300).pnl).toBe(200);
        expect(computeBusinessPnl(500, 400, 100, 300).pnl).toBe(-300);
    });
});

describe('resolveDemand (task 033 market)', () => {
    test('a single business sells min(capacity, demand)', () => {
        const units = resolveDemand([{ key: 'a', category: 'groceries', capacity: 100 }], { groceries: 60 });
        expect(units.get('a')).toBe(60); // demand below capacity
        const capped = resolveDemand([{ key: 'a', category: 'groceries', capacity: 100 }], { groceries: 250 });
        expect(capped.get('a')).toBe(100); // capped at capacity
    });

    test('an oversupplied category splits demand by capacity share, all below capacity', () => {
        const businesses: DemandBusiness[] = [
            { key: 'a', category: 'groceries', capacity: 100 },
            { key: 'b', category: 'groceries', capacity: 300 },
        ];
        const units = resolveDemand(businesses, { groceries: 200 }); // total capacity 400 > demand 200
        expect(units.get('a')).toBe(50); // 200 × 100/400
        expect(units.get('b')).toBe(150); // 200 × 300/400
        expect((units.get('a') ?? 0) + (units.get('b') ?? 0)).toBe(200); // all demand served
    });

    test('an undersupplied category runs every business at capacity', () => {
        const businesses: DemandBusiness[] = [
            { key: 'a', category: 'groceries', capacity: 100 },
            { key: 'b', category: 'groceries', capacity: 100 },
        ];
        const units = resolveDemand(businesses, { groceries: 500 }); // demand > total capacity 200
        expect(units.get('a')).toBe(100);
        expect(units.get('b')).toBe(100);
    });

    test('zero capacity sells nothing', () => {
        const units = resolveDemand([{ key: 'a', category: 'groceries', capacity: 0 }], { groceries: 100 });
        expect(units.get('a')).toBe(0);
    });
});

describe('positionDelta (task 020 growth)', () => {
    test('returns the per-title increase from the larger establishment', () => {
        const delta = positionDelta([pos('Clerk'), pos('Clerk')], [pos('Clerk'), pos('Clerk'), pos('Clerk'), pos('Janitor')]);
        expect(delta.map(p => p.title).sort()).toEqual(['Clerk', 'Janitor']);
    });
});
