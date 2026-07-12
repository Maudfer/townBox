import economyConfig from 'json/economy.json';
import { EconomyState, EconomyParams, Account } from 'types/Economy';
import { MoneyLedger } from 'types/LifeEvent';


export const DEFAULT_ECONOMY_PARAMS: EconomyParams = economyConfig as EconomyParams;

// The single source of truth for money (task 017): per-person and per-business balances, plus one ledger
// primitive (transfer) every money flow goes through, so totals are always conserved. Negative balances are
// allowed (debt) — solvency decisions belong to later tasks (021 bankruptcy, 022 eviction). Owned by
// GameManager (game.economy), serialized into the save. Implements MoneyLedger so the event engine can read
// the `money` attribute and apply `adjustMoney` through the same accounts.
export default class Economy implements MoneyLedger {
    private personBalances: Record<string, number>;
    private businessBalances: Record<string, number>;
    private lastEconomyMonth: number;
    // The rest-of-the-world counterparty (task 076/H3). Every adjust* (a one-sided flow into/out of the local
    // economy) is mirrored here so people + businesses + external is conserved; transfer() moves money between
    // two local accounts and leaves external untouched.
    private externalBalance: number;

    constructor(state?: EconomyState) {
        this.personBalances = state?.personBalances ?? {};
        this.businessBalances = state?.businessBalances ?? {};
        this.lastEconomyMonth = state?.lastEconomyMonth ?? -1;
        this.externalBalance = state?.externalBalance ?? -this.localTotal();
    }

    getState(): EconomyState {
        return { personBalances: this.personBalances, businessBalances: this.businessBalances, lastEconomyMonth: this.lastEconomyMonth, externalBalance: this.externalBalance };
    }

    loadState(state: EconomyState): void {
        this.personBalances = state.personBalances ?? {};
        this.businessBalances = state.businessBalances ?? {};
        this.lastEconomyMonth = state.lastEconomyMonth ?? -1;
        // Pre-H3 saves carry no external balance: seed it so the grand total starts conserved (external =
        // -(local total)), then every subsequent flow keeps it conserved.
        this.externalBalance = state.externalBalance ?? -this.localTotal();
    }

    getLastEconomyMonth(): number {
        return this.lastEconomyMonth;
    }

    setLastEconomyMonth(month: number): void {
        this.lastEconomyMonth = month;
    }

    // --- People ------------------------------------------------------------
    getPersonBalance(personId: string): number {
        return this.personBalances[personId] ?? 0;
    }

    // A raw balance set (load/restore and test setup). Does NOT balance against the external sector — money
    // flows that must conserve should use adjustPerson/adjustBusiness/transfer, not this.
    setPersonBalance(personId: string, amount: number): void {
        this.personBalances[personId] = amount;
    }

    // A one-sided flow into (delta > 0) or out of (delta < 0) the local economy — mirrored against the external
    // sector so the grand total stays conserved (task 076/H3). Balance behavior is unchanged from before.
    adjustPerson(personId: string, delta: number): void {
        this.personBalances[personId] = this.getPersonBalance(personId) + delta;
        this.externalBalance -= delta;
    }

    // --- Businesses --------------------------------------------------------
    getBusinessBalance(key: string): number {
        return this.businessBalances[key] ?? 0;
    }

    setBusinessBalance(key: string, amount: number): void {
        this.businessBalances[key] = amount;
    }

    adjustBusiness(key: string, delta: number): void {
        this.businessBalances[key] = this.getBusinessBalance(key) + delta;
        this.externalBalance -= delta;
    }

    // --- Ledger primitive --------------------------------------------------
    // Moves `amount` between two LOCAL accounts. Conserves the local total (external untouched).
    transfer(from: Account, to: Account, amount: number): void {
        this.creditAccount(from, -amount);
        this.creditAccount(to, amount);
    }

    // Raw local credit (no external mirroring) — the two legs of a transfer already balance each other.
    private creditAccount(account: Account, delta: number): void {
        if (account.kind === 'person') {
            this.personBalances[account.id] = this.getPersonBalance(account.id) + delta;
        } else {
            this.businessBalances[account.id] = this.getBusinessBalance(account.id) + delta;
        }
    }

    private localTotal(): number {
        const sum = (record: Record<string, number>): number => Object.values(record).reduce((total, value) => total + value, 0);
        return sum(this.personBalances) + sum(this.businessBalances);
    }

    // Sum of all local balances — for the city overview / debugging.
    totalMoney(): number {
        return this.localTotal();
    }

    // The external-sector balance (task 076/H3).
    getExternalBalance(): number {
        return this.externalBalance;
    }

    // The conserved grand total: local economy + external sector. Constant across all adjust*/transfer flows
    // (a stable invariant a long offline run can be checked against for drift).
    grandTotal(): number {
        return this.localTotal() + this.externalBalance;
    }
}
