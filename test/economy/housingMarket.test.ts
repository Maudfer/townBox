import GameManager from 'game/GameManager';
import Person from 'game/agents/Person';
import HousingMarket from 'game/economy/HousingMarket';
import Field from 'game/world/Field';
import House from 'game/world/House';
import { Household, HouseholdArrangements } from 'types/Household';
import { PersonId } from 'types/Genealogy';
import { PixelPosition, TilePosition } from 'types/Position';

// HousingMarket (task 024): the move_out event's eligibility adapter. `canMoveOut` gates the per-day roll
// so it only fires when the person can actually leave — a household they don't head, with someone left
// behind, AND a vacant home somewhere in the city to move into. No RNG; pure lookups against Field/House.

function makeField(rows: number, cols: number): Field {
    const game = {
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
        toolbelt: {},
    } as unknown as GameManager;
    const field = new Field(game, rows, cols);
    (game as unknown as { field: Field }).field = field;
    return field;
}

function materialize(field: Field, id: PersonId, home: House): Person {
    const person = field.loadPerson(72, 72);
    person.social.setPersonId(id);
    person.social.setHome(home);
    return person;
}

function household(headId: PersonId, memberIds: PersonId[], houseKey: string): Household {
    return { id: `hh-${houseKey}`, houseKey, headId, memberIds, arrangement: HouseholdArrangements.Nuclear };
}

describe('HousingMarket.canMoveOut', () => {
    test('a non-head member of a multi-resident household can move out when a vacant home exists', () => {
        const field = makeField(40, 40);
        const occupied = field.loadStructure('house', 4, 4, 'h1') as House;
        field.loadStructure('house', 20, 20, 'h2'); // vacant — 0 residents

        const head = materialize(field, 'head1', occupied);
        const child = materialize(field, 'p1', occupied);
        occupied.addResident(head);
        occupied.addResident(child);
        occupied.setHousehold(household('head1', ['head1', 'p1'], '4-4'));

        const market = new HousingMarket(new Map([['head1', head], ['p1', child]]), field);
        expect(market.canMoveOut('p1')).toBe(true);
    });

    test('no vacancy anywhere in the city: nobody can move out even if otherwise eligible', () => {
        const field = makeField(40, 40);
        const occupied = field.loadStructure('house', 4, 4, 'h1') as House;
        // A second house exists but is NOT vacant (has a resident), so there is no vacancy in the city.
        const other = field.loadStructure('house', 20, 20, 'h2') as House;
        const occupant = materialize(field, 'other1', other);
        other.addResident(occupant);

        const head = materialize(field, 'head1', occupied);
        const child = materialize(field, 'p1', occupied);
        occupied.addResident(head);
        occupied.addResident(child);
        occupied.setHousehold(household('head1', ['head1', 'p1'], '4-4'));

        const market = new HousingMarket(new Map([['head1', head], ['p1', child], ['other1', occupant]]), field);
        expect(market.canMoveOut('p1')).toBe(false);
    });

    test('the household head cannot move out (someone must remain to head the household)', () => {
        const field = makeField(40, 40);
        const occupied = field.loadStructure('house', 4, 4, 'h1') as House;
        field.loadStructure('house', 20, 20, 'h2'); // vacant

        const head = materialize(field, 'head1', occupied);
        const child = materialize(field, 'p1', occupied);
        occupied.addResident(head);
        occupied.addResident(child);
        occupied.setHousehold(household('head1', ['head1', 'p1'], '4-4'));

        const market = new HousingMarket(new Map([['head1', head], ['p1', child]]), field);
        expect(market.canMoveOut('head1')).toBe(false);
    });

    test('a lone resident (single-occupant household) cannot move out — nobody would be left behind', () => {
        const field = makeField(40, 40);
        const occupied = field.loadStructure('house', 4, 4, 'h1') as House;
        field.loadStructure('house', 20, 20, 'h2'); // vacant

        // This person is their own household head, and the only resident.
        const solo = materialize(field, 'solo1', occupied);
        occupied.addResident(solo);
        occupied.setHousehold(household('solo1', ['solo1'], '4-4'));

        const market = new HousingMarket(new Map([['solo1', solo]]), field);
        expect(market.canMoveOut('solo1')).toBe(false);
    });

    test('a person with no recorded home cannot move out', () => {
        const field = makeField(40, 40);
        field.loadStructure('house', 20, 20, 'h2'); // vacant, so this isn't why it fails

        const homeless = field.loadPerson(72, 72); // social.getHome() is null — never assigned a house
        homeless.social.setPersonId('p1');

        const market = new HousingMarket(new Map([['p1', homeless]]), field);
        expect(market.canMoveOut('p1')).toBe(false);
    });

    test('an unknown person id cannot move out', () => {
        const field = makeField(40, 40);
        field.loadStructure('house', 20, 20, 'h2'); // vacant

        const market = new HousingMarket(new Map(), field);
        expect(market.canMoveOut('ghost')).toBe(false);
    });

    test('a resident whose house carries no household record cannot move out', () => {
        const field = makeField(40, 40);
        const occupied = field.loadStructure('house', 4, 4, 'h1') as House;
        field.loadStructure('house', 20, 20, 'h2'); // vacant
        // Household never set on this house (setHousehold not called).

        const person = materialize(field, 'p1', occupied);
        occupied.addResident(person);

        const market = new HousingMarket(new Map([['p1', person]]), field);
        expect(market.canMoveOut('p1')).toBe(false);
    });
});
