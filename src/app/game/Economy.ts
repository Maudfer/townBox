import { EconomyState, EconomyParams, Account } from 'types/Economy';
import { MoneyLedger } from 'types/LifeEvent';

import economyConfig from 'json/economy.json';

export const DEFAULT_ECONOMY_PARAMS: EconomyParams = economyConfig as EconomyParams;

// The single source of truth for money (task 017): per-person and per-business balances, plus one ledger
// primitive (transfer) every money flow goes through, so totals are always conserved. Negative balances are
// allowed (debt) — solvency decisions belong to later tasks (021 bankruptcy, 022 eviction). Owned by
// GameManager (game.economy), serialized into the save. Implements MoneyLedger so the event engine can read
// the `money` attribute and apply `adjustMoney` through the same accounts.
export default class Economy implements MoneyLedger {
    private personBalances: Record<string, number>;
    private businessBalances: Record<string, number>;

    constructor(state?: EconomyState) {
        this.personBalances = state?.personBalances ?? {};
        this.businessBalances = state?.businessBalances ?? {};
    }

    getState(): EconomyState {
        return { personBalances: this.personBalances, businessBalances: this.businessBalances };
    }

    loadState(state: EconomyState): void {
        this.personBalances = state.personBalances ?? {};
        this.businessBalances = state.businessBalances ?? {};
    }

    // --- People ------------------------------------------------------------
    getPersonBalance(personId: string): number {
        return this.personBalances[personId] ?? 0;
    }

    setPersonBalance(personId: string, amount: number): void {
        this.personBalances[personId] = amount;
    }

    adjustPerson(personId: string, delta: number): void {
        this.personBalances[personId] = this.getPersonBalance(personId) + delta;
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
    }

    // --- Ledger primitive --------------------------------------------------
    // Moves `amount` from one account to another. Conserves the total money in the economy.
    transfer(from: Account, to: Account, amount: number): void {
        this.adjustAccount(from, -amount);
        this.adjustAccount(to, amount);
    }

    private adjustAccount(account: Account, delta: number): void {
        if (account.kind === 'person') {
            this.adjustPerson(account.id, delta);
        } else {
            this.adjustBusiness(account.id, delta);
        }
    }

    // Sum of all balances — for the city overview / debugging.
    totalMoney(): number {
        const sum = (record: Record<string, number>): number => Object.values(record).reduce((total, value) => total + value, 0);
        return sum(this.personBalances) + sum(this.businessBalances);
    }
}
