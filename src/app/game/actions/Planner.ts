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
import { SICK_HEALTH_THRESHOLD } from 'game/actions/JobOrchestrator';
import routinesConfig from 'json/routines.json';
import { RoutinesConfig } from 'types/Agenda';
import { spouseAt, childrenOf, parentsOf, isAliveAt } from 'util/kinship';
import { evaluatePredicateCached } from 'util/predicate';
import { SeededRandom, hashStringToSeed } from 'util/random';
import { TICKS_PER_DAY, hourOfTick } from 'util/time';

export const ROUTINES_CONFIG = routinesConfig as unknown as RoutinesConfig;
const PLANNER_SALT = 0x91a;
// Only meaningful friendships pull a located visit (below this, the generic routine is company enough).
const VISIT_EDGE_MIN_STRENGTH = 25;

// Hoisted once (task 118): the producer loop ran Object.entries(...).sort(...) per person per tick.
const SORTED_ROUTINES = Object.entries(ROUTINES_CONFIG).sort(([a], [b]) => a.localeCompare(b));

// Adoption is a pure function of (worldSeed, personId, routineId) — memoized (task 118): the seeded fork
// chain ran ~9× per person per tick in the generator's hot band. Bounded by people × routines.
const adoptionMemo = new Map<string, boolean>();

// The strongest real friendship worth a visit (V9), or null. A located visit only happens toward a genuine
// friend/partner edge above the strength floor — below it the generic company is enough.
function bestFriendTarget(deps: HookContext['deps'], personId: string): string | null {
    const social = deps.ctx.markets?.social ?? null;
    const friends = social?.edgesOf(personId, deps.tick)
        .filter(edge => ['friend', 'close_friend', 'dating', 'engaged'].includes(edge.view.kind) && edge.view.strength >= VISIT_EDGE_MIN_STRENGTH) ?? [];
    if (friends.length === 0) {
        return null;
    }
    return friends.reduce((top, edge) => edge.view.strength > top.view.strength ? edge : top).otherId;
}

// A living close relative to visit (V9), or null — the lowest-id living parent or adult child (deterministic).
// The spouse is excluded (you cohabit, you don't "visit"); an unresolvable/off-map target simply cancels.
function bestRelativeTarget(deps: HookContext['deps'], personId: string): string | null {
    const pool = deps.state.people;
    const spouse = spouseAt(pool, personId, deps.tick);
    const kin = [...parentsOf(pool, personId), ...childrenOf(pool, personId)]
        .filter(id => id !== personId && id !== spouse && pool[id] && isAliveAt(pool[id]!, deps.tick))
        .sort();
    return kin[0] ?? null;
}

