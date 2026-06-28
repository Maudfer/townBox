# [Feature] People skills model & assignment

- **Type:** Feature / Simulation
- **Labels:** `feature`, `simulation`, `jobs`, `framework-followup`
- **Depends on:** 013 (skills/jobs reference tables)
- **Unblocks:** 015 (hiring), 035 (skills expansion)

## Summary

Give people a **varied, plausible set of skills** so the skill-matched hiring system (015) has something to
match against. Today every person is created with exactly one `ConstructionSkill`, so any hiring logic would
be meaningless. Skills stay simple **strings** (the `JobRequirements` enum), per the framework design
(`docs/tasks/013` §6) — no manifest of their own — but each person should carry a small, deterministic,
demographically-plausible skill set derived from the seeded world.

## Background / current state (verified)

- `WorkLife` (`src/app/game/WorkLife.ts`) hard-codes a single skill in its constructor:
  `this.skills.push(JobRequirements.ConstructionSkill)`. It exposes `getSkills()`, `setSkills()`, `getInfo()`.
- `JobRequirements` (`src/types/Work.ts`) was expanded in 013b to 8 skills (Construction, Retail, Logistics,
  Cleaning, Management, Medical, Teaching, Cooking).
- Materialization happens in `City.setupHousehold()` (`src/app/game/City.ts`): each drawn pool member becomes
  a `Person` via `personSpawnRequest`; `setupCitizenship(...)` and `social.setPersonId(...)` are called there.
  Newborns are materialized in `City.materializeNewborns()`.
- Skills are already serialized per person (`PersonSnapshot.skills`, `types/Save.ts`; restored in
  `SaveManager`), so whatever model we choose must round-trip (it already will if stored on `WorkLife`).
- Determinism substrate: `util/random.ts` `SeededRandom` (+ `hashStringToSeed`). The genealogy pool carries
  `worldSeed` (`PopulationState`).

## Goals / Requirements

1. **Decide where skills live.** Recommended: keep skills on the materialized `WorkLife` (already serialized),
   but assign them **deterministically per pool person** so the same person always has the same skills across
   save/load and re-materialization. Derive the seed from `worldSeed ^ hashStringToSeed(personId)` (mirroring
   the business-seed pattern in `City.setupBusiness`).
2. **Assign a small skill set at materialization.** In `City.setupHousehold` / `materializeNewborns`, after
   `setPersonId`, compute and `work.setSkills(...)` a deterministic 1–3 skill subset. Drive the distribution
   from data (a new `json/skills.json` weighting, or extend an existing config) rather than hard-coding —
   e.g. everyone has a baseline general-labour skill, plus 0–2 specialised skills by weight.
3. **Make skills age/▒role aware enough to be believable** (light touch): minors (below the working age in
   `json/householdDraw.json` `adultAgeYears`) may have no specialised skills yet; this also sets up 032/035's
   education events that *grant* skills over time.
4. **Remove the hard-coded single `ConstructionSkill`** default from `WorkLife` (or keep a safe empty default
   for manually-created/test people that have no `personId`).
5. **Keep it pure where practical.** The skill-selection function should be a pure
   `assignSkills(personId, age, worldSeed, params) -> JobRequirements[]` so it is unit-testable without a scene.

## Out of scope

- Hiring / matching itself (015).
- Skill *acquisition over time* via education events (032/035) — this task only seeds initial skills, but
  should leave a clear hook (`WorkLife.addSkill`) for it.

## Acceptance criteria

- People materialized from the pool carry a deterministic, varied skill set (not all `ConstructionSkill`).
- The assignment is pure/seedable and unit-tested (same `personId` + seed ⇒ same skills; distribution roughly
  matches the configured weights over a large sample).
- Skills round-trip through save/load unchanged.
- `npm test` passes.

## Notes

- Coordinate the skill vocabulary with `json/jobs.json` `requiredSkills` so hireable jobs are actually
  fillable by the population (don't define a job needing a skill nobody can have).
