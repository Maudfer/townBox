// Economy data model (task 017). Money lives in a single serializable side-structure (keyed by genealogy
// PersonId for people, by workplace anchor key for businesses) so it survives save/load and de/re-
// materialization, mirroring the eventHistory side-table. Income/expense flows (wages, cost of living,
// business P&L) are later tasks (018+); this is the substrate they move money through.

export interface EconomyState {
    personBalances: Record<string, number>;
    businessBalances: Record<string, number>;
    // Highest in-game month the monthly economic update (payroll, cost of living, P&L) has applied. -1 means
    // none yet. Persisted so save/load doesn't double-run or skip a month (task 018+).
    lastEconomyMonth: number;
}

// Tunable economy values (src/json/economy.json).
export interface EconomyParams {
    startingPersonFunds: number;
    startingBusinessCapital: number;
    housingCost: number; // monthly housing cost per household
    perCapitaCost: number; // monthly food/upkeep per resident
    growthMonths: number; // consecutive profitable months before a fully-staffed business grows (task 020)
    bankruptcyDebtFloor: number; // a business whose balance stays below this is insolvent (task 021)
    bankruptcyMonths: number; // consecutive insolvent months before a business goes bankrupt and closes (task 021)
    reoccupancyMonths: number; // months a work building stays vacant before it can attract a new business (task 037)
    evictionArrearsMonths: number; // consecutive months of arrears before a household is evicted (task 022)
    recoveryFunds: number; // pooled funds a homeless household needs to occupy a vacant home again (task 022)
}

export type AccountKind = 'person' | 'business';

// An account the ledger can move money to/from.
export interface Account {
    kind: AccountKind;
    id: string;
}
