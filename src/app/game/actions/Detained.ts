// The detained hook (task 100 / proposal G5): detention as a LIVED state. While the registry holds a
// person, this hook (registered before the job orchestrator) proposes the constrained `serving_time`
// obligation at the facility — it outranks the shift and school through normal arbitration, so jobs and
// classes are simply missed (the honest absence consequences ride the systems that already exist). The
// person stays materialized, visible, and inspectable; their household membership is untouched, so release
// walks them straight back into their old life — unless it moved on without them.

import { ActionIntent, BrainHook, HookContext } from 'game/actions/Brain';

export const detainedHook: BrainHook = {
    id: 'detained',
    kind: 'onTick',
    propose(ctx: HookContext): ActionIntent[] {
        const { personId, deps } = ctx;
        const record = deps.detentionOf?.(personId);
        if (!record) {
            return [];
        }
        const active = ctx.brain.getActionEngine().activeInstanceOf(personId);
        if (active?.defId === 'serving_time') {
            return [];
        }
        return [{
            actionId: 'serving_time',
            locationOverride: `building:${record.locationKey}`,
            sourceHook: 'detained',
            priority: 250, // above the shift (100) and the chase (150) — the cell door is not negotiable
            necessity: 'required',
            band: 'obligation',
            mayInterrupt: true,
            causationId: null,
        }];
    },
};
