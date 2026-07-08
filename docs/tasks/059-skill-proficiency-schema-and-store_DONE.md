# [Framework] Skill rework — proficiency schema, dependency graph & central store

- **Type:** Framework / Simulation
- **Labels:** `skills`, `data-schema`, `save`, `progression-arc`
- **Depends on:** [056](056-progression-arc-discovery-baseline_DONE.md) (decisions b/c)
- **Blocks:** [060](060-basic-skills-backfill_DONE.md), [061](061-specific-skills-backfill-and-migration_DONE.md), [062](062-skill-initialization-and-early-childhood_DONE.md), [063](063-school-day-skill-progression_DONE.md), [064](064-job-ranks-and-training-grants_DONE.md)
- **Bundling (ratified 056 decision c):** **059+060+061+062 land as ONE branch/PR** — the skill model is
  replaced atomically (schema + store + data + reference remaps + initialization); `main` only ever sees the
  completed bundle, so no transitional legacy entries are needed.

## Goal

Replace string-only skills with **proficiency-bearing skill records** (0.0–100.0 float) held in a central,
personId-keyed **skill store**, backed by a new `skills.json` manifest with an NPM-style **dependency DAG**
(flat in the file, compiled into a graph — the `EventCompiler` pattern). This is the framework; data backfill
follows in 060/061.

## Background (verified)

Today skills are the 16-member `JobRequirements` enum (`types/Work.ts`), stored boolean on
`WorkLife.skills`, serialized as `PersonSnapshot.skills` (v8). `json/skills.json` is an assignment-weights
config for `util/skills.ts` `assignSkills`. Consumers: `JobMarket` (boolean set-cover), `SkillRegistry`
(`acquireSkill` effect → `addSkill`), HUD `PersonDetails` (joined string list). The events validator
cross-checks `acquireSkill` values against skills.json weights. **Nothing reads a level anywhere.**

Proficiency **grows over time**, so unlike today's derived-at-materialization skills it must be **stored** —
and to run identically off-map (bootstrap / 055 asset) it must not live on the materialized `Person`. Follow the
`Inventory`/`LifeLog` precedent: a central store keyed by pool `personId`.

## Requirements

### Manifest — new `json/skills.json` schema

- `Record<skillId, SkillDefinition>`: `{ label, basic?: boolean, dependencies?: [{ skill, minProficiency }],
  tags?: string[], metadata? }`. Skill IDs are snake_case **specific abilities** (`suture_wounds`), not fields
  of study — except `basic: true` skills, which may use field-of-study names (`biology`).
- **Load-time compiler** (pure, `util/` or `game/` mirroring `compileEvents`): builds the dependency **DAG**
  (multiple prerequisites allowed — a DAG, not a tree), topo order, and validation warnings.
- **Validator** (039 registry, replacing the current weights validators) rejects: missing dependency refs,
  **cycles**, duplicate IDs, thresholds outside `(0, 100]`, names ending in `Skill` (regex), `basic` skills
  with dependencies, and — via a curated field-of-study denylist (`engineering`, `medicine`, `finance`, …) —
  non-basic skills named after broad fields. Also: dependency chains whose thresholds are unsatisfiable
  (a dependency `minProficiency` above any declared grant/progression path is flagged; the full
  reachability rule tightens in [066](066-jobs-ranks-data-backfill.md)). Invalid fixtures in
  `test/dataValidation.test.ts`; wired into `npm run validate-data`/CI/boot assert.
- **No transitional entries** (056 decision c): the bundle ships the new manifest already populated by
  060/061 — legacy skill IDs never appear in the new schema. The naming rules are unconditional from the
  start; `jobs.json`/`events.json` are remapped within the same bundle (061).

### Person skill records — the store

- Record shape: `{ skillId, proficiency (0 < p ≤ 100), firstAcquiredTick, lastProgressedTick,
  provenance: SkillProvenance[] }` where provenance entries are typed
  (`school | job:<jobId> | trainingGrant:<jobId> | event:<eventId> | action:<actionId> | initialization`) —
  enough to explain *why* a person has a skill (e.g. `suture_wounds` from an entry grant, then progressed at a
  clinic). **Zero-proficiency records are never stored** — a skill is acquired the first time it gains positive
  proficiency.
- A central `Skills` store (name it consistently with `Inventory`; e.g. `game/SkillBook.ts`), keyed by pool
  `personId`, scene-free, serializable. Core API: `get(personId, skillId)`, `proficiency(personId, skillId)`
  (0 when absent), `meets(personId, requirements: [{skill, minProficiency}])`,
  `grant(personId, skillId, { toAtLeast | add }, tick, provenance)` — **clamped at 100** (no overflow), and
  **dependency-gated**: no gain unless the skill's declared dependencies are already met. The one exception:
  `grantClosure(personId, grants[], tick, provenance)` — an atomic training-grant that validates the full
  dependency closure of the whole grant set **before** committing anything (two-phase, zero partial
  application) — the primitive [064](064-job-ranks-and-training-grants_DONE.md) consumes.
- Document (in the store's header + `CLAUDE.md` when this lands): the long-term proficiency vision — e.g. a
  working musician needs ~80 `music`, a famous one ~95 — so 60.0 (school cap) is "educated baseline," and the
  30–100 band above it is career/talent territory future systems will differentiate.

### Rewiring consumers

- `WorkLife.skills` retired as storage; keep a thin delegating API (`hasSkill(skillId, min?)`) or update the
  call sites (`JobMarket`, HUD) to read the store. `SkillRegistry` (the `acquireSkill` adapter) rewires to the
  store; the `acquireSkill` **effect** gains an optional proficiency value with *grant-to-at-least* semantics
  (default keeps a sensible floor so existing manifest entries stay valid).
- `JobMarket.bestFit` reads `meets(...)` (still boolean at this stage — proficiency *thresholds* arrive with
  ranks in 064; this task only swaps the data source). Determinism unchanged (no RNG).
- HUD `PersonDetails`: skills render with proficiency (value or bar) and acquisition provenance on hover/title.
- Save: new optional `WorldSnapshot.skills` section (store state); `SAVE_VERSION` → 9 with a migration that
  converts each person's legacy `PersonSnapshot.skills` array into store records via **061's legacy→specific
  mapping table** (documented default proficiencies, provenance `initialization`); `PersonSnapshot.skills`
  dropped from new saves.
- `util/skills.ts` `assignSkills` and its weights config are retired within the bundle by
  [062](062-skill-initialization-and-early-childhood_DONE.md)'s initializer — materialization never runs against a
  half-migrated skill model.

## Non-goals

Skill data backfill (060/061). Initialization/seeding logic (062). Progression rates (063/065). Rank
requirements (064). Action selection modifiers reading skills (future; the store API should not preclude it).

## Testing

- Compiler: cycle/missing-ref/duplicate/threshold/naming rejections (fixtures); DAG with multi-prerequisite
  skills topo-sorts deterministically.
- Store: acquire-on-first-gain (no 0.0 records), clamp at 100, dependency gating blocks ungated gains,
  `grantClosure` atomicity (one unsatisfiable grant ⇒ zero mutations, typed failure), provenance recorded,
  round-trip through save/load, migration from a v8 snapshot yields equivalent boolean-skill behavior.
- `JobMarket` behavior unchanged against legacy entries (regression on `test/hiringEvents.test.ts` etc.).
- Determinism: store operations are RNG-free; existing event/bootstrap determinism suites stay green.
