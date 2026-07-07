# [Feature] Person skill initialization & early-childhood seeding

- **Type:** Feature / Simulation
- **Labels:** `skills`, `bootstrap`, `progression-arc`
- **Depends on:** [059](059-skill-proficiency-schema-and-store.md), [060](060-basic-skills-backfill.md), [061](061-specific-skills-backfill-and-migration.md)
- **Bundling (ratified 056 decision c):** lands in the single **059+060+061+062** branch/PR — this task's
  initializer is what keeps hiring alive the moment 061's remap applies.
- **Blocks:** [064](064-job-ranks-and-training-grants.md) hiring realism (people need plausible skill sets)

## Goal

Nobody but newborns should be skill-less. Every person entering detailed simulation gets a **deterministic,
age-appropriate** skill set: newborns none; ages 1–6 a small foundational set via **age milestones**; ages 7–17
school-derived proficiency; adults **all basic skills at 60.0** plus a contextual assortment of specifics.
Replaces `util/skills.ts` `assignSkills` and the weights-config model entirely.

## Background (verified)

Today `assignSkills(personId, ageYears, worldSeed)` draws 0–3 boolean skills at materialization
(`City.ts:271`, `:1101`) and is the only initialization path; pool people have no skills until materialized;
bootstrap-simulated people acquire nothing (no skills market off-map). With 059's store, skills are stored per
`personId` and exist independently of materialization — initialization becomes "the first time a person enters
detailed simulation" (materialization in live play; agent-list entry in bootstrap; founder creation in 055).

## Requirements

- **One initializer, both modes:** a pure `initializeSkills(personId, ageTicks, worldSeed, …)` in/next to the
  skill store, invoked lazily the first time a person is simulated in detail and recorded so it never re-runs
  (idempotent; survives save/load). Seeded `worldSeed ^ hash(personId)` (the existing `assignSkills` pattern) —
  placement-order-independent, deterministic.
- **Newborns (age 0):** no skills.
- **Ages 1–6 — milestone system:** a small data-declared ladder (in `skills.json` metadata or a compact config
  section) granting age-appropriate foundational skills — `speaking`, `physical_coordination`, reading
  readiness (a low `reading` floor), basic social capabilities where they exist in the data. Explicitly **not**
  all basics, and no full preschool simulation. Two entry paths, same table: (a) initialization at age N seeds
  all milestones ≤ N; (b) **live progression** — a birthday-cadence check (day cadence, deterministic,
  RNG-free or salted per person) grants the next milestone as simulated children age. Both modes share the code.
- **Ages 7–17:** school-derived proficiency using [063](063-school-day-skill-progression.md)'s exact math:
  proficiency = `schoolDailyGain(person) × eligibleWeekdaysSince7thBirthday`, i.e. **synthesized full
  attendance** — but *only* for people initialized at that age without a simulated history. A person who
  actually lived through simulation (bootstrap/055, or born in live play) earns theirs through 063 and is never
  topped up or normalized. Document this "synthesized vs. lived" boundary prominently — it disappears once 055
  makes everyone lived-through.
- **Adults (18+):** every basic skill at **60.0** (provenance `initialization`), plus an assortment of specific
  skills at varied levels, biased deterministically by: age (older ⇒ deeper/more), current job if any
  (job-relevant specifics — note: pool adults are jobless at materialization, so this mostly applies to
  migration/asset paths), household/context where cheap, and the seed for variety. **No arbitrary unexplained
  advanced skills** — assortment draws from skills tagged for initialization variety (061's flavor-pool tag)
  and job-adjacent sets, respecting the dependency DAG (grant closures, never orphaned dependents). Document
  the future differentiation vision (musician 80/95, per 059's doc requirement) where the assortment bands are
  defined.
- Retire `util/skills.ts` + the weights config; remove the `City.ts` `assignSkills` call sites in favor of the
  initializer; delete the obsolete validators (the 059 manifest validator supersedes them).
- Newborn/birth path (`City` birth materialization) initializes-to-empty (explicit, tested).

## Non-goals

School/work progression *rates* (063/065). Rank logic (064). Personality/talent stats. Retroactive
re-initialization of already-initialized people (migration from v8 saves is 059/061's mapping, not this).

## Testing

- Age bands: 0 ⇒ none; 3 ⇒ partial milestone set only (never all basics); 12 ⇒ basics at exactly
  `gain × eligible weekdays since 7th birthday`; 40 ⇒ all basics at 60.0 + assortment.
- Milestone live progression: a simulated child crossing a birthday gains exactly the next milestone once.
- Dependency integrity: no initialized person violates the DAG (property test over many seeds).
- Determinism: same (seed, personId, age) ⇒ identical records; independent of materialization order; identical
  across live/bootstrap entry paths.
- Idempotence: re-entry (despawn/rematerialize, save/load) never re-runs initialization.
