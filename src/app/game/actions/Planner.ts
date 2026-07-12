// The planner (task 085 / proposal D2): the Brain hook that gives people INTENTIONALITY across ticks.
// Producers enqueue agenda entries (decision-layer state, like the Brain's memos — never simulation state):
//   - ROUTINES (json/routines.json): the habit cadence between hourly needs and rare milestones — weekly
//     shopping, calling family, hobby nights. Adoption is deterministic per (worldSeed, personId, routineId);
//     a routine re-plans only when its action hasn't happened within its cadence and no entry is pending.
//   - SOCIAL VISITS: the see_friends routine upgrades to a LOCATED visit when a real friend edge exists —
//     the entry carries locationOverride 'person:<friendId>', and the execution boundary routes the visitor
//     to wherever the friend actually is (the general "go to where that person is" mechanism).
// The hook then PROPOSES the oldest due entry at commitment priority: above free time, below critical needs
// and shift/school obligations (the full band model lands with task 086).
//
// Determinism: producers and picks are pure functions of (worldSeed, tick, personId, agenda state); RNG uses
// the salted-fork convention; entries serialize in the save (v16 family).

import { ActionIntent, BrainHook, HookContext } from 'game/actions/Brain';
import routinesConfig from 'json/routines.json';
import { RoutinesConfig } from 'types/Agenda';
import { evaluatePredicateCached } from 'util/predicate';
import { SeededRandom, hashStringToSeed } from 'util/random';
import { TICKS_PER_DAY, hourOfTick } from 'util/time';

export const ROUTINES_CONFIG = routinesConfig as unknown as RoutinesConfig;
const PLANNER_SALT = 0x91a;
// Only meaningful friendships pull a located visit (below this, the generic routine is company enough).
const VISIT_EDGE_MIN_STRENGTH = 25;

export const plannerHook: BrainHook = {
    id: 'planner',
    kind: 'onTick',
    propose({ personId, deps, brain }: HookContext): ActionIntent[] {
        const agenda = deps.ctx.markets?.agenda ?? null;
        if (!agenda) {
            return [];
        }
        const engine = brain.getActionEngine();
        const hasAction = (actionId: string, query?: { withinTicks?: number; minCount?: number }): boolean =>
            engine.hasAction(personId, actionId, deps.tick, query);

        // --- Producers (agenda bookkeeping — decision-layer state) ------------------------------------
        const context = engine.contextFor(personId, deps);
        for (const [routineId, routine] of Object.entries(ROUTINES_CONFIG).sort(([a], [b]) => a.localeCompare(b))) {
            // Deterministic adoption: this person either carries the routine or never does.
            const adopted = new SeededRandom(deps.state.worldSeed)
                .fork(PLANNER_SALT).fork(hashStringToSeed(personId)).fork(hashStringToSeed(routineId))
                .next() < routine.adoption;
            if (!adopted) {
                continue;
            }
            if (routine.requires && !evaluatePredicateCached(routine.requires, context)) {
                continue;
            }
            if (agenda.hasPendingRoutine(personId, routineId, deps.tick)) {
                continue;
            }
            if (hasAction(routine.action, { withinTicks: routine.cadenceDays * TICKS_PER_DAY })) {
                continue; // recently done — the cadence clock restarts from that occurrence
            }
            // Plan the next window: today's if still open, else tomorrow's.
            const hour = hourOfTick(deps.tick);
            const dayStart = deps.tick - hour;
            const [windowStart, windowEnd] = routine.window;
            const targetDay = hour <= windowEnd ? dayStart : dayStart + TICKS_PER_DAY;
            const entry = {
                personId,
                actionId: routine.action,
                enqueuedAtTick: deps.tick,
                earliestTick: targetDay + windowStart,
                latestTick: targetDay + windowEnd,
                routineId,
                causationId: null,
                source: 'routine',
            };
            // The located social visit (D2): see_friends goes to a REAL friend when one exists.
            if (routine.action === 'visiting_friends') {
                const social = deps.ctx.markets?.social ?? null;
                const friends = social?.edgesOf(personId, deps.tick)
                    .filter(edge => ['friend', 'close_friend'].includes(edge.view.kind) && edge.view.strength >= VISIT_EDGE_MIN_STRENGTH) ?? [];
                if (friends.length > 0) {
                    const best = friends.reduce((top, edge) => edge.view.strength > top.view.strength ? edge : top);
                    agenda.enqueue({ ...entry, locationOverride: `person:${best.otherId}` });
                    continue;
                }
            }
            agenda.enqueue(entry);
        }

        // --- Proposal: the oldest due entry ------------------------------------------------------------
        const due = agenda.dueEntriesOf(personId, deps.tick, hasAction);
        for (const entry of due) {
            if (entry.prerequisites && !evaluatePredicateCached(entry.prerequisites, context)) {
                continue; // deferred — maybe later in the window
            }
            return [{
                actionId: entry.actionId,
                ...(entry.params ? { params: entry.params } : {}),
                ...(entry.locationOverride ? { locationOverride: entry.locationOverride } : {}),
                sourceHook: 'planner',
                priority: 55,
                necessity: 'required',
                mayInterrupt: false,
                causationId: entry.causationId,
            }];
        }
        return [];
    },
};
