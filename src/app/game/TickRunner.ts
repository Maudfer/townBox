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

import { PersonId, PopulationState } from 'types/Genealogy';
import { TickResult } from 'types/LifeEvent';
import { ExecutionContext } from 'types/Execution';

export interface TickPlan {
    engine: EventEngine;
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

export async function runTick(plan: TickPlan): Promise<TickResult> {
    // Phases 1–2: no-ops until the Action engine (043) lands.

    // Phases 3–5: automated-trigger drain + probabilistic evaluation + commit (task 042).
    const result = plan.engine.simulateTick(plan.state, plan.agentIds, plan.tick, plan.ticksPerYear, plan.ctx, plan.ticksPerStep ?? 1);

    // Phase 6: dispatch to the committed-notification consumer.
    if (plan.onCommitted) {
        await plan.onCommitted(result);
    }

    // Phases 7–9: no-ops until Brain (046), the Job Orchestrator (047), and the Action engine (043) land.
    return result;
}
