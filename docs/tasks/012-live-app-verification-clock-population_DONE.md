# [Task] Live-app verification pass — clock, population & general gameplay QA

- **Type:** Verification / QA
- **Labels:** `qa`, `verification`, `simulation`, `time`, `gameplay`

> **Status: ✅ Done.** Originally a 004d/005 follow-up stub about the clock and population sim only;
> refreshed and **expanded to a general gameplay verification pass** (2026-07-12) now that the Playwright
> integration suite (task 008) covers the automatable layer. The pass was executed the same day in the
> running production build (driven via the Claude Chrome extension against `localhost`); the full
> verification report is at the bottom of this file. Three bugs were fixed during the pass (frozen
> same-segment car trips, the d3 family-tree hairball, and its svg-size call-site); the remaining
> findings are proposed as follow-ups in the report.

## Summary

The unit suite and the task-008 Playwright integration suite verify behaviour *mechanically* (state
via the `window.__townbox` hook). What they cannot judge is whether the game **looks and feels right**:
sprites, animation, layout, readability of the HUD windows, believability of the simulation pacing, and
the emergent economy. This task is a structured exploratory session in the running app covering the
core loop end to end, producing a verification report + bug/balance tickets.

## Background / current state (verified 2026-07-12)

- **Time:** the clock is driven from `MainScene.update` → `GameManager.advanceTime`, shown by
  `hud/Clock.tsx` (fed by `timeChanged`). 1 in-game day = 1 real hour; the canonical simulation tick is
  the in-game **hour** (`newTick`, 24/day — task 040). The per-tick life sim runs in `City.handleTick`
  (Engine B + Actions + Brain through the shared `TickRunner`); `City.handleNewDay` runs day-cadence
  upkeep (coarse off-map pool sim, monthly economy gate, school sweeps).
- **Acceleration exists now** — the old "we need a debug time-scale toggle" note is obsolete: booting
  with `?test=1` installs the task-008 determinism hook (`window.__townbox`), pauses the RAF clock, and
  gives `stepTicks(n)` / `pumpFrames(n)` in the DevTools console. `?boot=new&seed=N` cold-starts a
  seeded pool (skips the history asset); a plain boot (no params) plays the real new-game path,
  selecting a window of the committed history asset.
- **Commute spec (hardened on the task-008 branch):** car materializes on the street in front of the
  origin, person walks out and boards (sprite vanishes), the occupied car drives and parks on the road
  in front of the destination, person steps out and walks the last leg; cars never move empty.
- Run via `npm run dev` (Parcel + browser-sync on `./dist`) or serve the production build
  (`npm run build-prod`, then `node scripts/serveIntegration.mjs --dir ./bin --port 4599`).

## Things to verify

### A. Clock & time (the original 005 scope)

1. The HUD clock widget appears and advances; weekday + date/time format correct; years from Year 1.
2. Clicking the clock opens the city overview dashboard.
3. Save → reload resumes at the saved date/time.

### B. World building & placement

4. Roads paint smoothly (drag-paint), snap to the supertile grid, and auto-tile correctly at corners,
   T-junctions and crossings.
5. Houses/workplaces soft-snap flush against road sides; invalid spots preview red and reject clicks.
6. Placing a **house** spawns a coherent household (materialized residents, correct ages/kinship);
   placing a **work** building generates a plausible business (name, line of work, positions).
7. Bulldozing behaves coherently (residents evicted, businesses closed, lot desaturated).

### C. People, employment & the economy (balancing eyes on)

8. Over stepped time, unemployed adults **get jobs** — watch the feed for hires. If nobody is hired,
   dig into WHY (skill mismatch? distance scoring? no reachable slots? shift authoring?) and record
   the reasons — input for a balancing pass.
9. Employed residents **commute**: car appears on the street, person walks to it and vanishes inside,
   car drives lanes to the destination road, person walks the last leg, enters; the reverse at shift
   end. Minors walk to school on weekdays.
