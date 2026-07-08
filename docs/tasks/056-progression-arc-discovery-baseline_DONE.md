# [Planning] Progression & context arc — discovery and migration baseline

- **Type:** Planning / Discovery
- **Labels:** `planning`, `progression-arc`, `skills`, `calendar`, `objects`, `consent`
- **Depends on:** the enrichment arc (039–054, all done)
- **Blocks:** every task in 057–075 (they consume this baseline), and [055](055-history-asset-pipeline.md) (the offline asset should capture this arc's output)

## Goal

The **progression & context arc (056–075)** makes time, skill acquisition, work progression, environmental
context, and interpersonal Actions *materially* affect the simulation (source vision:
`docs/planning/original_prompts/02_original_prompt_skills_rework.md`). This task is the discovery checkpoint:
re-verify the baseline below against current code (code drifts), lock the migration decisions, and record
compatibility risks **before** any schema changes. The findings from the planning pass are pre-filled; the
implementer's job is to confirm/refresh them and get the flagged decisions ratified by the maintainer.

## Verified baseline (planning pass, 2026-07-07 — re-verify on pickup)

**Calendar.** Day-of-week already exists: `util/time.ts` `DAYS_PER_WEEK`, `WEEKDAY_NAMES` (day 0 = Monday),
`dayOfWeekOfTick()` (`absolute day % 7`, negative-safe). Not exposed on `Clock`/`Timestamp`; no `isWeekend`;
nothing in `events.json` references weekdays. `util/shifts.ts` (`isOnShiftAtTick`) is the only consumer, via
`JobOrchestrator`/`Brain`.

**⚠ Conflict to ratify:** the vision doc says "adults work every day, seven days a week, to make it simpler."
But 25 of 30+ jobs in `json/jobs.json` **already author off-days** (045; e.g. `manager` mon–fri, `cook`
tue–sun), and `test/shifts.test.ts` asserts a `<7`-day job exists. **Proposed resolution (baked into 057/065):
keep the authored per-job `daysOfWeek`** — richer than the simplification and already consumed — and treat the
work-progression constant (`100/3650` per completed work day, [065](065-job-skill-progression-and-promotion_DONE.md))
as a nominal base rate, so jobs with off-days simply progress proportionally slower. Weekends gate **school only**.

**Skills.** A closed 16-member string enum (`types/Work.ts` `JobRequirements`), boolean possession only, stored
as `WorkLife.skills: JobRequirements[]`, serialized in `PersonSnapshot.skills` (`SAVE_VERSION = 8`).
`json/skills.json` is an assignment-weights config consumed by `util/skills.ts` `assignSkills` (derived
deterministically at materialization, `City.ts:271`/`:1101` — *not* stored in the pool). Hiring
(`JobMarket.bestFit`) is boolean set-cover scored `8×fitCount − distance`. Exactly two events grant skills
(`trade_school`→Mechanical, `nursing_school`→Medical) through the `SkillRegistry` adapter → `WorkLife.addSkill`.
Nothing anywhere reads a proficiency/level. Validators: `data/validators/economyContent.ts` cross-checks
jobs↔skills↔enum; `validators/events.ts` cross-checks `acquireSkill` values against `skills.json` weights.

**Jobs.** `json/jobs.json` has 33 jobs (`title`, `salary`, `requiredSkills` (each exactly one skill),
strain/admiration, `shiftStart/End`, `daysOfWeek`, `workActions.{continuous,discrete}`). **No rank/seniority
concept exists anywhere** (jobs.json, `Business.ts`, `JobFacts`, `JobOrchestrator`). A person's job is a full
`JobPosition` copy on `WorkLife`, serialized. `got_promoted` exists in `events.json` but is a no-op texture event.

**School.** Nothing schedulable exists: no school action, no age logic in `Brain.ts` (obligation =
`jobOf(person)` + `isOnShiftAtTick` only — children simply have no job so they idle), education events
(`started_school`, `graduated_school`, …) are manual, effect-free texture. The `school` business blueprint
(`businesses.json`) employs manager/teacher/janitor. `venue:` locations have **no live map backing**
(`LiveWorld.targetBuilding` returns null for venues); live school attendance must target `building:<key>`.
Live commutes are **car-based** (`City.startCommute`) — children can't drive; 058 needs a walking commute.

**Actions.** 255 actions (`types/Action.ts` schema). Parameters exist (`person`, `objectArchetype`,
`objectInstance`, `recipe`, …) **but requirements and object queries cannot read them** — `carries`/
`objectAtLocation` take static `ObjectQuery`s only; consequence `ObjectRef` supports `{param}` but queries
don't. 18 actions declare a `person` target param and **nothing ever binds it** (no hook supplies
`params.target`) — the 044/053 social/lending actions are currently unreachable dead content. No consent
mechanism, no same-building check (`WorldAdapter.peopleAt` exists but is not surfaced to the grammar). Runtime
failures carry **no typed reason** (only start-time `ActionStartOutcome` is typed); Brain has **no reaction to
failure** (`actionCompletedHook` is a stub; only `onTick`/`onEventCommitted` are dispatched).

