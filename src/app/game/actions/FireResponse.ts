// Fire hooks (task 102 / proposal H4): the survival-band showcase. When the building someone is IN has an
// open fire, they EVACUATE — a survival intent that interrupts anything (dinner included; resumable
// activities pause through the normal L5 machinery and pick back up after). On-duty firefighters RUSH to
// any open fire — obligation-band ambulatory runs, visibly tearing down the street (the chase tech at
// emergency pace). People who fail to leave in time risk the injury roll when the outcome resolves.

import { ActionIntent, BrainHook, HookContext } from 'game/actions/Brain';
import { locationKey } from 'types/Objects';
import { isOnShiftAtTick } from 'util/shifts';

const FIREFIGHTER_JOB_KEY = 'firefighter';

export const evacuationHook: BrainHook = {
    id: 'evacuation',
    kind: 'onTick',
    propose(ctx: HookContext): ActionIntent[] {
        const { personId, deps } = ctx;
        const incidents = deps.ctx.markets?.incidents;
        const world = deps.ctx.world;
        if (!incidents || !world) {
            return [];
        }
        const here = world.locationOf(personId);
        if (here.kind !== 'building' || !incidents.openFireAt(locationKey(here))) {
            return [];
        }
        const active = ctx.brain.getActionEngine().activeInstanceOf(personId);
        if (active?.defId === 'evacuating') {
            return [];
        }
        return [{
            actionId: 'evacuating',
            sourceHook: 'evacuation',
            priority: 300,
            necessity: 'emergency',
            band: 'survival',
            mayInterrupt: true,
            causationId: null,
        }];
    },
};

export const fireResponseHook: BrainHook = {
    id: 'fireResponse',
    kind: 'onTick',
    propose(ctx: HookContext): ActionIntent[] {
        const { personId, deps } = ctx;
        const incidents = deps.ctx.markets?.incidents;
        if (!incidents || !incidents.anyOpenFire()) {
            return [];
        }
        const job = deps.jobOf?.(personId);
        if (job?.jobKey !== FIREFIGHTER_JOB_KEY || !isOnShiftAtTick(job, deps.tick)) {
            return [];
        }
        const active = ctx.brain.getActionEngine().activeInstanceOf(personId);
        if (active?.defId === 'rushing_to_the_fire') {
            return [];
        }
        return [{
            actionId: 'rushing_to_the_fire',
            sourceHook: 'fireResponse',
            priority: 220, // above the shift and the beat — the alarm bell owns the day
            necessity: 'required',
            band: 'obligation',
            mayInterrupt: true,
            causationId: null,
        }];
    },
};
