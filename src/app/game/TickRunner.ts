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
import Brain, { JobFacts } from 'game/Brain';
import Inventory from 'game/Inventory';
import SkillProgression from 'game/SkillProgression';

import { PersonId, PopulationState } from 'types/Genealogy';
import { TickResult } from 'types/LifeEvent';
import { ExecutionContext } from 'types/Execution';
import { SchoolFacts } from 'types/School';
import { JobPosition } from 'types/Work';

export interface TickPlan {
    engine: EventEngine;
    actionEngine?: ActionEngine;
    brain?: Brain;
    inventory?: Inventory | null;
    employerKeyOf?: (personId: PersonId) => string | null;
    jobOf?: (personId: PersonId) => JobFacts | null;
    schoolOf?: (personId: PersonId) => SchoolFacts | null;
    // Completed-day skill progression (tasks 063/065): consumes this tick's commits inside the shared spine,
    // so school/work days convert to proficiency identically in both execution modes.
    skillProgression?: SkillProgression;
    // The person's MUTABLE job assignment (065): work-day counters and promotions land on the serialized
    // object. Live: WorkLife's JobPosition; bootstrap: the logical world when 055 builds it.
    jobAssignmentOf?: (personId: PersonId) => JobPosition | null;
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
    target.committed.push(...source.committed);
}

export async function runTick(plan: TickPlan): Promise<TickResult> {
    const result: TickResult = { died: [], born: [], signals: [], committed: [] };

    // Phases 1–2 (task 043): advance running continuous Actions and resolve due children. Runs inside the
    // market-bound window so action requirements can read market-derived attributes; lifecycle Events fired
    // here (onStart/onComplete/…) land in the same TickResult.
    if (plan.actionEngine) {
        plan.engine.bindMarkets(plan.ctx);
        mergeInto(result, plan.actionEngine.advance({
            state: plan.state,
            tick: plan.tick,
            ticksPerYear: plan.ticksPerYear,
            ticksPerStep: plan.ticksPerStep ?? 1,
            ctx: plan.ctx,
            eventEngine: plan.engine,
            inventory: plan.inventory ?? null,
            ...(plan.employerKeyOf ? { employerKeyOf: plan.employerKeyOf } : {}),
        }));
    }

    // Phases 3–5: automated-trigger drain + probabilistic evaluation + commit (task 042).
    mergeInto(result, plan.engine.simulateTick(plan.state, plan.agentIds, plan.tick, plan.ticksPerYear, plan.ctx, plan.ticksPerStep ?? 1));

    // Phase 5.5 (tasks 063/065): completed-day events convert into skill proficiency and career progression
    // — in the SHARED spine, so both execution modes progress people identically. Runs BEFORE the world
    // reconciliation so promotion commits/signals ride this tick's dispatch (feed, Brain hooks).
    if (plan.skillProgression) {
        mergeInto(result, plan.skillProgression.processCommits(result.committed, plan.state, plan.tick,
            plan.jobAssignmentOf ? { engine: plan.engine, ticksPerYear: plan.ticksPerYear, assignmentOf: plan.jobAssignmentOf } : undefined));
    }

    // Phase 6: dispatch to the committed-notification consumer.
    if (plan.onCommitted) {
        await plan.onCommitted(result);
    }

    // Phases 7–8 (task 046): Brain hooks propose intents (onTick + this tick's committed events), the Brain
    // arbitrates, and winning intents start/interrupt actions through the Action engine. The Job Orchestrator
    // (047) will add its proposals here. Phase 9: persistence rides the save cadence; deferred materialization
    // requests live in the WorldAdapter.
    if (plan.brain && plan.actionEngine) {
        plan.engine.bindMarkets(plan.ctx);
        plan.brain.processTick(plan.agentIds, {
            state: plan.state,
            tick: plan.tick,
            ticksPerYear: plan.ticksPerYear,
            ticksPerStep: plan.ticksPerStep ?? 1,
            ctx: plan.ctx,
            eventEngine: plan.engine,
            inventory: plan.inventory ?? null,
            ...(plan.employerKeyOf ? { employerKeyOf: plan.employerKeyOf } : {}),
            ...(plan.jobOf ? { jobOf: plan.jobOf } : {}),
            ...(plan.schoolOf ? { schoolOf: plan.schoolOf } : {}),
        }, result.committed, result);
        plan.engine.unbindMarkets();
    }
    return result;
}
