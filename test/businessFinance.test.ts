import { computeBusinessPnl, positionDelta } from '../src/util/businessFinance';
import { BusinessBlueprint } from '../src/types/Business';
import { JobPosition, JobRequirements } from '../src/types/Work';

function pos(title: string): JobPosition {
    return { title, salary: 0, requirements: [JobRequirements.RetailSkill], shiftStart: 0, shiftEnd: 0 };
}

const PRICES = { mat: 10 };

const lossy: BusinessBlueprint = {
    friendlyName: 'Shop',
    size: { min: 1, max: 5 },
    jobs: {},
    materialsPerMonth: { mat: { qty: { mode: 'const', value: 100 } } },
    economics: { priceMarkup: 1.5, fixedCostsPerMonth: { mode: 'const', value: 500 } },
};

const profitable: BusinessBlueprint = {
    friendlyName: 'Shop',
    size: { min: 1, max: 5 },
    jobs: {},
    materialsPerMonth: { mat: { qty: { mode: 'const', value: 100 } } },
    economics: { priceMarkup: 2, fixedCostsPerMonth: { mode: 'const', value: 100 } },
};

describe('computeBusinessPnl (task 020)', () => {
    test('revenue = materials × markup; pnl = revenue − materials − fixed − payroll', () => {
        const finance = computeBusinessPnl(lossy, 1, 2000, PRICES);
        expect(finance.materialsCost).toBe(1000); // 100 × 10
        expect(finance.revenue).toBe(1500); // 1000 × 1.5
        expect(finance.fixedCosts).toBe(500);
        expect(finance.payroll).toBe(2000);
        expect(finance.pnl).toBe(-2000); // 1500 − 1000 − 500 − 2000
    });

    test('a healthy margin with low payroll turns a profit', () => {
        const finance = computeBusinessPnl(profitable, 1, 0, PRICES);
        expect(finance.revenue).toBe(2000); // 1000 × 2
        expect(finance.pnl).toBe(900); // 2000 − 1000 − 100 − 0
        expect(finance.pnl).toBeGreaterThan(0);
    });
});

describe('positionDelta (task 020 growth)', () => {
    test('returns the per-title increase from the larger establishment', () => {
        const current = [pos('Clerk'), pos('Clerk')];
        const grown = [pos('Clerk'), pos('Clerk'), pos('Clerk'), pos('Janitor')];
        const delta = positionDelta(current, grown);
        expect(delta.map(p => p.title).sort()).toEqual(['Clerk', 'Janitor']);
    });

    test('no growth yields no added positions', () => {
        const same = [pos('Clerk')];
        expect(positionDelta(same, same)).toHaveLength(0);
    });
});
