# [Integration] Brain & the Hooks pattern

- **Type:** Integration / Simulation
- **Labels:** `framework`, `brain`, `actions`, `enrichment-arc`
- **Depends on:** [043](043-actions-core.md)/[044](044-action-consequences-and-object-action-relationships.md) (action engine), [042](042-event-triggers-and-causation_DONE.md) (committed-event notifications), [045](045-job-shifts-and-work-actions.md) (obligations)
- **Blocks:** [047](047-job-orchestrator.md) (publishes intents to Brains)

## Goal

`Brain.ts` — a per-person decision component (sibling of `SocialLife`/`WorkLife`) implementing [038 §8](038-simulation-enrichment-architecture_DONE.md): a stable `status`, Action-intent resolution, a deterministic hook system, the data-driven free-time selection model, and the first concrete behaviors (Woke up, shift start/end, arrival, idle fallback).

## Requirements

### State
- `status` enum — `idle | sleeping | commuting | working | performing_action | waiting_for_materialization` — **never** an arbitrary action name; the activity lives in `activeActionInstanceId` (+ its definition). Both are queryable by requirements ("is the person working?" vs. "is the person baking?").
- An intent queue for the current tick; hook registrations with deterministic ordering. Serialized (status + active action survive save/load; transient intents don't).

### Division of labor (hard rule)
- Brain **decides**; the Action engine **executes** (requirements, consequences, advancement, logs). Brain never duplicates execution logic, never mutates directly, never writes logs.

### Hooks
- Categories: `onTick`, `onEventCommitted`, `onActionStarted`, `onActionCompleted`, `onActionInterrupted`, `onLocationArrived`, `onShiftStarted`, `onShiftEnded`. First implementation focuses on `onEventCommitted` + `onTick`; the API accommodates all.
- A hook **inspects context and returns Action intents** — `{ actionId, paramBindings, sourceHook, priority, mayInterrupt, necessity: optional | required | emergency, causationId }`. Conflicts resolve by priority, then stable registration order/id. Resolution happens in lifecycle phase 7; execution requests in phase 8 (040).

### Decision model (data-driven, no special-case branches)
- Candidate build → hard-gate filter (shared requirements) → score (base weight × action-declared selection modifiers × anti-repetition penalties × recent-history/social/object/environment context) → **deterministic weighted random** (seeded per person + tick) → start via the Action engine, proposing a commute/transition Action first when the target requires a location (through the 040 boundary; identical flow in bootstrap).
- Selection modifiers read existing facts only: age/band, job/school/retirement + shift schedule, location & nearby buildings, household/family, nearby people, possessions & accessible objects, recent event/action history, relationship type/recency, time of day / day of week. No personality stats (future modifiers slot in without core changes).
- Variety requirement: two `idle` people with different contexts should measurably diverge; the same person shouldn't repeat one action endlessly absent strong context (anti-repetition works).

### First behaviors
1. **Woke up** (`onEventCommitted`): obligation check (adult with active/upcoming shift within the prep window; minor with school schedule) → propose commute intent → on arrival (hook) propose Work/School Action → else build the free-time candidate list and select. The eventual Work/school start is **an Action**; `started_working` fires from the Action lifecycle (042/043), never from the hook directly.
2. **Shift-start hook** (propose commute/Work if not started), **shift-end hook** (request Work completion/interruption), **arrival hook** (start the intended destination Action), **continuous-action-completed hook** (choose next), **social-opportunity** and **inventory-opportunity hooks** (propose interactions / pocket-use-gift-discard when eligible), **fallback idle hook** (low-priority valid action).
- This **absorbs `City.handleCommute`** (`City.ts:1291`): shift commutes become Brain intents requesting transitions through the boundary; the `TravelStep` machine remains the live `WorldAdapter`'s implementation detail. Remove the old scheduler once parity is demonstrated.

### Sleep
- A `sleeping` status needs a data-authored sleep continuous Action and a wake event (`woke_up`) — author these as part of this task's fixture content (the full daily-rhythm content pass is 051/052); without them the Woke-up hook has nothing to fire on.

## Non-goals

Stats/needs (happiness, hunger, energy) — the hook API must leave room, nothing more. Job-side intent publishing (047). Large action content (051).

## Testing

- Hook determinism: fixed seed + registrations → identical intent streams and resolutions; priority and stable-order tiebreaks.
- Woke-up matrix: employed adult on workday / off day; minor with school; unemployed adult → free-time selection; already-at-destination skips commute.
- Free-time selection: hard gates respected; weights/modifiers shift distributions (statistical test over many seeded draws); anti-repetition measurable.
- Commute absorption: parity test that people still reach work on shift under the new intent path (scene-free, stubbed adapter), off-day behavior corrected per 045.
- Bootstrap-mode: identical decision traces with the non-visual adapter (no `waiting_for_materialization` dwell).