function isAdopted(worldSeed: number, personId: string, routineId: string, adoption: number): boolean {
    const key = `${worldSeed}|${personId}|${routineId}`;
    const cached = adoptionMemo.get(key);
    if (cached !== undefined) {
        return cached;
    }
    const adopted = new SeededRandom(worldSeed)
        .fork(PLANNER_SALT).fork(hashStringToSeed(personId)).fork(hashStringToSeed(routineId))
        .next() < adoption;
    adoptionMemo.set(key, adopted);
    return adopted;
}

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
        for (const [routineId, routine] of SORTED_ROUTINES) {
            // Deterministic adoption: this person either carries the routine or never does (memoized, 118).
            if (!isAdopted(deps.state.worldSeed, personId, routineId, routine.adoption)) {
                continue;
            }
            // Cheap gates first (task 118): the O(1) dedup and recency checks screen most ticks before the
            // requires predicate ever evaluates. All three are pure reads — order changes nothing.
            if (agenda.hasPendingRoutine(personId, routineId, deps.tick)) {
                continue;
            }
            if (hasAction(routine.action, { withinTicks: routine.cadenceDays * TICKS_PER_DAY })) {
                continue; // recently done — the cadence clock restarts from that occurrence
            }
            if (routine.requires && !evaluatePredicateCached(routine.requires, context)) {
                continue;
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
            // Collective social visits (V9 / aliveness-4): a visit is a TWO-SIDED scene in ONE house, not a
            // solo trip the host ignores (the audit's "Visiting friends" floating over a business). Both
            // visiting_friends and visiting_relatives are now planner-only (free-time weight 0) and ALWAYS
            // located to a real person — and they enqueue a MIRRORED hosting_a_friend_visit for the host, so
            // the friend/relative is genuinely hosting at home at the same time, both ending together.
            if (routine.action === 'visiting_friends' || routine.action === 'visiting_relatives') {
                const hostId = routine.action === 'visiting_friends'
                    ? bestFriendTarget(deps, personId)
                    : bestRelativeTarget(deps, personId);
                if (hostId !== null) {
                    const linkId = `visit${deps.tick}-${personId}`;
                    agenda.enqueue({ ...entry, locationOverride: `person:${hostId}`, linkId });
                    // The host's side (V9): welcomes the visitor at home, linked to the same window.
                    agenda.enqueue({
                        personId: hostId,
                        actionId: 'hosting_a_friend_visit',
                        locationOverride: 'home',
                        enqueuedAtTick: deps.tick,
                        earliestTick: entry.earliestTick,
                        latestTick: entry.latestTick,
                        linkId,
                        causationId: null,
                        source: 'routine',
                    });
                }
                // No real target → no visit (never enqueue an unlocated one — a visit needs someone to visit).
                continue;
            }
            agenda.enqueue(entry);
        }

        // The jail visit (task 109, closing the 100 deferral): a detained close relative gets visited —
        // once per stretch (the visit action's own recency gates re-planning), at the facility.
        const detentionOf = deps.detentionOf;
        if (detentionOf && !agenda.hasPendingRoutine(personId, 'jail_visit', deps.tick)
            && !hasAction('visiting_the_detained', { withinTicks: 5 * TICKS_PER_DAY })) {
            const pool = deps.state.people;
            const kin: string[] = [];
            const spouse = spouseAt(pool, personId, deps.tick);
            if (spouse) {
                kin.push(spouse);
            }
            kin.push(...childrenOf(pool, personId), ...parentsOf(pool, personId));
            const detained = kin.sort().find(relativeId => detentionOf(relativeId) !== null);
            if (detained) {
                const facility = detentionOf(detained)!;
                const hour = hourOfTick(deps.tick);
                const dayStart = deps.tick - hour;
                const targetDay = hour <= 18 ? dayStart : dayStart + TICKS_PER_DAY;
                agenda.enqueue({
                    personId,
                    actionId: 'visiting_the_detained',
                    params: { target: detained },
                    enqueuedAtTick: deps.tick,
                    earliestTick: targetDay + 9,
                    latestTick: targetDay + 18,
                    locationOverride: 'building:' + facility.locationKey,
                    routineId: 'jail_visit',
                    causationId: null,
                    source: 'routine',
                });
            }
        }

        // The sick visit (task 111): a close relative below the sick threshold gets visited — the 095
        // social-support loop made physical. The locationOverride follows the PERSON (the D2 mechanism),
        // so the visit lands at their bedside wherever that is — home or the hospital ward alike. Health
        // reads cost a context each, so the producer sweeps once per day (the 08:00 tick).
        if (deps.eventEngine && hourOfTick(deps.tick) === 8
            && !agenda.hasPendingRoutine(personId, 'sick_visit', deps.tick)
            && !hasAction('visiting_the_sick', { withinTicks: 3 * TICKS_PER_DAY })) {
            const pool = deps.state.people;
            const kin: string[] = [];
            const spouse = spouseAt(pool, personId, deps.tick);
            if (spouse) {
                kin.push(spouse);
            }
            kin.push(...childrenOf(pool, personId), ...parentsOf(pool, personId));
            const sick = kin.sort().find(relativeId => {
                const health = deps.eventEngine!.contextFor(deps.state, relativeId, deps.tick, deps.ticksPerYear).getAttr('health');
                return typeof health === 'number' && health < SICK_HEALTH_THRESHOLD;
            });
            if (sick) {
                const dayStart = deps.tick - hourOfTick(deps.tick);
                agenda.enqueue({
                    personId,
                    actionId: 'visiting_the_sick',
                    params: { target: sick },
                    enqueuedAtTick: deps.tick,
                    earliestTick: dayStart + 9,
                    latestTick: dayStart + 18,
                    locationOverride: `person:${sick}`,
                    routineId: 'sick_visit',
                    causationId: null,
                    source: 'routine',
                });
            }
        }

        // --- Proposal: the oldest due entry ------------------------------------------------------------
        const due = agenda.dueEntriesOf(personId, deps.tick, hasAction);
        for (const entry of due) {
            if (entry.prerequisites && !evaluatePredicateCached(entry.prerequisites, context)) {
                continue; // deferred — maybe later in the window
            }
            // Don't propose the currently-impossible (task 109 fix): an entry whose ACTION requirements
            // aren't satisfiable right now (no cleaning supplies, no ingredients) must not starve the due
            // entries behind it all day — skip it, keep it pending, and let the next one through.
            const def = engine.getManifest()[entry.actionId];
            if (def?.requirements) {
                const entryContext = entry.params ? engine.contextFor(personId, deps, entry.params) : context;
                if (!evaluatePredicateCached(def.requirements, entryContext)) {
                    continue;
                }
            }
            return [{
                actionId: entry.actionId,
                ...(entry.params ? { params: entry.params } : {}),
                ...(entry.locationOverride ? { locationOverride: entry.locationOverride } : {}),
                sourceHook: 'planner',
                priority: 55,
                necessity: 'required',
                band: 'commitment',
                mayInterrupt: false,
                causationId: entry.causationId,
            }];
        }
        return [];
    },
};
