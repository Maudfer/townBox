// The shared per-tick lifecycle (task 040; docs/tasks/038 §3.1). Live play (City.handleTick) and the history
// bootstrap (HistoryBootstrap) both advance the simulation through THIS function, so the phase order is one
// piece of code, not a convention. Phases whose systems don't exist yet are named no-ops that later tasks
// fill in — the point today is that both execution modes already share the same spine.
//
//  1. Advance running continuous Actions            — Action engine, task 043
//  2. Resolve due sequence steps / pool children    — Action engine, task 043
//  3. Resolve due scheduled/automated Event triggers ┐
//  4. Evaluate probabilistic Event eligibility        │ Engine B (simulateTick runs 3–5: the schedule
//  5. Commit occurred Events + append to logs         ┘ drain + atHour sweep, then the probabilistic pass)
//  6. Dispatch committed-Event notifications        — world reconciliation now; Brain hooks in task 046
//  7. Resolve Brain / job-orchestrator intents      — tasks 046/047
//  8. Start/interrupt/complete/wait Actions         — task 043
//  9. Persist logs & deferred materialization       — logs persist via the save cadence; pending transitions
//                                                     live in the WorldAdapter

import EventEngine from 'game/EventEngine';
import ActionEngine from 'game/ActionEngine';
import Inventory from 'game/Inventory';

import { PersonId, PopulationState } from 'types/Genealogy';
import { TickResult } from 'types/LifeEvent';
import { ExecutionContext } from 'types/Execution';

export interface TickPlan {
    engine: EventEngine;
    actionEngine?: ActionEngine;
    inventory?: Inventory | null;
    state: PopulationState;
    agentIds: PersonId[];
    tick: number;
    ticksPerYear: number;
    ctx: Partial<ExecutionContext>;
    ticksPerStep?: number;
    // Phase 6 consumer: the caller's reconciliation of the committed results (despawn the dead, materialize
    // newborns, cohabitation/move-out signals, feed entries). Optional — the bootstrap has no world to patch.
    onCommitted?: (result: TickResult) => void | Promise<void>;
}

function mergeInto(target: TickResult, source: TickResult): void {
    target.died.push(...source.died);
    target.born.push(...source.born);
    target.signals.push(...source.signals);
}

export async function runTick(plan: TickPlan): Promise<TickResult> {
    const result: TickResult = { died: [], born: [], signals: [] };

    // Phases 1–2 (task 043): advance running continuous Actions and resolve due children. Runs inside the
    // market-bound window so action requirements can read market-derived attributes; lifecycle Events fired
    // here (onStart/onComplete/…) land in the same TickResult.
    if (plan.actionEngine) {
        plan.engine.bindMarkets(plan.ctx);
        mergeInto(result, plan.actionEngine.advance({
            state: plan.state,
            tick: plan.tick,
            ticksPerYear: plan.ticksPerYear,
            ctx: plan.ctx,
            eventEngine: plan.engine,
            inventory: plan.inventory ?? null,
        }));
    }

    // Phases 3–5: automated-trigger drain + probabilistic evaluation + commit (task 042).
    mergeInto(result, plan.engine.simulateTick(plan.state, plan.agentIds, plan.tick, plan.ticksPerYear, plan.ctx, plan.ticksPerStep ?? 1));

    // Phase 6: dispatch to the committed-notification consumer.
    if (plan.onCommitted) {
        await plan.onCommitted(result);
    }

    // Phases 7–8: Brain / Job-Orchestrator intents and new action starts land with tasks 046/047 (today,
    // actions start via direct ActionEngine.startAction calls). Phase 9: persistence rides the save cadence;
    // deferred materialization requests live in the WorldAdapter.
    return result;
}
