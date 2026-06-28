# [Feature] Expand business blueprints (lines of work)

- **Type:** Feature / Content
- **Labels:** `feature`, `data`, `business`, `content`, `framework-followup`
- **Depends on:** 013b (Engine A). Richer with 034 (jobs/skills) and 035 (materials/products).

## Summary

Greatly expand `json/businesses.json` with many more **lines of work**, so a city has real variety (retail,
food, healthcare, education, civic, industrial, leisure, services, …). This is pure data on Engine A — no code
changes — but it's the content that makes the employment and economy systems feel like a real economy.

## Background / current state (verified)

- `json/businesses.json` has 5 blueprints (supermarket, hospital, school, restaurant, construction_site).
  Each declares `friendlyName`, `size {min,max}`, `jobs` (per-job `count` `Curve` over size),
  `materialsPerMonth`, `products` (empty), and `economics` (`priceMarkup`, `fixedCostsPerMonth`).
- `game/BusinessGen.ts` `generateBusiness` expands these purely; `City.setupBusiness` picks one uniformly per
  work building (seeded by world seed ^ anchor). Blueprints reference jobs in `json/jobs.json`.
- The substrate `Curve` modes (`const/linear/sqrt/log/logistic/step`) shape how each job scales with size.

## Goals / Requirements

1. **Add many blueprints** across categories — e.g. bakery, café, pharmacy, clinic, university, bank, office,
   factory, warehouse, gym, cinema, hardware store, clothing store, police/fire/civic, hotel, etc. Each with a
   believable job mix and size range.
2. **Use varied curve shapes** so different lines scale differently (a factory's line workers scale ~linearly
   and high; a bank's tellers logistically; a clinic's doctors slowly). Demonstrate the curve language's
   range.
3. **Reference only defined jobs/skills.** Every job a blueprint names must exist in `json/jobs.json` (034) and
   require only skills people can have (014). Keep the two files in lockstep.
4. **Set economics plausibly** (priceMarkup, fixed costs) so the economy (020/021) produces a mix of thriving
   and struggling businesses — not all-profit or all-bankrupt. This is tuning, not code.
5. **Consider weighting which blueprints appear.** `City.setupBusiness` currently picks uniformly; optionally
   add per-blueprint spawn weights (small code change) or a city-needs bias so the mix is realistic — decide
   and note (could be a tiny follow-up rather than this task).
6. **Validation.** Add a test that every blueprint's jobs resolve in `jobs.json` and generate sane position
   counts across the size range (no zero-staff or absurd-staff businesses).

## Out of scope

- Products/supply chains (035) — `products` can stay empty or be filled in 035.
- The economy math (020) — this task only supplies blueprint data + economics knobs.

## Acceptance criteria

- `businesses.json` has a substantially larger, varied, internally-consistent set of blueprints; all
  referenced jobs/skills exist; generation produces sane staffing across sizes.
- `npm test` passes with the cross-reference/staffing validation test.

## Notes

- Pure-data expansion is the framework's whole point — adding a line of work should never need code. Keep the
  job/skill/material references consistent with 034/035 to avoid compiler/validation warnings.
