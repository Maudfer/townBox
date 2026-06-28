# [Feature] Skill-matched hiring as resource-slot events

- **Type:** Feature / Simulation
- **Labels:** `feature`, `simulation`, `jobs`, `economy-precursor`, `framework-followup`
- **Depends on:** 013 (Engine A businesses + Engine B `acquireSlot`/`releaseSlot`), 014 (people skills)
- **Unblocks:** 006 (commute), 018 (wages)

## Summary

Make people actually **get hired and laid off**, filling the job positions that businesses mint. Today the
business positions exist but nothing fills them: `Workplace.hire()`/`layoff()` are never called, and the
event engine's `acquireSlot`/`releaseSlot` effects are **no-ops** (`game/EventEngine.ts` §applyEffect). This
task realises hiring as the framework's **resource-pivot** pattern (`docs/tasks/013` §5.9): the `get_job`
event acquires an open job slot at a nearby, skill-matched workplace; `layoff` releases it.

## Background / current state (verified)

- `Workplace` (`src/app/game/Workplace.ts`) holds `avaiableJobs: JobPosition[]` (open positions, set from the
  generated `BusinessInstance.positions` in `setBusiness`) and `employees: Person[]`. `hire(person)` finds an
  open job whose `requirements` are all in the person's `getSkills()`, moves it to employed, returns the job;
  `layoff(person)` returns their job to the open pool. **Neither is called anywhere today.**
- The event manifest (`src/json/events.json`) defines `get_job` (requires `alive`, `age>=18`,
  `employed==false`; effects `acquireSlot resource:job`, `setAttr employed=true`, `emit hired`) and `layoff`
  (requires `employed==true`; effects `releaseSlot`, `setAttr employed=false`, `emit laidOff`).
- `EventEngine` keeps an **attribute overlay** where `employed` currently lives, **disconnected from
  `WorkLife.job`**. `applyEffect` treats `acquireSlot`/`releaseSlot`/`adjustMoney` as no-ops (see the comment
  there). The engine runs over materialized people each day via `City.handleNewDay`, returning a `DayResult`
  with a `signals` queue that `City` currently only partly consumes.
- Distance: `Building.getPosition()` / `getEntrance()` and `GameManager` coordinate helpers give home↔work
  distance. `Person.social.getHome()` returns the `House`.
- `City` indexes materialized people by pool id each day (`personByGenId`) and owns reconciliation.

## Goals / Requirements

1. **Unify `employed` with real employment.** A person's `employed` attribute must reflect having a
   `WorkLife.job`, not a free-floating overlay flag. Decide the source of truth (recommended: derive
   `employed` in the engine Context from whether the person has an assigned job) so events and gameplay agree.
2. **Make `acquireSlot` real.** When `get_job` fires for a person, find the **best open matching position**
   across workplaces and bind it: call `Workplace.hire(person)` (skills already gate this), set
   `WorkLife.setJob(...)`, decrement the workplace's open positions. If no matching open slot exists in range,
   the event must **fail/abort** (no employment, no `employed=true`) — i.e. `acquireSlot` is a real
   precondition, not an optimistic flag. This likely means slot availability has to be checked during
   **eligibility** (a role/`where` or a pre-effect guard), so the per-day probability only rolls when a slot
   is actually fillable. Document the chosen mechanism.
3. **Hiring weighting (the old 007 §8).** Among fillable positions, prefer **shorter home↔workplace distance**
   and **better skill match**; combine into a deterministic score (seeded tie-breaks). Manhattan or Euclidean
   tile distance is fine — document the choice.
4. **Make `releaseSlot` real.** `layoff` calls `Workplace.layoff(person)`, clears `WorkLife.job`, returns the
   position to the open pool.
5. **Bridge engine ↔ Workplace.** The engine is pure over the pool; hiring touches materialized `Workplace`s.
   Resolve this cleanly — e.g. the engine emits `hired`/`laidOff` **signals with enough payload** (candidate
   id + chosen workplace/job) and `City` performs the actual `Workplace.hire`/`setJob`, OR the engine is given
   a slot-provider interface. Keep the engine scene-free and deterministic; prefer the signal-handler route
   consistent with how rehousing is handled in `City`.
6. **Determinism & save.** Hiring outcomes must be reproducible per seed+tick; employment already serializes
   (`PersonSnapshot.job`, `Workplace` employee ids, the `business`), so verify round-trip after hires.

## Out of scope

- The daily commute itself (006) — this task only assigns the job/employer.
- Wages/economy (017–018).
- Ongoing re-recruitment optimisation beyond "fire the per-day `get_job` event when a slot is reachable."

## Acceptance criteria

- Over simulated days, eligible unemployed adults get hired into skill-matching open positions, preferring
  nearby workplaces; `WorkLife.job` and the workplace's filled/open counts stay consistent.
- `get_job` cannot produce employment when no matching open slot is reachable.
- `layoff` frees the slot and clears the job.
- Deterministic per seed; employment round-trips through save/load.
- `npm test` passes with unit tests for the slot-binding, the distance+skill score, and a hire→layoff cycle.

## Notes

- This is where the deferred 013b/013d hiring lands. Revisit `Workplace.setBusiness`'s note about open/filled
  reconciliation across save (013) — with real hiring you may want explicit per-slot identity rather than the
  current "all positions open on load" simplification.
