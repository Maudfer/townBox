import { generateBusiness } from '../src/app/game/BusinessGen';
import { BusinessBlueprint, BusinessBlueprintTable, JobTable } from '../src/types/Business';

import businessesConfig from '../src/json/businesses.json';
import jobsConfig from '../src/json/jobs.json';

const REAL_BLUEPRINTS = businessesConfig as unknown as BusinessBlueprintTable;
const REAL_JOBS = jobsConfig as unknown as JobTable;

const jobs: JobTable = {
    clerk: { title: 'Clerk', salary: 1300, requiredSkills: ['RetailSkill'] },
    janitor: { title: 'Janitor', salary: 1100, requiredSkills: ['CleaningSkill'] },
};

const blueprint: BusinessBlueprint = {
    friendlyName: 'Shop',
    category: 'groceries',
    size: { min: 1, max: 10 },
    jobs: {
        clerk: { count: { mode: 'linear', base: 1, perUnit: 2 } }, // 1 + 2*size
        janitor: { count: { mode: 'sqrt', base: 1, coeff: 1, max: 3 } }, // 1 + sqrt(size), capped at 3
    },
};

function countOf(positions: { title: string }[], title: string): number {
    return positions.filter(position => position.title === title).length;
}

describe('generateBusiness', () => {
    test('expands position counts by each job curve at the given size', () => {
        const small = generateBusiness('shop', blueprint, jobs, 'Tiny Shop', 1);
        expect(countOf(small.positions, 'Clerk')).toBe(3); // 1 + 2*1
        expect(countOf(small.positions, 'Janitor')).toBe(2); // 1 + sqrt(1)

        const big = generateBusiness('shop', blueprint, jobs, 'Big Shop', 5);
        expect(countOf(big.positions, 'Clerk')).toBe(11); // 1 + 2*5
        expect(countOf(big.positions, 'Janitor')).toBe(3); // 1 + sqrt(5) -> 3.24 -> capped at 3
    });

    test('carries the business identity', () => {
        const business = generateBusiness('shop', blueprint, jobs, 'My Shop', 4);
        expect(business.blueprintKey).toBe('shop');
        expect(business.name).toBe('My Shop');
        expect(business.lineOfWork).toBe('Shop');
        expect(business.size).toBe(4);
    });

    test('is deterministic for identical inputs', () => {
        const a = generateBusiness('shop', blueprint, jobs, 'Shop', 7);
        const b = generateBusiness('shop', blueprint, jobs, 'Shop', 7);
        expect(a.positions).toEqual(b.positions);
    });

    test('skips blueprint jobs that have no definition', () => {
        const withGhost: BusinessBlueprint = {
            friendlyName: 'Ghost Shop',
            category: 'groceries',
            size: { min: 1, max: 1 },
            jobs: { ghost: { count: { mode: 'const', value: 5 } } },
        };
        const business = generateBusiness('ghost', withGhost, jobs, 'Ghosts', 1);
        expect(business.positions).toHaveLength(0);
    });

    test('resolves job requirements/salary/shifts from the job table', () => {
        const business = generateBusiness('shop', blueprint, jobs, 'Shop', 1);
        const clerk = business.positions.find(position => position.title === 'Clerk');
        expect(clerk).toBeDefined();
        expect(clerk!.salary).toBe(1300);
        expect(clerk!.requirements).toEqual(['RetailSkill']);
        expect(clerk!.shiftStart).toBeLessThan(clerk!.shiftEnd);
    });

    test('the seeded supermarket scales clerks faster and higher than janitors (acceptance example)', () => {
        const supermarket = REAL_BLUEPRINTS['supermarket']!;
        const big = generateBusiness('supermarket', supermarket, REAL_JOBS, 'MegaMart', 10);
        const small = generateBusiness('supermarket', supermarket, REAL_JOBS, 'MiniMart', 1);

        expect(countOf(big.positions, 'Checkout Clerk')).toBeGreaterThan(countOf(big.positions, 'Janitor'));
        expect(countOf(big.positions, 'Checkout Clerk')).toBeGreaterThan(countOf(small.positions, 'Checkout Clerk'));
    });
});
