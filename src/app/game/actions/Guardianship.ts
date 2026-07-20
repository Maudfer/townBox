// Home-alone care (task 126 / guardianship depth): the last available adult at home minds a young dependent
// instead of drifting off to a discretionary activity. The audit found toddlers left home alone while both
// parents commuted — V3's minAge gate stops the child roaming, but nothing kept a parent WITH them. This hook
// anchors `caring_for_children` (location: home) for an adult who is present at home together with a
// co-resident child under the care age and no other available adult around (City.unattendedYoungDependentAtHome).
//
// Deliberately obligation-band but below work: a due WORK shift still pulls the parent out (the sim has no
// daycare model, so a fully-committed household still leaves the toddler during working hours — the residual
// V3 limit), while a DISCRETIONARY departure (leisure, an errand, a stroll) yields to minding the child. The
// resolver is live-only (presence is a map concept), so this is inert in bootstrap and the generator.

import { ActionIntent, BrainHook, HookContext } from 'game/actions/Brain';

// Above free-time/opportunity and the needs band's discretionary picks, below a real work/school obligation
// (job orchestrator ~ shift priority) — so the parent stays home for a young child rather than wandering, but
// the household's breadwinner still goes to work.
const CARE_PRIORITY = 72;

export const guardianshipHook: BrainHook = {
    id: 'guardianship',
    kind: 'onTick',
    propose(ctx: HookContext): ActionIntent[] {
        const { personId, deps } = ctx;
        if (!deps.unattendedDependentAtHome) {
            return []; // off-map / bootstrap: no live presence to read
        }
        const engine = ctx.brain.getActionEngine();
        // Already minding the child — don't churn a fresh start over the running instance.
        if (engine.activeInstanceOf(personId)?.defId === 'caring_for_children') {
            return [];
        }
        if (!deps.unattendedDependentAtHome(personId)) {
            return [];
        }
        return [{
            actionId: 'caring_for_children',
            sourceHook: 'guardianship',
            priority: CARE_PRIORITY,
            necessity: 'required',
            band: 'obligation',
            mayInterrupt: true,
            causationId: null,
        }];
    },
};
