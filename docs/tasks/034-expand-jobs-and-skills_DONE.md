# [Feature] Expand jobs & skills reference tables

- **Type:** Feature / Content + small code
- **Labels:** `feature`, `data`, `jobs`, `content`, `framework-followup`
- **Depends on:** 013b (jobs table), 014 (skills model). Pairs with 033 (businesses).
- **Status:** ✅ **Done** (bundled with 033b). `JobRequirements` grew from 8 → **16** skills (Hospitality,
  Finance, Engineering, Security, Driving, Beauty, Mechanical, Fitness); `json/jobs.json` from 10 → **33** jobs
  with populated strain/admiration and a realistic salary spread; `json/skills.json` weights cover all 16 so no
  job is unfillable. A `test/contentConsistency.test.ts` cross-check enforces: every job's skills are valid
  enum values, every required skill is assignable, every blueprint job/category/material resolves, and every
  demand category is served. Strain/admiration are populated as the bridge for 032's event gradients.

## Summary

Expand `json/jobs.json` with many more **jobs**, and the skill vocabulary with more **skills**, so the
businesses (033) have a rich roster to staff and people (014) have meaningful specialisations. Jobs are pure
data; adding skill *identifiers* is a small enum change (`JobRequirements`).

## Background / current state (verified)

- `json/jobs.json` has 10 jobs; each: `title`, `salary`, `requiredSkills: string[]`, and design-for
  `physicalStrain`/`mentalStrain`/`socialAdmiration`. `BusinessGen.toJobPosition` maps `requiredSkills` →
  `JobRequirements[]` (cast), so **skill strings in JSON must match the enum values**.
- `JobRequirements` (`src/types/Work.ts`) has 8 skills today. Adding skills = adding enum members (small code
  change), then referencing them in jobs.
- The design-for strain/admiration fields are consumed by Engine B gradients later (032) — populate them
  meaningfully now so events can read them.
- Salaries feed payroll (018) and business P&L (020).

## Goals / Requirements

1. **Add skills** to `JobRequirements` to cover the new jobs (e.g. Finance, Engineering, Hospitality, Security,
   Driving, Science, Arts, Childcare, …). Keep them simple strings; update 014's assignment weights so people
   can actually have them.
2. **Add many jobs** spanning the new businesses (033): per job set `title`, `salary`, `requiredSkills`, and
   the design-for attributes. Make salaries span a realistic range (entry-level to specialist) so the economy
   has structure.
3. **Populate strain/admiration** so 032's events can use them as gradients (e.g. high `physicalStrain` raises
   `injury` probability; high `socialAdmiration` nudges `marriage`).
4. **Keep references consistent.** Every `requiredSkill` must be a real `JobRequirements` value; every job
   referenced by a blueprint (033) must exist here. Add/extend a validation test (jobs↔skills↔businesses
   cross-check).
5. **Avoid unfillable jobs.** Don't require a skill the population can never have (coordinate with 014's
   assignment + 032's education events that grant skills).

## Out of scope

- The hiring algorithm (015) and the economy (018/020) — this task is the reference data they consume.
- Materials/products (035).

## Acceptance criteria

- `jobs.json` and the skill enum are substantially expanded and internally consistent with businesses (033)
  and the people skill model (014).
- A validation test confirms every job's skills exist and every blueprint job is defined; no unfillable jobs.
- `npm test` passes.

## Notes

- Strain/admiration are the bridge from the work table into the event gradients — populating them now makes
  jobs *matter* to people's life events, not just their wallets.
