import Field from '../src/app/game/Field';
import House from '../src/app/game/House';
import City from '../src/app/game/City';
import Economy from '../src/app/game/Economy';
import GameManager from '../src/app/game/GameManager';

import { PixelPosition, TilePosition } from '../src/types/Position';
import { HouseholdArrangements } from '../src/types/Household';

// Mirrors src/json/economy.json.
const HOUSING = 800;
const PER_CAPITA = 400;

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
        pixelToTilePosition: (pixel: PixelPosition) => (pixel === null ? null : { row: Math.floor(pixel.y / 16), col: Math.floor(pixel.x / 16) }),
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

// A 2-resident household, each resident starting with `each` funds.
function household(field: Field, economy: Economy, each: number): { house: House } {
    const house = field.loadStructure('house', 10, 10, 'h') as House;
    const ids = ['r1', 'r2'];
    ids.forEach((id, index) => {
        const person = field.loadPerson(160 + index * 4, 160);
        person.social.setPersonId(id);
        house.addResident(person);
        economy.setPersonBalance(id, each);
    });
    house.setHousehold({ id: 'hh', houseKey: house.getIdentifier(), headId: 'r1', memberIds: ids, arrangement: HouseholdArrangements.Roommates });
    return { house };
}

const EXPENSE = HOUSING + PER_CAPITA * 2; // 1600 for two residents

describe('City cost of living (task 019)', () => {
    test('charges the monthly expense against pooled household funds when affordable', () => {
        const { city, field, economy } = makeWorld();
        const { house } = household(field, economy, 1000); // funds 2000 >= 1600

        city.processMonthlyEconomy(0);

        const fundsAfter = economy.getPersonBalance('r1') + economy.getPersonBalance('r2');
        expect(fundsAfter).toBe(2000 - EXPENSE);
        expect(house.getHousehold()!.arrears).toBe(0);
    });

    test('an unaffordable household drains to zero, accrues arrears, and is flagged once', () => {
        const { city, field, economy, emitted } = makeWorld();
        const { house } = household(field, economy, 100); // funds 200 < 1600

        city.processMonthlyEconomy(0);
        expect(economy.getPersonBalance('r1')).toBe(0);
        expect(economy.getPersonBalance('r2')).toBe(0);
        expect(house.getHousehold()!.arrears).toBe(1);

        city.processMonthlyEconomy(30); // next month, still broke
        expect(house.getHousehold()!.arrears).toBe(2);

        const stress = emitted.filter(e => e.event === 'cityEvent' && (e.payload as { kind: string }).kind === 'householdStress');
        expect(stress).toHaveLength(1); // flagged only on the first onset, not every month
    });

    test('arrears reset once the household can pay again', () => {
        const { city, field, economy } = makeWorld();
        const { house } = household(field, economy, 100);

        city.processMonthlyEconomy(0);
        expect(house.getHousehold()!.arrears).toBe(1);

        economy.setPersonBalance('r1', 5000); // a windfall (e.g. re-employment)
        city.processMonthlyEconomy(30);
        expect(house.getHousehold()!.arrears).toBe(0);
    });
});
