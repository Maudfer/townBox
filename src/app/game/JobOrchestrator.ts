// The Job Orchestrator (task 047; docs/tasks/038 §9): the job-context ACTION SOURCE. It is a counterpart to
// Brain in responsibility, never a duplicate in control — it PROPOSES work intents (which continuous work
// action to run, which flavorful discrete work actions happen on duty, when the shift is over); the Brain
// arbitrates and the Action engine executes. Jobs never grow a second state machine.
//
// Realized as a Brain hook (deterministic registration slot in Brain's built-in order), so proposals flow
// through the exact intent pipeline everything else uses. Roster knowledge (who works where) stays where it
// lives today — Workplace/WorkLife — surfaced to the hook through BrainDeps.jobOf; business inventory is the
// Inventory's `ownedBy` view filled by 044's employer-owned consequence outputs.
//
// Determinism: rotation and pool rolls fork the world-seed RNG per (tick, person) with a fixed salt, so the
// orchestrator never perturbs the event/action/brain streams.

import { interleave } from 'game/ActionEngine';
import { ActionIntent, BrainHook, HookContext } from 'game/Brain';

import { SeededRandom, hashStringToSeed } from 'util/random';
import { isOnShiftAtTick } from 'util/shifts';

export const ORCHESTRATOR_SALT = 0x0b;

// On-duty and idle-or-leisure → the continuous work action, chosen by deterministic weighted rotation over
// the job's repertoire (entry chancePerTick doubles as rotation weight; default 1). On-duty and already
// working → propose this tick's discrete work actions (same pooling semantics as action children: per-tick
// chance, maxPerTick slots, cooldowns via the action history, same-tick interleaving). Off-duty and still
// working → request completion by interrupting (the lifecycle fires stopped_working; 048 adds the automated
// fallback rule for people who never get a resolution).
export const jobOrchestratorHook: BrainHook = {
    id: 'jobOrchestrator',
    kind: 'onTick',
    propose({ personId, deps, brain }: HookContext): ActionIntent[] {
        const job = deps.jobOf?.(personId) ?? null;
        if (!job) {
            return [];
        }
        const engine = brain.getActionEngine();
        const onShift = isOnShiftAtTick(job, deps.tick);
        const active = engine.activeInstanceOf(personId);
        const working = active ? engine.getDefinition(active.defId)?.category === 'work' : false;

        if (!onShift) {
            if (working && active) {
                // Shift over: request completion. Interruption is the engine's completion-request primitive;
                // the action's onInterrupt lifecycle fires stopped_working through the normal event pipeline.
                engine.interrupt(active.id, { source: 'brain', causationId: null }, deps, { died: [], born: [], signals: [], committed: [] });
            }
            return [];
        }

        const rng = new SeededRandom(deps.state.worldSeed).fork(deps.tick).fork(hashStringToSeed(personId)).fork(ORCHESTRATOR_SALT);

        if (!working) {
            const pick = rotateContinuous(job.continuousActions, rng);
            if (!pick) {
                return [];
            }
            return [{
                actionId: pick,
                locationOverride: `building:${job.workplaceKey}`,
                sourceHook: 'jobOrchestrator',
                priority: 100,
                necessity: 'required',
                mayInterrupt: true, // obligations displace leisure
                causationId: null,
            }];
        }

        // Already on duty: roll the discrete work pool. Cooldowns key off the person's action history (the
        // same aggregate hasAction reads), occurrences interleave so "Greeted a customer" never runs twice
        // in a row when anything else came up this tick.
        const occurrences: string[] = [];
        for (const spec of job.discreteActions) {
            if (spec.cooldownTicks !== undefined && engine.hasAction(personId, spec.action, deps.tick, { withinTicks: spec.cooldownTicks })) {
                continue;
            }
            const slots = Math.max(1, spec.maxPerTick ?? 1);
            for (let slot = 0; slot < slots; slot++) {
                if (rng.chance(spec.chancePerTick ?? 0)) {
                    occurrences.push(spec.action);
                }
            }
        }
        return interleave(occurrences).map(actionId => ({
            actionId,
            sourceHook: 'jobOrchestrator',
            priority: 50,
            necessity: 'optional',
            mayInterrupt: false,
            causationId: active?.startLogSeq ?? null, // flavor chains to the running work action
        }));
    },
};

// Weighted rotation: a deterministic pick among the job's continuous repertoire, so multi-activity jobs
// (doctor: treating patients / doing rounds) vary across shifts instead of always running entry zero.
function rotateContinuous(entries: { action: string; chancePerTick?: number }[], rng: SeededRandom): string | null {
    if (entries.length === 0) {
        return null;
    }
    const total = entries.reduce((sum, entry) => sum + (entry.chancePerTick ?? 1), 0);
    let roll = rng.next() * total;
    for (const entry of entries) {
        roll -= entry.chancePerTick ?? 1;
        if (roll <= 0) {
            return entry.action;
        }
    }
    return entries[entries.length - 1]!.action;
}