**Events.** 698 events; 684 effect-free texture; ~151 manual-only events are never invoked by anything
(placeholders). **Events cannot carry parameters**: `EventEngine.invoke` bindings are `Record<string, PersonId>`
(roles only), `EventLogEntry` has no `params` field (contrast `ActionLogEntry.params`), and the action→event
bridge (`ActionEngine.fireEvent`) passes `{}`. Object/job texture events hardcode the object into the event id
(`bought_new_couch`, …). Effects vocabulary is a closed set of 10; context attributes closed
(`DEFAULT_BASE_ATTRIBUTES`, no rank/school attribute). **Eligibility-index invariant** (048): one RNG draw per
probabilistic event per agent, gates (`alive/gender/marital/employed/age`) necessary-only —
`test/eventEligibility.test.ts` pins bit-identical behavior; new discriminants are deliberate compiler+engine
changes and new mechanics must not alter draw counts/order.

**Objects.** 1,517 archetypes; `tags` exists but is an **activity/interest axis** (22 tags: `work`, `leisure`,
`giftable`, …), not placement. No tags on `businesses.json` blueprints; no house/residence data file. **No code
seeds buildings with objects** — the only production `createInstance` callers are in `Consequences.ts`;
`GameManager`'s "world seeding" comment is aspirational. `Inventory` fully supports the needed substrate
(location containers `building:<key>`, `instancesAtLocation`, owner kinds incl. `building`/`business`,
deterministic `o<n>` ids). The consequence-DSL `resolveContainer` can only target the *actor's* location — fine
for actions; the object generator (070) calls `Inventory` directly. Planning inputs ready:
`docs/planning/settings-and-objects.md` (54 settings = candidate tag vocabulary) and
`objects-master-list.md` (`example settings` column = object→setting seed mapping).

**Execution boundary / bootstrap.** All new mechanics must run inside `TickRunner.runTick` (mode-identical);
never `if (mode === 'bootstrap')`. `HistoryBootstrap` currently supplies **no markets**, so market-backed
effects are inert off-map — [055](055-history-asset-pipeline.md) §0-bis builds the logical world (homes, venues,
businesses) that will let this arc's school/rank/object systems run offline. Everything person-keyed must be
keyed by pool `personId` (the `Inventory`/`LifeLog` pattern), not on the `Person` object. Determinism pattern:
fork `worldSeed → tick → personId → <fixed salt>`, sort candidates before drawing; `BootstrapWorld` consumes no RNG.

**Save.** `SAVE_VERSION = 8`; migrations are pure sequential in-place upgrades (`save/migrations.ts`). This arc
adds stored state (skill proficiency records, school assignments, job rank + work-day counters, generated
objects, log failure reasons/event params) — each landing task bumps the version with a defaulting migration.

## Requirements

- Re-run the exploration pass over every claim above; correct anything that drifted and update the affected
  task files (057–075) in place.
- Ratify with the maintainer: **(a)** keep per-job `daysOfWeek` vs. flatten to 7-day weeks; **(b)** skills move
  off `WorkLife` into a central personId-keyed store (059); **(c)** the legacy-skill migration strategy
  (two-step window vs. one bundled PR); **(d)** marriage consent stays event-owned (074 note).
- Produce the **legacy inventory** the migration tasks consume: the 16 legacy skill IDs and every reference
  site (jobs.json, events.json `acquireSkill`, skills.json weights, save snapshots); the object-specific
  actions to generalize (`grab_pencil`, `pocketed_small_toy`, …); the hardcoded-object texture events; the
  ~151 never-invoked manual events; the 18 unbound person-targeted actions.
- Record migration assumptions & risks in this file's Findings section (append, keep the file self-contained).

## Non-goals

No code or data changes. No new decisions beyond ratifying the flagged ones — design lives in 057–075.

