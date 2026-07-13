// Fire hooks (task 102 / proposal H4, dispatch task 110): the survival-band showcase. When the building
// someone is IN has an open fire, they EVACUATE — a survival intent that interrupts anything (dinner
// included; resumable activities pause through the normal L5 machinery and pick back up after). On-duty
// firefighters are DISPATCHED to the oldest burning building (`responding_to_fire` with a locationOverride
// — the normal commute machinery drives them there, and resolveFires counts who physically made it; the
// generic outside run stays as the no-address fallback texture). People who fail to leave in time risk the
// injury roll when the outcome resolves — the responding crew included.

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
        // Physical presence, not logical place (task 110): objectLocationOf resolves a resident AT HOME to
        // their house's real key, so a fire in your own home puts your own family on the street too. (The
        // plain locationOf reads 'home' there — the pre-070 people-location wart — and 102 silently skipped
        // them.) Off-map the bootstrap key is 'home', which never matches a building fire — mode-safe.
        const here = world.objectLocationOf(personId);
        if (here.kind !== 'building' || !incidents.openFireAt(locationKey(here))) {
            return [];
        }
        const active = ctx.brain.getActionEngine().activeInstanceOf(personId);
        if (active?.defId === 'evacuating' || active?.defId === 'responding_to_fire') {
            // The responding crew is inside on purpose (task 110) — the alarm doesn't chase them back out.
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
        if (active?.defId === 'rushing_to_the_fire' || active?.defId === 'responding_to_fire') {
            return [];
        }
        // DISPATCH (task 110): the crew drives to the oldest burning building (the normal commute
        // machinery) and fights it THERE — resolveFires counts who physically made it. The generic
        // outside run stays as the fallback texture for a fire with no building address.
        const fire = incidents.oldestOpenFire();
        if (fire && fire.locationKey.startsWith('building:')) {
            return [{
                actionId: 'responding_to_fire',
                locationOverride: fire.locationKey,
                sourceHook: 'fireResponse',
                priority: 220, // above the shift and the beat — the alarm bell owns the day
                necessity: 'required',
                band: 'obligation',
                mayInterrupt: true,
                causationId: null,
            }];
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
