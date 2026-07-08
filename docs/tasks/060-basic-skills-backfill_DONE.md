# [Content] Basic skills — definition & backfill

- **Type:** Content / Data
- **Labels:** `skills`, `content`, `progression-arc`
- **Depends on:** [059](059-skill-proficiency-schema-and-store_DONE.md) (schema)
- **Blocks:** [061](061-specific-skills-backfill-and-migration_DONE.md) (specific skills depend on basics), [063](063-school-day-skill-progression.md) (school awards basics)
- **Bundling (ratified 056 decision c):** lands in the single **059+060+061+062** branch/PR.

## Goal

Author the **basic school skills** — the foundational, broadly-taught capabilities school teaches everyone.
Basic skills are the **only** skills allowed to carry field-of-study names, and they have **no prerequisites**.

## Requirements

- At least **15** basic skills (`basic: true`, no `dependencies`). Required minimum set (from the vision doc):
  `math`, `reading`, `writing`, `speaking`, `biology`, `geography`, `history`, `physics`, `chemistry`,
  `digital_literacy`, `problem_solving`, `physical_coordination`, `music` — plus at least two more to reach 15;
  suggested: `art` and `civics` (both broadly taught foundations). "Basic" must stay **intentional**: a
  foundational capability taught to everyone, never a convenience bucket for unrelated skills — write that
  guardrail into the file header comment/README of the schema.
- Each basic skill carries useful `metadata`/`tags` for downstream consumption (e.g. which specific-skill
  families typically build on it, HUD grouping) — kept light; the consumers are 061 dependencies, 066 rank
  requirements, and future action selection modifiers.
- Validator confirmations (should already hold via 059; add fixtures if not): only `basic: true` entries pass
  the field-of-study naming check; basics with dependencies are rejected.
- Cross-check the school progression contract early: [063](063-school-day-skill-progression.md) awards **every
  basic skill** once per completed school day — so the basic set is exactly "what school teaches." Keep the
  list sized accordingly (each addition dilutes nothing — the daily gain is per-skill — but each must be
  plausible as a school subject/capability).
- Update `docs/simulation-relationships.md` generation inputs if the 054 doc generator grows a skills section
  (optional here; required by [075](075-progression-arc-validation-and-docs.md)).

## Non-goals

Specific (non-basic) skills and the legacy-family replacement (061). Progression rates (063). Any change to
jobs/events references (061 handles the remap).

## Testing

- `npm run validate-data` green with the new entries; fixtures for an invalid basic (has dependencies) and an
  invalid non-basic (field-of-study name without `basic: true`).
- A data test asserting the required-minimum basic set is present and `basic`-flagged (the 063 contract).