10. The monthly economy visibly moves: business balances/P&L in the workplace inspector, wages,
    cost-of-living; nothing obviously explodes (runaway balances) over a few in-game months.

### D. HUD windows & inspectors

11. Person inspector: identity/work/skills/relationships render; the **life-event log updates live**
    as the person acts (actions, events, school/work days) and carries pre-game history when booted
    from the history asset.
12. Household window: the resident list works, and the **d3 family tree** renders legibly —
    **known suspect:** the force-directed graph has rendering problems (hairball layout, labels
    overlapping/clipped at edges, links crossing everywhere). Diagnose and note root cause.
13. Workplace inspector: positions filled/open, employees, balance and last-month P&L.
14. City overview: population/employment/business/economy stats plausible and live.
15. Windows: open/move/resize/close feel right; z-order sane; the feed collapses/expands; toasts
    appear on save/load.

### E. Stability

16. No console errors during a normal session (place, simulate, inspect, save, load).
17. No leaked sprites (people/cars that never despawn) or obvious perf cliffs as time advances.

## Deliverables

- A **verification report** (pass/fail per item, with screenshots where useful) — appended to this
  task or as the PR description — and bug/balance follow-up notes for anything found.
- Small fixes may land with the pass where they are obvious and low-risk; anything bigger becomes a
  follow-up task proposal.

## Notes

- Supersedes the original 004d/005-only scope; the clock/population items are §A plus items 6 and 8.
- The task-008 Playwright suite automates the mechanical layer; keep this pass focused on what only
  eyes can judge (visuals, pacing, believability, balance).

---

## Verification report (2026-07-12, production build via Chrome extension)

Method: production bundle served from `./bin`; a seeded test-mode session (`?test=1&boot=new&seed=…`,
`window.__townbox.stepTicks/pumpFrames` for acceleration) for the bulk, plus a normal-mode session for
the title screen / real new-game path. Town: 8 road segments, 3 houses (3 households, 6 people),
2 businesses (art studio "Silva, Souza e Melo" — 1 Manager + 5 Teachers; + one more).

### Pass/fail by checklist item

| # | Item | Result |
|---|------|--------|
| 1 | Clock widget: weekday + Year-1 format, advances | ✅ (Mon 01/01 → Fri 01/26 → month rollover to 02/11; Sat/Sun correct) |
| 2 | Clock click opens city overview | ✅ (works since the task-008 `pointer-events` fix) |
| 3 | Save → reload resumes at saved date/time | ✅ (Wed 01/03 02:00 exact; world intact; "Game saved" toast) |
| 4 | Road paint / snap / auto-tile | ✅ auto-tiling correct · ⚠️ fast drags leave **gaps** (no interpolation between pointermove samples) |
| 5 | Building soft-snap | ✅ (preview soft-snaps to the next FREE road-side spot when the hovered one is taken) |
| 6 | House → coherent household; work → business | ✅ (ages/kinship coherent — spouses + son 14; business name/line/size/positions plausible) |
| 7 | Bulldoze coherence | ✅ (covered by the task-008 Playwright suite) |
| 8 | Unemployed adults get jobs | ✅ but **slow by design** — see balancing notes |
| 9 | Commute (car on street → board/vanish → drive → park on road → walk in; off-days) | ✅ visually verified end to end; no commute on Sat/Sun; shift 9:00–18:00 rendered |
| 10 | Monthly economy moves | ✅ (unstaffed business bleeds −$4k/mo fixed costs; balance 76k→72k after hire; arrears event fired) |
| 11 | Person inspector + live life-event log | ✅ (41 entries, newest-first, trigger sources `brain/action/system`; work obligation interrupts free-time TV; "shopping **(blocked)**" when no retail venue exists; education event granted skills) |
| 12 | d3 family tree | 🐞→✅ **fixed during the pass** (see below) |
| 13 | Workplace inspector | ✅ (positions update after hire; employee list clickable; balance + P&L; generated business stock — easels, pottery wheel, clay…) |
| 14 | City overview stats | ✅ (residents/households/homeless/pool 3,156 living / 7,626 total) |
| 15 | Window ergonomics | 🐞 several issues — see findings |
| 16 | Console errors | ✅ none over the whole session |
| 17 | Leaks / perf cliffs | ✅ post-fix (cars despawn on arrival) · 🔴 except the new-game asset freeze below |

