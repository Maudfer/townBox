// Physical job seeking (LP-13 / proposal simulation-aliveness-2 M3, task 134). Job hunting used to be a
// generic stroll: applications were abstract discretes committed mid-walk, bound to no business, while
// get_job stayed a free-floating probabilistic roll (the audit's 03:00 hires). This hook proposes a LOCATED
// application trip: the unemployed adult walks to the business the JobMarket actually scores for them,
// applies at the door, and the application's onComplete invokes get_job — hired at the counter, during
// business hours, causation-chained. The ambulatory job_hunting stroll stays (asking around at businesses
// with no openings is what seeking looks like); this is the sharp end when a real opening exists.
//
// Off-map: the logical job market doesn't expose bestOpeningKeyFor, so the hook is silent and the
// generator keeps its probabilistic get_job channel unchanged — no regeneration-dynamics shift.

import { ActionIntent, BrainHook, HookContext } from 'game/actions/Brain';
import { hourOfTick } from 'util/time';

export const APPLYING_ACTION = 'applying_at_business';
// One trip per day: the application discrete's own jobApplications recency handles the hire-rate side.
const APPLY_COOLDOWN_TICKS = 24;
const SEEK_START_HOUR = 9;
const SEEK_END_HOUR = 17;

export const jobSeekingHook: BrainHook = {
    id: 'jobSeeking',
    kind: 'onTick',
    propose(ctx: HookContext): ActionIntent[] {
        const { personId, deps } = ctx;
        if (deps.jobOf?.(personId)) {
            return []; // employed — the orchestrator owns their day
        }
        const hour = hourOfTick(deps.tick);
        if (hour < SEEK_START_HOUR || hour >= SEEK_END_HOUR) {
            return [];
        }
        const market = deps.ctx.markets?.jobMarket;
        const targetKey = market?.bestOpeningKeyFor?.(personId);
        if (!targetKey) {
            return []; // no reachable opening (or an abstract market) — the stroll covers the rest
        }
        const engine = ctx.brain.getActionEngine();
        const context = engine.contextFor(personId, deps);
        const age = context.getAttr('age');
        if (typeof age !== 'number' || age < 18) {
            return [];
        }
        if (context.getAttr('retired') === true) {
            return [];
        }
        if (engine.activeInstanceOf(personId)?.defId === APPLYING_ACTION) {
            return [];
        }
        if (engine.hasAction(personId, APPLYING_ACTION, deps.tick, { withinTicks: APPLY_COOLDOWN_TICKS })) {
            return [];
        }
        return [{
            actionId: APPLYING_ACTION,
            params: { employer: targetKey },
            locationOverride: `building:${targetKey}`,
            sourceHook: 'jobSeeking',
            priority: 80, // beats leisure; yields to obligations and critical needs
            necessity: 'required',
            band: 'need',
            mayInterrupt: true,
            causationId: null,
        }];
    },
};
