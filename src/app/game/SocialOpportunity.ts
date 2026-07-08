// The social-opportunity Brain hook (task 072): the target-binding action source that brings the
// person-targeted repertoire to life — until now nothing ever supplied `params.target`, so the 044/053
// social/lending actions were unreachable dead content. It PROPOSES (Brain arbitrates, the engine executes
// and enforces the interaction contract): for an idle person sharing a building with someone, occasionally
// pick a person-targeted action whose requirements pass and bind a co-located target.
//
// Deterministic: forks the world-seed RNG per (tick, person) with a fixed salt (the orchestrator
// convention), sorts candidates before every draw, and consumes RNG identically in both execution modes.
// Modest by design — social actions season free time (a per-tick chance), they don't dominate it.

import { ActionIntent, BrainHook, HookContext } from 'game/Brain';

import { SeededRandom, hashStringToSeed } from 'util/random';
import { evaluatePredicate } from 'util/predicate';

export const SOCIAL_SALT = 0x50c;
const SOCIAL_CHANCE_PER_TICK = 0.15;

export const socialOpportunityHook: BrainHook = {
    id: 'socialOpportunity',
    kind: 'onTick',
    propose({ personId, deps, brain }: HookContext): ActionIntent[] {
        const status = brain.statusOf(personId).status;
        if (status !== 'idle' && status !== 'performing_action') {
            return []; // never during work/school/sleep/commute; discrete socials season leisure time
        }
        const world = deps.ctx.world;
        if (!world) {
            return [];
        }
        const company = world.peopleAt(world.locationOf(personId)).filter(id => id !== personId);
        if (company.length === 0) {
            return [];
        }
        const rng = new SeededRandom(deps.state.worldSeed).fork(deps.tick).fork(hashStringToSeed(personId)).fork(SOCIAL_SALT);
        if (!rng.chance(SOCIAL_CHANCE_PER_TICK)) {
            return [];
        }

        const engine = brain.getActionEngine();
        const context = engine.contextFor(personId, deps);
        const candidates: { actionId: string; weight: number }[] = [];
        for (const [actionId, def] of Object.entries(engine.getManifest())) {
            if (!def.interaction) {
                continue;
            }
            let weight = def.selection?.weight ?? 1;
            if (weight <= 0) {
                continue;
            }
            if (def.selection?.cooldownTicks !== undefined && engine.hasAction(personId, actionId, deps.tick, { withinTicks: def.selection.cooldownTicks })) {
                continue;
            }
            if (def.requirements && !evaluatePredicate(def.requirements, context)) {
                continue; // e.g. nothing giftable carried → no gift intents
            }
            for (const modifier of def.selection?.modifiers ?? []) {
                if (evaluatePredicate(modifier.when, context)) {
                    weight *= modifier.multiply;
                }
            }
            if (weight > 0) {
                candidates.push({ actionId, weight });
            }
        }
        if (candidates.length === 0) {
            return [];
        }
        candidates.sort((a, b) => a.actionId.localeCompare(b.actionId));
        const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
        let roll = rng.next() * total;
        let picked = candidates[candidates.length - 1]!;
        for (const candidate of candidates) {
            roll -= candidate.weight;
            if (roll <= 0) {
                picked = candidate;
                break;
            }
        }
        const target = company[rng.nextInt(0, company.length - 1)]!;
        const targetParam = engine.getManifest()[picked.actionId]!.interaction!.targetParam;
        return [{
            actionId: picked.actionId,
            params: { [targetParam]: target },
            sourceHook: 'socialOpportunity',
            priority: 20,
            necessity: 'optional',
            mayInterrupt: false,
            causationId: null,
        }];
    },
};