### Bugs FIXED during the pass

1. **Same-segment car trips froze** (`Vehicle.setDestinationTile`): when a trip's destination street
   cell was on the road segment the car was parked on, the path collapsed to that one segment,
   `setNextTarget` skipped it (same tile) and the car was left targetless — frozen forever. In practice
   every same-segment **leisure trip** stalled, stacking idle cars on the street with their passengers
   locked in `driving`. Fixed (arrive-in-place; unreachable destinations still stay targetless), with
   revert-danced unit tests in `test/agents/vehicle.test.ts`.
2. **d3 family-tree hairball** (`hud/d3/familyTree.ts`): link distance 400px (bigger than the panel),
   charge −10, no collision force, no bounds clamping — edges spanned the viewport and labels
   piled/clipped at the edges. Retuned (distance 60, charge −120, `forceCollide`, gentle center pull,
   bounds clamp) and the call-site now passes the SVG's real size instead of the window size. The tree
   is legible: bold household members, dimmed italic † deceased, labeled edges, everything in-bounds.
3. *(Earlier the same day, task-008 branch: commutes frozen since the 3×3 subdivision; commute spec.)*

### Findings — proposed follow-ups

- ✅ **FIXED (same PR) — real "Start Game" froze the tab 4+ minutes** (gave up waiting). The committed
  default history asset (~530 MB compressed, full action log) was fetched and inflated/parsed
  **synchronously on the main thread** — all shards, for every person in the pool, up-front. Fixed
  architecturally with the **person-keyed lazy asset layout (format v2)**: the generator writes one
  `person-<id>.tbz` per retained person; boot fetches only the small population/objects sections
  (~1.5 MB), and each drawn person's history hydrates on demand at household placement
  (`GameManager.hydratePeople`). Boot is now seconds regardless of asset size; save v14 pins the asset
  ref so loaded games keep hydrating. Guarded by `test/integration/scenarios/history-asset.spec.ts`
  (boot-fast + pre-game-history-on-placement) and the lazy-vs-eager equivalence tests in
  `test/history/`.
- 🐞 **A single click can place two buildings**: build tools drag-paint on `pointermove` while the
  button is down, so 1 px of click jitter paints a second house/workplace at the *next* free soft-snap
  spot (observed: 2 clicks → 3 houses). Roads are idempotent (same supertile). Suggest restricting
  drag-paint to road/soil/bulldoze.
- 🐞 **Fast road drags leave gaps** — drag-paint places one segment per pointermove sample with no
  interpolation between samples.
- 🐞 **Window ergonomics**: (a) every window opens at the same (10,10), stacking exactly on top of each
  other AND under the clock widget (which hides the title bar — e.g. the business NAME lives there);
  (b) the city feed overlaps the leftmost toolbar button; (c) `Hud.tsx` renders windows with
  `key={uuidv4()}` — a new key every render — so all windows fully remount on any HUD state change
  (scroll/position resets; suspected cause of windows spontaneously closing during the session).
- ⚖️ **Employment pacing**: `get_job` is 4/year per eligible person → with 5 adults the town's FIRST
  hire lands ~day 18 in expectation (observed: day 34; ~90 days median per individual). Mechanically
  correct but a fresh town feels dead for weeks. Consider a higher rate or an eagerness multiplier
  while `canBeHired` (job-seeking is not a random life event for the unemployed).
- ⚖️ **Household solvency pacing**: an unemployed household hit "can't make ends meet" within the
  first month and a person balance drained $800 → $0 — the runway before arrears feels very short
  against how slowly jobs arrive (the two rates interact badly; same balancing pass).
