import Economy from '../src/app/game/Economy';

describe('Economy (ledger, task 017)', () => {
    test('person balances: get / set / adjust, with debt allowed', () => {
        const economy = new Economy();
        expect(economy.getPersonBalance('p1')).toBe(0);
        economy.setPersonBalance('p1', 100);
        economy.adjustPerson('p1', 50);
        expect(economy.getPersonBalance('p1')).toBe(150);
        economy.adjustPerson('p1', -200);
        expect(economy.getPersonBalance('p1')).toBe(-50); // negative = debt
    });

    test('business balances: get / set / adjust', () => {
        const economy = new Economy();
        economy.setBusinessBalance('4-4', 1000);
        economy.adjustBusiness('4-4', -250);
        expect(economy.getBusinessBalance('4-4')).toBe(750);
    });

    test('transfer moves money between accounts and conserves the total', () => {
        const economy = new Economy();
        economy.setBusinessBalance('w1', 5000);
        economy.setPersonBalance('p1', 1000);
        const before = economy.totalMoney();

        economy.transfer({ kind: 'business', id: 'w1' }, { kind: 'person', id: 'p1' }, 300);

        expect(economy.getBusinessBalance('w1')).toBe(4700);
        expect(economy.getPersonBalance('p1')).toBe(1300);
        expect(economy.totalMoney()).toBe(before);
    });

    test('state round-trips through the constructor and loadState', () => {
        const economy = new Economy();
        economy.setPersonBalance('p1', 10);
        economy.setBusinessBalance('w1', 20);

        const restored = new Economy(economy.getState());
        expect(restored.getPersonBalance('p1')).toBe(10);
        expect(restored.getBusinessBalance('w1')).toBe(20);

        const loaded = new Economy();
        loaded.loadState(economy.getState());
        expect(loaded.getPersonBalance('p1')).toBe(10);
        expect(loaded.getBusinessBalance('w1')).toBe(20);
    });
});
