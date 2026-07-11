import Economy from 'game/economy/Economy';

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
        economy.setLastEconomyMonth(3);

        const restored = new Economy(economy.getState());
        expect(restored.getPersonBalance('p1')).toBe(10);
        expect(restored.getBusinessBalance('w1')).toBe(20);
        expect(restored.getLastEconomyMonth()).toBe(3);

        const loaded = new Economy();
        loaded.loadState(economy.getState());
        expect(loaded.getPersonBalance('p1')).toBe(10);
        expect(loaded.getBusinessBalance('w1')).toBe(20);
    });
});

// Money conservation via the external sector (task 076/H3): every adjust*/transfer keeps the grand total
// (people + businesses + external) constant, so a long run can't silently inflate or deflate.
describe('money conservation (task 076/H3)', () => {
    test('adjust flows are mirrored against external — grand total is invariant', () => {
        const economy = new Economy();
        expect(economy.grandTotal()).toBe(0);

        economy.adjustPerson('p1', 2000);   // starting funds injected from external
        economy.adjustBusiness('w1', 20000); // starting capital
        economy.adjustPerson('p1', -400);    // cost of living leaves the local economy
        economy.adjustBusiness('w1', 1500);  // revenue in
        economy.adjustBusiness('w1', -900);  // materials + fixed costs out

        expect(economy.grandTotal()).toBe(0); // still conserved
        expect(economy.totalMoney()).toBe(2000 + 20000 - 400 + 1500 - 900); // local economy grew from external
        expect(economy.getExternalBalance()).toBe(-economy.totalMoney());
    });

    test('transfer moves money between local accounts without touching external', () => {
        const economy = new Economy();
        economy.adjustBusiness('w1', 5000);
        const externalBefore = economy.getExternalBalance();
        economy.transfer({ kind: 'business', id: 'w1' }, { kind: 'person', id: 'p1' }, 1200); // payroll
        expect(economy.getBusinessBalance('w1')).toBe(3800);
        expect(economy.getPersonBalance('p1')).toBe(1200);
        expect(economy.getExternalBalance()).toBe(externalBefore); // transfer is a pure local move
        expect(economy.grandTotal()).toBe(0);
    });

    test('a pre-H3 save (no external) loads with a conserved grand total', () => {
        const legacy = { personBalances: { p1: 2000 }, businessBalances: { w1: 15000 }, lastEconomyMonth: 3 };
        const economy = new Economy();
        economy.loadState(legacy);
        expect(economy.grandTotal()).toBe(0); // external seeded to -(local total)
        economy.adjustPerson('p1', -500);
        expect(economy.grandTotal()).toBe(0); // stays conserved from there
    });
});
