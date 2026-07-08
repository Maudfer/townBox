# [Content] Specific skills — replace the generic skill families & migrate all references

- **Type:** Content / Migration
- **Labels:** `skills`, `content`, `migration`, `progression-arc`
- **Depends on:** [059](059-skill-proficiency-schema-and-store_DONE.md), [060](060-basic-skills-backfill_DONE.md)
- **Blocks:** [066](066-jobs-ranks-data-backfill_DONE.md) (rank requirements use these skills)
- **Bundling (ratified 056 decision c):** lands in the **single 059+060+061+062 branch/PR** — after the
  remap, hiring depends on people actually *having* the new specific skills; 062 provides them in the same
  bundle, so `main` never sees a half-migrated skill model.

## Goal

Break every one of the 16 legacy generic skill families (`MedicalSkill`, `EngineeringSkill`, …) into **at least
20 specific ability-based skills each**, with dependencies on basics and on other specifics; migrate every
reference (jobs, events, save migration mapping); remove the `legacy` flag and its validator exemption so no
generic legacy skill survives anywhere.

## Background (verified)

The 16 legacy IDs and their reference sites (056 inventory): `json/jobs.json` `requiredSkills` (every job
references exactly one), `json/events.json` `acquireSkill` effects (`trade_school`→`MechanicalSkill`,
`nursing_school`→`MedicalSkill`), the 059 transitional `legacy: true` manifest entries, and v≤8 save snapshots
(handled by 059's migration — this task supplies the **legacy→specific mapping** that migration and any
lingering references resolve through).

## Requirements

- **≥ 20 specific skills per legacy family** (≥ 320 total), each named for a concrete ability (the vision doc's
  engineering example — `read_technical_drawings`, `weld_metal`, `use_cad_software`, … — is the register to
  hit; medical: `take_patient_history`, `measure_vital_signs`, `suture_wounds`, `use_sterile_equipment`, …).
  Dependencies: on basics (e.g. `suture_wounds` ← `biology` + `physical_coordination` +
  `use_sterile_equipment`) and on other specifics where natural. Keep thresholds inside the reachable band
  (school caps basics at 60; entry grants top out at rank minimums — a dependency demanding `biology ≥ 90`
  would be unsatisfiable; the 059 validator flags these).
- **Migration mapping** (`legacy skill → replacement rule`), checked in as data the code consumes (save
  migration + any transitional lookup): each legacy family maps to a small representative set of its specifics
  at a stated proficiency, so a migrated v8 person with `MedicalSkill` becomes plausibly medical.
- **Remap `jobs.json`:** each job's `requiredSkills` moves from its one legacy family to a small set of
  specific skills appropriate to the job (this keeps flat hiring working until ranks land in 064/066 —
  `JobMarket.bestFit` still does boolean `meets`). Every specific skill referenced must exist.
- **Remap `events.json`:** `trade_school`/`nursing_school` `acquireSkill` effects grant appropriate specific
  skill(s) (with 059's grant-to-at-least semantics); the events validator's cross-check follows the new
  manifest shape.
- **No interim mechanisms** (056 decision c): `util/skills.ts` and its weights are retired by 062 inside the
  same bundle; no legacy entries ever enter the new manifest, and the naming rules are unconditional from the
  first commit of the bundle.
- **No dead skills:** add a semantic validator rule (or data test) that every non-basic skill is *consumed* —
  referenced by at least one of: a job requirement (066 tightens to ranks), an event/action grant, a dependency
  of a consumed skill, or explicitly tagged as flavor-pool for initialization variety (062). Silent orphan
  skills are exactly the "generated but consumed by nothing" failure this arc guards against.

## Non-goals

Rank definitions (064/066). Initialization logic (062) — only the interim weights remap here. New basic skills
(060).

## Testing

- Validator green post-remap: no `Skill`-suffix names, no field-of-study non-basics, DAG acyclic, all deps
  resolve, thresholds reachable; invalid fixtures for the new rules.
- Migration test: a v8 snapshot with legacy skills loads into specific-skill records per the mapping.
- Hiring regression: with 062's initializer + remapped `requiredSkills`, people still get hired
  (`test/hiringEvents.test.ts` adjusted, closed loop intact).
- Orphan-skill rule trips on a deliberately unreferenced fixture skill.
