import Field from '../src/app/game/Field';
import House from '../src/app/game/House';
import Workplace from '../src/app/game/Workplace';
import Person from '../src/app/game/Person';
import JobMarket from '../src/app/game/JobMarket';
import GameManager from '../src/app/game/GameManager';

import { PixelPosition, TilePosition } from '../src/types/Position';
import { JobRequirements, JobPosition } from '../src/types/Work';
import { PersonId } from '../src/types/Genealogy';

function makeField(rows: number, cols: number): Field {
    const game = {
        field: null,
        gridParams: { rows, cols, cells: { width: 16, height: 16 }, footprint: { tiles: 3, width: 48, height: 48 } },
        tileToPixelPosition: (position: TilePosition) => (position === null ? null : { x: position.col * 16 + 8, y: position.row * 16 + 8 }),
        pixelToTilePosition: (pixel: PixelPosition) => {
            if (pixel === null) {
                return null;
            }
            const row = Math.floor(pixel.y / 16);
            const col = Math.floor(pixel.x / 16);
            return row < 0 || row >= rows || col < 0 || col >= cols ? null : { row, col };
        },
        emit: () => {},
        on: () => {},
        setGameManager: () => {},
        toolbelt: {},
    } as unknown as GameManager;

    const field = new Field(game, rows, cols);
    (game as unknown as { field: Field }).field = field;
    return field;
}

function position(title: string, skill: JobRequirements): JobPosition {
    return { title, salary: 1000, requirements: [skill], shiftStart: 540, shiftEnd: 1020 };
}

function setBusiness(workplace: Workplace, name: string, positions: JobPosition[]): void {
    workplace.setBusiness({ blueprintKey: 'test', name, lineOfWork: 'Test', size: 1, positions });
}

function materialize(field: Field, id: PersonId, home: House, skills: JobRequirements[]): Person {
    const person = field.loadPerson(72, 72);
    person.social.setPersonId(id);
    person.social.setHome(home);
    person.work.setSkills(skills);
    return person;
}

describe('JobMarket', () => {
    test('hires a skill-matching candidate, fills the slot, and reflects employment', () => {
        const field = makeField(40, 40);
        const home = field.loadStructure('house', 4, 4, 'h') as House;
        const shop = field.loadStructure('work', 7, 7, 'w') as Workplace;
        setBusiness(shop, 'Shop', [position('Clerk', JobRequirements.RetailSkill)]);

        const person = materialize(field, 'p1', home, [JobRequirements.RetailSkill]);
        const market = new JobMarket(new Map([['p1', person]]), field);

        expect(market.isEmployed('p1')).toBe(false);
        expect(market.canHire('p1')).toBe(true);
        expect(market.hire('p1')).toBe(true);

        expect(market.isEmployed('p1')).toBe(true);
        expect(person.work.getJob()?.title).toBe('Clerk');
        expect(shop.getOpenPositions()).toHaveLength(0); // slot consumed
        expect(shop.getEmployees()).toContain(person);
    });

    test('cannot hire without a matching skill (or with no skills)', () => {
        const field = makeField(40, 40);
        const home = field.loadStructure('house', 4, 4, 'h') as House;
        const shop = field.loadStructure('work', 7, 7, 'w') as Workplace;
        setBusiness(shop, 'Shop', [position('Clerk', JobRequirements.RetailSkill)]);

        const mismatched = materialize(field, 'p1', home, [JobRequirements.MedicalSkill]);
        const unskilled = materialize(field, 'p2', home, []);
        const market = new JobMarket(new Map([['p1', mismatched], ['p2', unskilled]]), field);

        expect(market.canHire('p1')).toBe(false);
        expect(market.hire('p1')).toBe(false);
        expect(market.canHire('p2')).toBe(false);
    });

    test('prefers the nearer workplace when both have a matching opening', () => {
        const field = makeField(60, 60);
        const home = field.loadStructure('house', 4, 4, 'h') as House;
        const near = field.loadStructure('work', 7, 7, 'w') as Workplace; // distance 6
        const far = field.loadStructure('work', 40, 40, 'w') as Workplace; // distance 72
        setBusiness(near, 'Near Co', [position('Clerk', JobRequirements.RetailSkill)]);
        setBusiness(far, 'Far Co', [position('Clerk', JobRequirements.RetailSkill)]);

        const person = materialize(field, 'p1', home, [JobRequirements.RetailSkill]);
        const market = new JobMarket(new Map([['p1', person]]), field);

        expect(market.hire('p1')).toBe(true);
        expect(near.getEmployees()).toContain(person);
        expect(far.getEmployees()).not.toContain(person);
    });

    test('firing clears the job and returns the slot to the open pool', () => {
        const field = makeField(40, 40);
        const home = field.loadStructure('house', 4, 4, 'h') as House;
        const shop = field.loadStructure('work', 7, 7, 'w') as Workplace;
        setBusiness(shop, 'Shop', [position('Clerk', JobRequirements.RetailSkill)]);

        const person = materialize(field, 'p1', home, [JobRequirements.RetailSkill]);
        const market = new JobMarket(new Map([['p1', person]]), field);
        market.hire('p1');

        market.fire('p1');
        expect(market.isEmployed('p1')).toBe(false);
        expect(person.work.getJob()).toBeNull();
        expect(shop.getOpenPositions()).toHaveLength(1); // slot returned
        expect(shop.getEmployees()).not.toContain(person);
    });
});
