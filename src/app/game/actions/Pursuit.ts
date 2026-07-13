// The pursuit hook (task 099 / proposal G4): the street chase. When an on-duty police officer and a WANTED
// suspect (named on an open, witnessed incident — markets.incidents) share a location, both sides get
// intents: the suspect FLEES (survival band — nothing outranks it, leisure and dinner alike get dropped or
// paused) and the officer GIVES CHASE (obligation band — it displaces the beat walk through the normal
// matrix). Both actions are ambulatory runs located OUTSIDE, so the chase is two sprites genuinely running
// down the street. The fleeing action's completion fires `chase_concluded`, whose signal City resolves into
// got_caught (fine, record) or evaded_the_police — a deterministic roll weighted by the suspect's age and
// health. Proposes nothing without an incidents market (pure tests, pre-099 saves) — no crime, no chase.

import { ActionIntent, BrainHook, HookContext } from 'game/actions/Brain';
import { isOnShiftAtTick } from 'util/shifts';

const POLICE_JOB_KEY = 'police_officer';

export const pursuitHook: BrainHook = {
    id: 'pursuit',
    kind: 'onTick',
    propose(ctx: HookContext): ActionIntent[] {
        const { personId, deps } = ctx;
        const incidents = deps.ctx.markets?.incidents;
        const world = deps.ctx.world;
        if (!incidents || !world) {
            return [];
        }

        const engine = ctx.brain.getActionEngine();
        const isOnDutyOfficer = (id: string): boolean => {
            const job = deps.jobOf?.(id);
            return job?.jobKey === POLICE_JOB_KEY && isOnShiftAtTick(job, deps.tick);
        };

        // The suspect's side: wanted + an on-duty officer in sight — or one already out on the street with
        // the chase on (agents process sequentially within a tick; the whistle carries) → RUN.
        if (incidents.isWanted(personId)) {
            const active = engine.activeInstanceOf(personId);
            if (active?.defId === 'fleeing_the_police') {
                return [];
            }
            const officerNearby = world.peopleAt(world.locationOf(personId))
                .some(otherId => otherId !== personId && isOnDutyOfficer(otherId));
            const chaseIsOn = world.peopleAt({ kind: 'outside' })
                .some(otherId => isOnDutyOfficer(otherId) && engine.activeInstanceOf(otherId)?.defId === 'chasing_a_suspect');
            if (officerNearby || chaseIsOn) {
                return [{
                    actionId: 'fleeing_the_police',
                    sourceHook: 'pursuit',
                    priority: 200,
                    necessity: 'emergency',
                    band: 'survival',
                    mayInterrupt: true,
                    causationId: null,
                }];
            }
            return [];
        }

        // The officer's side: on duty + a wanted suspect right here — or one already bolting down the
        // street — → give chase.
        if (!isOnDutyOfficer(personId)) {
            return [];
        }
        const active = engine.activeInstanceOf(personId);
        if (active?.defId === 'chasing_a_suspect') {
            return [];
        }
        const suspectHere = world.peopleAt(world.locationOf(personId))
            .some(otherId => otherId !== personId && incidents.isWanted(otherId));
        const suspectFleeing = world.peopleAt({ kind: 'outside' })
            .some(otherId => incidents.isWanted(otherId) && engine.activeInstanceOf(otherId)?.defId === 'fleeing_the_police');
        if (!suspectHere && !suspectFleeing) {
            // DISPATCH (task 109): no suspect in sight, but an open witnessed case somewhere in town — the
            // officer drives to the scene (the normal commute machinery); on arrival the co-location logic
            // above takes over if the suspect is still around.
            if (active?.defId === 'responding_to_incident') {
                return [];
            }
            const openCase = incidents.oldestOpenCase();
            if (openCase && openCase.locationKey.startsWith('building:')) {
                return [{
                    actionId: 'responding_to_incident',
                    locationOverride: openCase.locationKey,
                    sourceHook: 'pursuit',
                    priority: 120, // above the beat walk, below the live chase
                    necessity: 'required',
                    band: 'obligation',
                    mayInterrupt: true,
                    causationId: null,
                }];
            }
            return [];
        }
        return [{
            actionId: 'chasing_a_suspect',
            sourceHook: 'pursuit',
            priority: 150,
            necessity: 'required',
            band: 'obligation',
            mayInterrupt: true,
            causationId: null,
        }];
    },
};
