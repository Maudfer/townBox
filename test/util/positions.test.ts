import { summarizePositions } from 'util/positions';
import {JobPosition} from 'types/Work';

function position(title: string, skill: string): JobPosition {
    return { title, salary: 1000, requirements: [skill], shiftStart: 540, shiftEnd: 1020 };
}

describe('summarizePositions (workplace staffing, task 028)', () => {
    test('reports filled/open per job title', () => {
        const all = [
            position('Clerk', 'assist_customers'),
            position('Clerk', 'assist_customers'),
            position('Clerk', 'assist_customers'),
            position('Janitor', 'sanitize_surfaces'),
        ];
        // One clerk slot still open; the janitor slot is open too.
        const open = [
            position('Clerk', 'assist_customers'),
            position('Janitor', 'sanitize_surfaces'),
        ];

        const summary = summarizePositions(all, open);
        const clerk = summary.find(s => s.title === 'Clerk')!;
        const janitor = summary.find(s => s.title === 'Janitor')!;

        expect(clerk).toEqual({ title: 'Clerk', total: 3, open: 1, filled: 2 });
        expect(janitor).toEqual({ title: 'Janitor', total: 1, open: 1, filled: 0 });
    });

    test('a fully staffed business reports zero open', () => {
        const all = [position('Cook', 'chop_and_prep_ingredients')];
        const summary = summarizePositions(all, []);
        expect(summary).toEqual([{ title: 'Cook', total: 1, open: 0, filled: 1 }]);
    });

    test('sorts titles alphabetically and dedupes', () => {
        const all = [position('Zebra', 'assist_customers'), position('Alpha', 'assist_customers')];
        const summary = summarizePositions(all, all);
        expect(summary.map(s => s.title)).toEqual(['Alpha', 'Zebra']);
    });
});
