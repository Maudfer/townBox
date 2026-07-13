// The building-condition ledger (task 102 / proposal H4): per-building 0–100 condition, worn closed-form
// (level − wearPerDay × days since last touch, K2-compliant — reads never mutate) and damaged in steps by
// fires. A building the sweep has never seen reads pristine; the first touch pins its clock. Serialized
// (v16 family), deterministic, RNG-free.

import fireConfig from 'json/fire.json';
import { BuildingConditionsState, FireConfig } from 'types/Fire';

export const FIRE_CONFIG = fireConfig as unknown as FireConfig;

const TICKS_PER_DAY = 24;

export default class BuildingConditions {
    private state: BuildingConditionsState;
    private config: FireConfig;

    constructor(config: FireConfig = FIRE_CONFIG) {
        this.state = { buildings: {} };
        this.config = config;
    }

    // Pin the wear clock on first sight (the ignition sweep touches every standing building).
    ensure(key: string, tick: number): void {
        if (!this.state.buildings[key]) {
            this.state.buildings[key] = { level: 100, sinceTick: tick };
        }
    }

    conditionOf(key: string, tick: number): number {
        const record = this.state.buildings[key];
        if (!record) {
            return 100;
        }
        const worn = record.level - this.config.wearPerDay * Math.max(0, tick - record.sinceTick) / TICKS_PER_DAY;
        return Math.max(this.config.conditionFloor, worn);
    }

    damage(key: string, amount: number, tick: number): void {
        const current = this.conditionOf(key, tick);
        this.state.buildings[key] = { level: Math.max(this.config.conditionFloor, current - amount), sinceTick: tick };
    }

    // A demolished/burned-down lot forgets its record (a rebuilt structure starts fresh).
    remove(key: string): void {
        delete this.state.buildings[key];
    }

    serialize(): BuildingConditionsState {
        return { buildings: Object.fromEntries(Object.entries(this.state.buildings).map(([key, record]) => [key, { ...record }])) };
    }

    loadState(state: BuildingConditionsState | undefined): void {
        this.state = { buildings: {} };
        for (const [key, record] of Object.entries(state?.buildings ?? {})) {
            this.state.buildings[key] = { ...record };
        }
    }
}
