// The needs ledger (task 084 / proposal A): per-person motivational meters, serialized in the save (v16)
// and consulted by selection (urgency multipliers), the needsHook (critical intents), and — later — mood
// (task 091). Decay is CLOSED-FORM linear from `updatedAtTick` (the K2 stride-tolerance rule): nothing
// mutates per tick; `satisfy` materializes the decayed level before crediting, so live hourly play and the
// generator's day strides agree exactly.
//
// Initialization is LAZY and deterministic: a person's first-ever read seeds every meter from
// (worldSeed, personId, need) in [initMin, initMax] anchored at that tick — no wiring at any spawn path,
// and both execution modes touch a person for the first time at the same point of the shared spine.

import needsConfig from 'json/needs.json';
import { PersonId } from 'types/Genealogy';
import { NEED_IDS, NeedId, NeedsConfig, NeedsReader, NeedsState, PersonNeeds } from 'types/Needs';
import { evaluateCurve } from 'util/curve';
import { SeededRandom, hashStringToSeed } from 'util/random';

export const NEEDS_CONFIG = needsConfig as unknown as NeedsConfig;

const TICKS_PER_DAY = 24;
const NEEDS_SALT = 0x9eed;

export default class Needs implements NeedsReader {
    private state: NeedsState;
    private config: NeedsConfig;

    constructor(config: NeedsConfig = NEEDS_CONFIG) {
        this.state = { people: {} };
        this.config = config;
    }

    // The decayed level of one need. Lazily initializes the person on first touch (see header).
    levelOf(personId: PersonId, need: NeedId, tick: number, worldSeed: number): number {
        const record = this.personNeeds(personId, tick, worldSeed)[need];
        const decay = this.config.needs[need].decayPerDay * Math.max(0, tick - record.updatedAtTick) / TICKS_PER_DAY;
        return Math.max(0, record.level - decay);
    }

    // Credits satisfaction amounts (an action's `satisfies` block), materializing decay first.
    satisfy(personId: PersonId, satisfies: Partial<Record<NeedId, number>>, tick: number, worldSeed: number): void {
        const needs = this.personNeeds(personId, tick, worldSeed);
        for (const [need, amount] of Object.entries(satisfies) as [NeedId, number][]) {
            if (!(need in needs) || amount === 0) {
                continue;
            }
            const decayed = this.levelOf(personId, need, tick, worldSeed);
            needs[need] = { level: Math.min(100, Math.max(0, decayed + amount)), updatedAtTick: tick };
        }
    }

    // The selection-weight multiplier for an action given what it satisfies: the urgency gradient of the
    // MOST urgent need it meaningfully addresses (≥ 5 points). One shared gradient — data's last word stays
    // with authored weights/modifiers, which multiply on top.
    selectionMultiplier(personId: PersonId, satisfies: Partial<Record<NeedId, number>> | undefined, tick: number, worldSeed: number): number {
        if (!satisfies) {
            return 1;
        }
        let best = 1;
        for (const [need, amount] of Object.entries(satisfies) as [NeedId, number][]) {
            if (amount < 5 || !(need in this.config.needs)) {
                continue;
            }
            const urgency = evaluateCurve(this.config.urgencyCurve, this.levelOf(personId, need, tick, worldSeed));
            best = Math.max(best, urgency);
        }
        return best;
    }

    // Needs at/below their authored critical floor, most-starved first (deterministic tie-break by need id).
    criticalNeedsOf(personId: PersonId, tick: number, worldSeed: number): NeedId[] {
        const critical: { need: NeedId; level: number }[] = [];
        for (const need of NEED_IDS) {
            const level = this.levelOf(personId, need, tick, worldSeed);
            if (level <= this.config.needs[need].critical) {
                critical.push({ need, level });
            }
        }
        critical.sort((a, b) => a.level - b.level || a.need.localeCompare(b.need));
        return critical.map(entry => entry.need);
    }

    // Every meter of a person (decayed view) — the inspector's read (task 084 HUD).
    levelsOf(personId: PersonId, tick: number, worldSeed: number): Record<NeedId, number> {
        const levels = {} as Record<NeedId, number>;
        for (const need of NEED_IDS) {
            levels[need] = this.levelOf(personId, need, tick, worldSeed);
        }
        return levels;
    }

    removePerson(personId: PersonId): void {
        delete this.state.people[personId];
    }

    private personNeeds(personId: PersonId, tick: number, worldSeed: number): PersonNeeds {
        let needs = this.state.people[personId];
        if (!needs) {
            const rng = new SeededRandom(worldSeed).fork(NEEDS_SALT).fork(hashStringToSeed(personId));
            needs = {} as PersonNeeds;
            for (const need of NEED_IDS) {
                const level = this.config.initMin + rng.next() * (this.config.initMax - this.config.initMin);
                needs[need] = { level, updatedAtTick: tick };
            }
            this.state.people[personId] = needs;
        }
        return needs;
    }

    serialize(): NeedsState {
        const people: NeedsState['people'] = {};
        for (const [personId, needs] of Object.entries(this.state.people)) {
            people[personId] = Object.fromEntries(Object.entries(needs).map(([need, record]) => [need, { ...record }])) as PersonNeeds;
        }
        return { people };
    }

    loadState(state: NeedsState | undefined): void {
        this.state = { people: {} };
        for (const [personId, needs] of Object.entries(state?.people ?? {})) {
            this.state.people[personId] = Object.fromEntries(Object.entries(needs).map(([need, record]) => [need, { ...record }])) as PersonNeeds;
        }
    }
}
