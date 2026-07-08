# [Content] Jobs backfill — ranks, skill requirements & progression declarations

- **Type:** Content / Data
- **Labels:** `jobs`, `skills`, `content`, `progression-arc`
- **Depends on:** [064](064-job-ranks-and-training-grants.md) (schema), [065](065-job-skill-progression-and-promotion.md) (consumption), [061](061-specific-skills-backfill-and-migration.md) (the skill vocabulary)

## Goal

Every existing job (33 in `json/jobs.json`) gets a real rank ladder: entry + higher ranks, specific-skill
requirements per rank, progression declarations, and entry training grants wherever entry requires non-basic
skills — replacing the flat one-legacy-skill `requiredSkills` model end to end.

## Requirements

- **Every job:** 2–4 ranks (exactly one `entry: true`); simple jobs may have exactly two (e.g. janitor →
  senior janitor); deep professions more (e.g. doctor: resident → attending → senior physician). Declaration
  order = progression order.
- **Requirements:** per rank, a small set of specific skills with minimum proficiencies that tell a coherent
  story — entry ranks in the low tens (the vision's entry-doctor example: `suture_wounds`,
  `take_patient_history`, `use_sterile_equipment` in the tens); higher ranks demand more skills at higher
  values, roughly aligned with what its own progression can deliver in plausible time
  (`N workdays × 100/3650 × multiplier` — sanity-check each ladder's timeline; a next rank requiring 90 in a
  0.25-multiplier secondary is a 100-year trap, the 059/064 validators should flag unreachable steps).
- **Progression:** per rank, `progresses` primaries (×1.0) + secondaries (×0.25 or similar) — primaries are
  the rank's core craft; secondaries adjacent abilities. Every rank must progress at least the skills its next
  rank requires (the ladder must be self-climbing — add this as a data test: for each non-entry rank, each
  required skill is progressed by some earlier rank in the ladder or is a school basic).
- **Entry training grants:** wherever an entry rank requires non-basic skills, declare `entryTrainingGrant`
  covering exactly those minimums (+ dependency closure per the 064 validator). Jobs whose entry needs only
  basics (laborer, janitor…) need no grant — keep several such jobs so the no-grant hiring path stays exercised.
- **Rank-appropriate actions** where meaningful: use 064's per-rank `workActions`/`actionWeights` overrides on
  a few flagship jobs (e.g. a resident does more `reviewing_charts`, a senior physician more
  `treating_patients`) — enough to prove consumption; not every job needs overrides.
- **The 18-year-old rule holds for the whole roster** (064's CI data test): every job's entry rank is
  reachable by a fresh graduate with basics at 60 + the grant. Also verify the *strict* path exists somewhere:
  at least some higher ranks are strictly reachable by long-tenured workers (the 065 timeline check).
- Remove the flat `requiredSkills` field once every job has ranks (or keep it derived/absent per 064's final
  schema decision) — no dual-source-of-truth left behind.
- Update `docs/simulation-relationships.md` (`npm run docs:sim`) in the same PR if the generator covers
  jobs/skills by then ([075](075-progression-arc-validation-and-docs.md) extends it otherwise).

## Non-goals

New jobs or businesses. Salary ladders (noted follow-up). Schema changes (064 owns the schema — push needed
changes back there, don't fork the shape in data).

## Testing

- `npm run validate-data` green across the full backfill; the reachability, self-climbing-ladder, and
  exactly-one-entry rules pass for all 33 jobs.
- Closed-loop scenario test: a seeded town where a fresh 18-year-old is hired (grant path) into a skilled
  profession, works, and is eventually promoted — end to end on real data.
- Hiring regression suite green (`test/hiringEvents.test.ts`, economy tests) — the economy still staffs itself
  on the new requirements.
