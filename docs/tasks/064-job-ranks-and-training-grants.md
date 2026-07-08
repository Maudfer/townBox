# [Framework] Job ranks & entry-level training grants

- **Type:** Framework / Simulation
- **Labels:** `jobs`, `skills`, `hiring`, `save`, `progression-arc`
- **Depends on:** [059](059-skill-proficiency-schema-and-store_DONE.md) (`grantClosure`), [061](061-specific-skills-backfill-and-migration_DONE.md) (specific skills)
- **Blocks:** [065](065-job-skill-progression-and-promotion.md), [066](066-jobs-ranks-data-backfill.md)

## Goal

Jobs gain **ranks** with per-skill proficiency requirements, and hiring gains the **entry-level
training-grant shortcut** — the explicit, temporary stand-in for College that closes the arc's central loop:
*a fresh 18-year-old with only school basics can still be hired into any profession's entry rank* (otherwise
skilled jobs would be permanently unfillable and the economy starves). This task is the framework; 066
backfills the data.

## Background (verified)

No rank concept exists anywhere (056). A person's job is a `JobPosition` copy on `WorkLife` (serialized);
`JobMarket.bestFit` is boolean skill set-cover; `canBeHired` (= `bestMatch !== null`) is the eligibility gate
the `get_job` event rolls against, and a failed `acquireSlot` aborts the event — so **grants keyed to
successful hire are structurally farm-proof**: there is no "apply" action to spam, and `get_job` only commits
when a real hire happens.

## Requirements

### Schema — ranks in `json/jobs.json`

- Per job, a `ranks` array: `{ rankId, label, entry?: boolean, requires: [{ skill, minProficiency }],
  progresses: [{ skill, multiplier }] (065 consumes), workActions?/actionWeights? (rank-specific overrides for
  the Job Orchestrator; optional), entryTrainingGrant?: { grants: [{ skill, toProficiency }] } (entry rank
  only), promotion?: { evaluateEveryWorkDays?, minWorkDaysInRank? } (065 consumes) }`.
- Validator (extends the jobs validator): **exactly one `entry: true` rank per job**; all skill refs exist;
  thresholds in `(0, 100]`; `entryTrainingGrant` only on the entry rank; grant closure **dependency-complete**
  (every dependency of a granted skill is either a basic with threshold ≤ 60 — the school baseline — or itself
  in the grant); ranks orderable (declaration order = progression order; document). The keystone closed-loop
  rule: **every entry rank must be satisfiable by a person with all basics at 60 plus its own grant closure** —
  a data test computes this, so no profession is unreachable at 18 (this is the College-gap guard; enforce in
  CI from this task on, exercised fully by 066's data).

### Person-side state

- The job assignment stores `rankId` plus the counters 065 needs (`workDaysInRank`, `totalWorkDays`) —
  extending the serialized `JobPosition`/`WorkInfo` shape; `SAVE_VERSION` bump with a migration defaulting
  existing employees to their job's entry rank, counters 0. On layoff/quit the rank is not retained across
  employers: a re-hire re-qualifies through the normal paths (skills persist, so a seasoned worker typically
  strict-qualifies into a higher rank — document this as the intended "experience carries, title doesn't").

### Hiring — `JobMarket` rework

- Two-path evaluation per open position, in order: **(1) strict** — the highest rank whose `requires` the
  candidate `meets(...)` (proficiency-aware now); **(2) training shortcut** — if no rank matches, the entry
  rank *if* it declares `entryTrainingGrant` (or has no non-basic requirements) and the candidate satisfies
  everything the grant doesn't cover. The shortcut can only ever place someone into the **entry** rank.
- `canBeHired` reflects both paths (this is what re-opens `get_job` for fresh graduates). Scoring stays
  deterministic (`SKILL_WEIGHT × fit − distance`; define fit for proficiency, e.g. matched-rank index +
  requirement margin; tie-break rules unchanged, no RNG).
- The grant applies **only inside a successful hire** (the `acquireSlot` effect path → `JobMarket.hire`):
  `SkillBook.grantClosure` with provenance `trainingGrant:<jobId>`, atomically, **then re-validate** the full
  dependency graph + the entry rank's requirements before the hire commits — a validation failure aborts the
  hire (typed, zero mutations) and the event aborts as today. Repeated failed matching attempts grant nothing
  (nothing to farm — assert with a test).
- Document — in the schema (file header), the code, and `CLAUDE.md` — that `entryTrainingGrant` is the
  **temporary College/licensing shortcut**, to be superseded by a real education/certification/apprenticeship
  system; keep it an explicit named mechanism, never folded silently into generic matching.

### Consumption wiring (interfaces only; 065 implements behavior)

- `jobOf`/`JobFacts` (City → Brain/JobOrchestrator) carries the current rank and its declarations, so the
  orchestrator and progression can consume ranks without re-reading `jobs.json` per person.

## Non-goals

Promotion evaluation & work-day progression (065). Rank data backfill (066). Per-rank salary, performance
reviews, manager approval (explicit vision non-goals — note per-rank salary as a natural follow-up). School
(058). Demotion.

## Testing

- Validator: exactly-one-entry-rank, grant-closure completeness, the basics≤60+grant reachability rule —
  invalid fixtures for each.
- Strict path: an already-qualified candidate lands the highest rank they meet, not entry.
- Shortcut path: a basics-at-60 18-year-old is hired into a granting entry rank; the grant lands exactly the
  declared skills at the declared values with correct provenance; dependency revalidation passes.
- Farm-proofing: candidates evaluated-but-not-hired N times gain zero proficiency.
- Abort path: an unsatisfiable grant closure (fixture) ⇒ typed hire failure, event aborts, zero skill/state
  mutations.
- Save migration: v9→v10 (or as numbered) defaults existing employees to entry rank; round-trip.
- Determinism: same pool + seed ⇒ identical hires/ranks across runs and across live/bootstrap.