## Testing

None (planning task). The arc's quality gates are specified per-task; the end-to-end net is
[075](075-progression-arc-validation-and-docs_DONE.md).

---

## Findings & decisions (session of 2026-07-07 — task completed)

The exploration pass was performed fresh in the planning session that authored this arc (six parallel
subsystem sweeps: calendar/shifts, skills, actions/Brain/JobOrchestrator, events, objects/inventory,
bootstrap/save/validators); the baseline above **is** that pass's output, verified against `main` at
`e555cfb`. No drift to correct at authoring time — re-verify opportunistically per task (§5.1's standing rule)
rather than as a separate gate.

### Maintainer decisions (ratified 2026-07-07)

- **(a) Work weeks — keep per-job authored off-days.** The 045 `daysOfWeek` data stands; weekends gate school
  only; the 065 work-progression constant (`100/3650`) reads *per completed work day* (nominal 10 years for a
  7-day job, proportionally slower for 5-day jobs). The vision doc's "adults work 7 days" simplification is
  superseded.
- **(b) Skill storage — central store.** Skill records live in a personId-keyed `SkillBook` (the
  `Inventory`/`LifeLog` pattern), serialized as its own snapshot section; `WorkLife` keeps only a thin read
  path. Required for off-map simulation and the 055 asset.
- **(c) Skill migration — big-bang bundle.** Tasks **059 + 060 + 061 + 062 land as ONE branch/PR**: schema +
  store + basics + specific families + reference remaps + initialization together. No `legacy: true`
  transitional entries, no interim `assignSkills` weight remap — the bundle replaces the whole skill model
  atomically while keeping `main` playable (it only ever sees the completed bundle). The v8→v9 save migration
  maps legacy enum skills directly to the new specific-skill records via 061's mapping table. Task files
  059–062 stay separate (scoping/review clarity) but share the branch.
- **(d) Marriage — stays event-owned.** The `marriage` event (two-role search, cohabitation signals, 023
  machinery) is untouched by the consent work; consent applies to social/object actions. An optional
  `proposed_marriage` flavor action remains a non-required stretch noted in 074.

### Legacy inventory (consumed by 059–062, 068, 072/074)

- **16 legacy skill IDs** (`types/Work.ts` `JobRequirements`): Retail, Cleaning, Construction, Logistics,
  Hospitality, Cooking, Driving, Mechanical, Security, Beauty, Management, Teaching, Finance, Engineering,
  Fitness, Medical (each suffixed `Skill`). Reference sites: `json/jobs.json` `requiredSkills` (33 jobs, one
  skill each), `json/events.json` `acquireSkill` effects (`trade_school`→`MechanicalSkill`,
  `nursing_school`→`MedicalSkill`), `json/skills.json` weights (all 16), `PersonSnapshot.skills` in v≤8 saves,
  `util/skills.ts` + its validators, `SkillRegistry.VALID_SKILLS`, HUD `PersonDetails` display.
- **Object-specific actions to generalize:** `grab_pencil` (hardcoded archetype in requirement + consequences),
  `pocketed_small_toy` (hardcoded `childhood` tag); template to follow: `pocketed_small_object` (flag-driven).
- **Hardcoded-object texture events** (possessions/lending families, ~40+): `bought_new_couch`,
  `bought_new_tv`, `lost_keys`, `lent_lawnmower`, `lawnmower_never_returned`, `returned_garden_gnome`, … —
  068's classification sweep owns the full table.
- **~151 manual-only events invoked by nothing** (052 placeholders) — 068 wires/retires/downgrades.
- **18 person-targeted actions with an unbound `target` param** (044/053 social/lending set) — revived by 072's
  socialOpportunityHook.

### Migration assumptions & risks

- Save chain: v8 → v9 (skills store, the 059–062 bundle) → further bumps as tasks add state (school
  assignments, rank counters, generated-object sweep marker, log `failureReason`/event `params` are additive
  where possible). Each migration is a pure sequential in-place upgrade per `save/migrations.ts` convention.
- The eligibility-index bit-identical invariant (`test/eventEligibility.test.ts`) is the standing constraint on
  067/068: payloads must not alter probabilistic RNG draw counts/order; new discriminants are deliberate
  compiler+engine changes only.
- Bootstrap supplies no markets today; all arc systems are authored mode-agnostic and become fully live
  off-map when 055 builds the logical world (schools, businesses, building object fill).
