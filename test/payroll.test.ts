import Field from '../src/app/game/Field';
import Workplace from '../src/app/game/Workplace';
import City from '../src/app/game/City';
import Economy from '../src/app/game/Economy';
import GameManager from '../src/app/game/GameManager';

import { PixelPosition, TilePosition } from '../src/types/Position';
import { JobPosition, JobRequirements } from '../src/types/Work';

function makeWorld(): { city: City; field: Field; economy: Economy; emitted: { event: string; payload: unknown }[] } {
    const rows = 30;
    const cols = 30;
    const economy = new Economy();
    const emitted: { event: string; payload: unknown }[] = [];
    const game = {
        field: null,
        economy,
        gridParams: { rows, cols, cells: { width: 16, height: 16 }, footprint: { tiles: 3, width: 48, height: 48 } },
        tileToPixelPosition: (position: TilePosition) => (position === null ? null : { x: position.col * 16 + 8, y: position.row * 16 + 8 }),
        pixelToTilePosition: (pixel: PixelPosition) => {
            if (pixel === null) {
                return null;
            }
            return { row: Math.floor(pixel.y / 16), col: Math.floor(pixel.x / 16) };
        },
        emit: (event: string, payload: unknown) => { emitted.push({ event, payload }); return Promise.resolve([]); },
        emitSingle: () => {},
        on: () => {},
        toolbelt: {},
    } as unknown as GameManager;

    const field = new Field(game, rows, cols);
    (game as unknown as { field: Field }).field = field;
    const city = new City(game);
    return { city, field, economy, emitted };
}

function job(salary: number): JobPosition {
    return { title: 'Clerk', salary, requirements: [JobRequirements.RetailSkill], shiftStart: 540, shiftEnd: 1020 };
}

function staffedWorkplace(field: Field, economy: Economy, capital: number, salary: number): { key: string; personId: string } {
    const workplace = field.loadStructure('work', 10, 10, 'w') as Workplace;
    workplace.setBusiness({ blueprintKey: 'x', name: 'Acme', lineOfWork: 'Test', size: 1, positions: [job(salary)] });
    const employee = field.loadPerson(160, 160);
    employee.social.setPersonId('e1');
    employee.work.setJob(job(salary));
    workplace.addEmployee(employee);

    const key = workplace.getIdentifier();
    economy.setBusinessBalance(key, capital);
    economy.setPersonBalance('e1', 0);
    return { key, personId: 'e1' };
}

describe('City payroll (task 018)', () => {
    test('pays salaries monthly, once per month, from the employer to the employee', () => {
        const { city, field, economy } = makeWorld();
        const { key, personId } = staffedWorkplace(field, economy, 5000, 1000);

        city.processMonthlyEconomy(0); // month 0 (first run)
        expect(economy.getPersonBalance(personId)).toBe(1000);
        expect(economy.getBusinessBalance(key)).toBe(4000);

        city.processMonthlyEconomy(5); // same month — no double pay
        expect(economy.getPersonBalance(personId)).toBe(1000);

        city.processMonthlyEconomy(30); // month 1 — pays again
        expect(economy.getPersonBalance(personId)).toBe(2000);
        expect(economy.getBusinessBalance(key)).toBe(3000);
    });

    test('a business that cannot cover payroll goes into debt and surfaces a stress event', () => {
        const { city, field, economy, emitted } = makeWorld();
        const { key } = staffedWorkplace(field, economy, 500, 1000); // capital < payroll

        city.processMonthlyEconomy(0);

        expect(economy.getBusinessBalance(key)).toBe(-500); // debt allowed
        const stress = emitted.filter(e => e.event === 'cityEvent' && (e.payload as { kind: string }).kind === 'businessStress');
        expect(stress).toHaveLength(1);
    });
});
