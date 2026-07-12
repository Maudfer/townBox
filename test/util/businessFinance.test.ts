import { BusinessBlueprint } from 'types/Business';
import { JobPosition } from 'types/Work';
import {
    unitMaterialCost,
    computeBusinessPnl,
    resolveDemand,
    aggregateMaterialDemand,
    positionDelta,
    DemandBusiness,
} from 'util/businessFinance';

// Pure business-finance + demand math (task 033/035/020): unit-tested without a scene per CLAUDE.md's own
// description of this module.

function blueprint(materialsPerUnit?: Record<string, number>): BusinessBlueprint {
    return {
        friendlyName: 'Test Blueprint',
        category: 'groceries',
        size: { min: 1, max: 3 },
        jobs: {},
        materialsPerUnit,
    };
}

describe('unitMaterialCost', () => {
    test('sums amount x price across every declared material', () => {
        const bp = blueprint({ flour: 2, eggs: 3 });
        const prices = { flour: 1.5, eggs: 0.5 };
        expect(unitMaterialCost(bp, prices)).toBeCloseTo(2 * 1.5 + 3 * 0.5);
    });

    test('treats an unpriced material as zero cost', () => {
        const bp = blueprint({ mystery: 4 });
        expect(unitMaterialCost(bp, {})).toBe(0);
    });

    test('a blueprint with no materialsPerUnit costs nothing', () => {
        expect(unitMaterialCost(blueprint(), {})).toBe(0);
    });
});

describe('computeBusinessPnl', () => {
    test('pnl = revenue - materials - fixed - payroll', () => {
        expect(computeBusinessPnl(1000, 200, 100, 300)).toEqual({
            revenue: 1000,
            materialsCost: 200,
            fixedCosts: 100,
            payroll: 300,
            pnl: 400,
        });
    });

    test('can go negative (a loss)', () => {
        expect(computeBusinessPnl(100, 200, 50, 50).pnl).toBe(-200);
    });
});

describe('resolveDemand', () => {
    test('splits demand across a category proportionally to capacity, capped by capacity', () => {
        const businesses: DemandBusiness[] = [
            { key: 'a', category: 'groceries', capacity: 100 },
            { key: 'b', category: 'groceries', capacity: 300 },
        ];
        // Total capacity 400, demand 200: each gets its capacity share of the demand.
        const sold = resolveDemand(businesses, { groceries: 200 });
        expect(sold.get('a')).toBeCloseTo(50); // (200 * 100) / 400
        expect(sold.get('b')).toBeCloseTo(150); // (200 * 300) / 400
    });

    test('caps a business at its own capacity when demand is oversupplied', () => {
        const businesses: DemandBusiness[] = [
            { key: 'a', category: 'groceries', capacity: 10 },
            { key: 'b', category: 'groceries', capacity: 10 },
        ];
        // Demand is huge — each business's share would exceed its capacity, so it's capped.
        const sold = resolveDemand(businesses, { groceries: 1000 });
        expect(sold.get('a')).toBe(10);
        expect(sold.get('b')).toBe(10);
    });

    test('a category with zero total capacity sells nothing (no division by zero)', () => {
        const businesses: DemandBusiness[] = [{ key: 'a', category: 'groceries', capacity: 0 }];
        const sold = resolveDemand(businesses, { groceries: 500 });
        expect(sold.get('a')).toBe(0);
    });

    test('a category with no demand entry sells nothing', () => {
        const businesses: DemandBusiness[] = [{ key: 'a', category: 'dining', capacity: 50 }];
        const sold = resolveDemand(businesses, {});
        expect(sold.get('a')).toBe(0);
    });

    test('different categories do not compete with each other', () => {
        const businesses: DemandBusiness[] = [
            { key: 'a', category: 'groceries', capacity: 100 },
            { key: 'b', category: 'dining', capacity: 100 },
        ];
        const sold = resolveDemand(businesses, { groceries: 50, dining: 20 });
        expect(sold.get('a')).toBe(50);
        expect(sold.get('b')).toBe(20);
    });
});

describe('aggregateMaterialDemand', () => {
    test('sums unitsSold x materialsPerUnit across consumers, per material', () => {
        const consumers: { unitsSold: number; materialsPerUnit?: Record<string, number> }[] = [
            { unitsSold: 10, materialsPerUnit: { flour: 2, eggs: 1 } },
            { unitsSold: 5, materialsPerUnit: { flour: 1 } },
        ];
        expect(aggregateMaterialDemand(consumers)).toEqual({ flour: 25, eggs: 10 });
    });

    test('consumers with no materialsPerUnit contribute nothing', () => {
        expect(aggregateMaterialDemand([{ unitsSold: 100 }])).toEqual({});
    });

    test('an empty consumer list yields no demand', () => {
        expect(aggregateMaterialDemand([])).toEqual({});
    });
});

describe('positionDelta', () => {
    function pos(title: string): JobPosition {
        return { title, salary: 1000, requirements: [], shiftStart: 540, shiftEnd: 1020 };
    }

    test('returns only the newly added slots per title when growing', () => {
        const current = [pos('Clerk'), pos('Clerk')];
        const grown = [pos('Clerk'), pos('Clerk'), pos('Clerk'), pos('Janitor')];
        const added = positionDelta(current, grown);
        expect(added.map(p => p.title)).toEqual(['Clerk', 'Janitor']);
    });

    test('growing from nothing adds every grown position', () => {
        const added = positionDelta([], [pos('Cook'), pos('Cook')]);
        expect(added).toHaveLength(2);
    });

    test('no growth (same roster) adds nothing', () => {
        const current = [pos('Clerk'), pos('Janitor')];
        expect(positionDelta(current, current)).toEqual([]);
    });

    test('a title present in grown but never in current adds all of it', () => {
        const added = positionDelta([pos('Clerk')], [pos('Clerk'), pos('Manager')]);
        expect(added.map(p => p.title)).toEqual(['Manager']);
    });
});
