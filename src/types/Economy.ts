// Economy data model (task 017). Money lives in a single serializable side-structure (keyed by genealogy
// PersonId for people, by workplace anchor key for businesses) so it survives save/load and de/re-
// materialization, mirroring the eventHistory side-table. Income/expense flows (wages, cost of living,
// business P&L) are later tasks (018+); this is the substrate they move money through.

export interface EconomyState {
    personBalances: Record<string, number>;
    businessBalances: Record<string, number>;
}

// Tunable starting balances (src/json/economy.json).
export interface EconomyParams {
    startingPersonFunds: number;
    startingBusinessCapital: number;
}

export type AccountKind = 'person' | 'business';

// An account the ledger can move money to/from.
export interface Account {
    kind: AccountKind;
    id: string;
}
