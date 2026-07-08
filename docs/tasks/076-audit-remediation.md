# [Audit] Consumption & closed-loop remediation (pre-055 hardening)

- **Type:** Audit / Remediation (multi-strand)
- **Labels:** `audit`, `simulation`, `framework`, `content-wiring`, `pre-055`
- **Branch:** `task/076-audit-remediation`
- **Depends on:** the whole 039–054 enrichment arc and 056–075 progression arc (this task hardens their
  wiring). Precedes **[055](055-history-asset-pipeline.md)** — the offline asset must not freeze dead content
  or a half-wired bootstrap.

## Why this exists

An architectural audit (session 2026-07-08) judged the enrichment + progression arcs. The *architecture* is
sound (execution boundary, shared `TickRunner`, determinism, data-schema registry are real and well-built).
The problem is **consumption**: a large fraction of authored content is generated-but-consumed-by-nothing, the
bootstrap path runs only a slice of the sim it claims to capture, and one live-mode path is outright broken.

**Maintainer directive (ratified):** *do not prune content.* Every finding that surfaces dead data must be
resolved by **wiring the content into the simulation** — creating counterparts/consumers where needed. By the
end of this task, everything authored is consumed.

This file captures every finding. Each strand is independently mergeable; commit per strand. Tackle in the
order below (tractability + value).

---

## Findings & remediation

### H1 — Building objects are never generated at placement (LIVE BUG)  ✅ tractable now

**Evidence.** `generateBuildingObjects` has two call sites, both in the SaveManager load sweep
(`save/SaveManager.ts:341,349`). Neither `City.setupHousehold` (`City.ts:246`) nor
`City.setupBusiness`/`openBusiness` (`City.ts:342`) calls it; teardown resets the flag (`City.ts:833`) but
re-occupancy never regenerates. So in a fresh session (new game, no save/load) houses and businesses contain
**zero objects**, and the entire 069–071 object-in-context layer (cooking needs a stove at location, showering
a bathroom fixture, pocketing, the 044/053 repertoire) is silently unreachable until a save/load round-trip
fires the sweep. `contextReachability.test.ts` proves objects are reachable *in principle*, so this slipped past
tests.

**Remediation.** Generate objects at placement:
- `City.setupHousehold` fills the house (HOUSE_PLACEMENT_TAGS, host `house`) once, marking `setObjectsGenerated`.
- `City.setupBusiness`/`openBusiness` fills the business (blueprint tags, host `business`, correct
  `generationIndex`) once. Re-occupancy (`openBusiness` generation ≥ 1) fills fresh.
- Newborn materialization / re-occupancy paths stay symmetric with teardown.
- The SaveManager load sweep stays as the migration path for old saves (idempotent via the flag).
- **Test:** a freshly placed house/business (no save/load) has objects; deterministic per seed+anchor; teardown
  clears; re-occupancy refills. Add a live-placement assertion so this can't regress.

### H2 — The bootstrap path runs ~half the sim it must capture  (scope honestly; do the tractable wiring)

**Evidence.** `City.handleTick` builds a rich `TickPlan` (markets, `inventory`, `jobOf`, `schoolOf`,
`skillProgression`, `jobAssignmentOf`, `onCommitted`); `HistoryBootstrap.bootstrapHistory` (`HistoryBootstrap.ts:93`)
passes a thin one and builds `BootstrapWorld` with **null inventory, `register()` never called**. Runs off-map:
pool-intrinsic events only. Does NOT run off-map: work actions & Job Orchestrator (`JobOrchestrator.ts:32`
returns `[]` with no `jobOf`), hiring (no `jobMarket`), school (no `schoolOf`; enrollment sweep is
`handleNewDay`-only), skill progression (`TickRunner.ts:87` guards on `plan.skillProgression`), object
generation (no off-map buildings), social co-location (`register()` never called → `peopleAt` empty), the entire
economy (`processMonthlyEconomy` is `handleNewDay`-only), household dynamics (all in the `onCommitted` callback).

**Remediation.** Most of this is genuinely 055's "logical world" build-out and is scoped there. What this task
does now: make the seams exist and be exercised so 055 is additive, not a rewrite —
- Extract the day-cadence work (`runSchoolSweeps`, `runSkillMilestones`, economy monthly gate) and the
  `onCommitted` reconciliation into mode-agnostic helpers callable from a bootstrap driver, not buried in
  live-only `handleNewDay`.
- Wire `BootstrapWorld.register()` for the agent roster so co-location works off-map (SocialOpportunity).
- Give `BootstrapWorld` a real (logical) inventory so object requirements can pass off-map.
- Leave the full logical economy/jobs/schools world to 055, but document the exact plan-input contract 055 must
  satisfy (the eight absent `TickPlan` fields) in `docs/simulation-flows.md`.
- **Test:** an executionBoundary test asserting that with a fully-populated bootstrap plan, school/skill/social
  systems fire off-map identically to live (extends the 075 equivalence keystone).

> If the logical-world build proves too large to finish here, land the seam extraction + co-location + logical
> inventory, and hand the remaining logical economy/jobs/school world to 055 with the contract documented.

### H3 — Money is not conserved  (design decision + guard)

**Evidence.** Only payroll is a true `transfer`. Consumer revenue is added to businesses (`City.ts:775`) with no
household counter-debit; cost-of-living is a decoupled flat sink (`City.ts:990`). Starting capital re-mints on
re-occupancy; bankruptcy zeroes negatives. Total money supply drifts monotonically over long horizons.

**Remediation.** Live play is bounded so this is latent, but a 500-year offline economy would drift. Make money
conservation explicit and testable:
- Route consumer spending as a real ledger movement (household → business) so revenue has a matching debit, with
  the abstract off-map supplier portion an explicit, accounted sink (a single named "external sector" balance)
  rather than money vanishing.
- Add an `Economy.totalMoney` invariant test over a simulated span (conserved modulo the explicit external
  sector + seeded injections).
- Document the money-flow model in CLAUDE.md §Money.

### M1 — 199 / 335 skills gate no hire and are progressed by nothing  (WIRE, no prune)

**Evidence.** The 061 backfill created ≥20 specific skills per family; rank ladders consume a handful per
family. Whole families are dead — e.g. all ~20 construction skills (`read_blueprints`, `frame_walls`,
`lay_bricks`, `install_drywall`, `apply_roofing`, `dig_foundations`…) are consumed by nothing (Laborer uses 5;
no other construction job exists). Same for warehouse/logistics, cleaning, hospitality, retail.

**Remediation (wire, don't prune).** Make every non-basic skill consumed by some job rank (required and/or
progressed):
- Expand existing job rank ladders to require/progress more of their family's specific skills across ranks
  (a senior mechanic/nurse/laborer legitimately needs more abilities than an entry one).
- Where a family has no adequate job, add job(s)/ranks (e.g. construction trades beyond generic Laborer:
  Carpenter, Electrician, Roofer as ranks or sibling jobs on the construction_site blueprint) and wire the
  business blueprint to employ them.
- Keep the 18-year-old entry-rank reachability CI rule and the self-climbing rule green.
- **Test:** a CI check "every non-basic skill is required or progressed by at least one job rank" (the inverse
  of the reachability rule). Add it to `jobs.test.ts` / a new skill-consumption test so it can't regress.

### M2 — ~581 objects (38%) can never spawn (deferred-only placement tags)  (WIRE, no prune)

**Evidence.** 581 objects carry only `deferred`-scope placement tags (bar, church, beach, pool, dentist,
bookstore, cemetery…) — venues that don't exist as buildings. Their tags intersect no building tag set; they
aren't OAR outputs or action-referenced. They can never be generated.

**Remediation (wire, don't prune).** Bring the deferred venues into the buildable world so their objects spawn:
- Promote deferred tags to `building` scope by introducing the corresponding **business blueprints** (bar,
  bookstore, church, beach/park, pool, dentist, etc. — reuse the existing blueprint/job/economy machinery) OR
  attach appropriate deferred tags to existing buildings where they plausibly belong.
- Every promoted tag must be used by ≥1 building and every deferred object must become generatable.
- New blueprints need jobs (feeds M1), demand categories, materials, placement tags, and object generation —
  full closed loops, validated.
- Update `placement.json` scopes; keep the placement validator green (no dead tags, no deferred tags on
  buildings unless promoted).
- **Test:** extend the placement/object-generation reachability so **every** object archetype is generatable in
  some building OR is an OAR output OR is action-referenced (zero unreachable archetypes).

### M3 — Generic object verbs are dead  (WIRE, no prune)

**Evidence.** `grab`, `use_object`, `discard_object`, `put_down` (the 068 "Grab X / Use X" centerpiece) are
proposed by no hook and used as a child by no sequence (zero references in actions.json children or in code).
The inventory hook only proposes `pocketed_small_object` (`Brain.ts:346`). Also dead: `shelving_returns` (in no
job repertoire).

**Remediation (wire, don't prune).**
- Extend the inventory-opportunity hook (and/or free-time/sequence authoring) so `grab`/`use_object`/
  `discard_object`/`put_down` are proposed against real objects at the person's location/possessions.
- Bind them as sequence children where natural (e.g. `Writing` → `grab` pencil; home activities → `use_object`).
- Add `shelving_returns` to the relevant job repertoire (retail/warehouse) or reclassify it as a consumed child.
- **Test:** a reachability check "every action is proposable by some hook, a job repertoire, or a sequence/pool
  child" (the inverse of the dead-action scan), in `actionsContent.test.ts`.

### M4 — 152 reserved events; ~50 shadow transitions the sim already computes  (WIRE, no prune)

**Evidence.** `reserved` = manual trigger invoked by nothing. Many are milestone/relationship events for state
changes the sim already performs: `became_homeless`/`was_evicted`/`got_back_on_feet` (eviction system),
`became_widowed`/`lost_spouse`/`lost_parent` (deaths + rehousing), `became_parent`/`gave_birth`/`welcomed_sibling`
(births), `turned_18`/`reached_retirement_age`/`left_home_first_time`/`started_new_job`. Texture events fire
randomly; the person's *actual milestones* never fire — a fidelity loss for the 055 asset whose product is life
stories.

**Remediation (wire, don't prune).** Invoke the computable milestone/relationship events from the systems that
already compute the transition (eviction, rehousing, births, deaths, hiring, retirement, move-out, aging
birthdays) via `EventEngine.invoke` with proper causation. Keep them effect-free (texture-class) unless a real
effect is warranted; wire only the ones whose transition is actually computed — the rest stay documented
reserved. Regenerate `docs/event-classification.md`. **Test:** assert the wired milestones fire in the relevant
City/EventEngine tests (e.g. a birth fires `became_parent`, an eviction fires `became_homeless`).

### M5 — Three materials consumed but never produced  (WIRE, no prune)

**Evidence.** `medical_supplies` (hospital/clinic/pharmacy), `school_supplies` (school), `auto_parts`
(auto-repair) have prices and generate B2B demand (`businessFinance.ts:59`) but no blueprint's `products` list
produces them — dead demand that drains money.

**Remediation (wire, don't prune).** Add these three to producer blueprints' `products` (factory/warehouse, or a
new medical-supply/parts producer if cleaner) so the B2B loop closes. **Test:** extend the economy/business test
to assert every consumed material is produced by ≥1 blueprint (zero unsupplied materials).

### M6 — Businesses only grow or die (no shrink-via-layoffs)

**Evidence.** `runBusinessEconomics` has only grow (`City.ts:800`) and bankrupt (`City.ts:793`). Overstaffed
solvent businesses keep full payroll and bleed; positions never removed. Size ratchets up monotonically.

**Remediation.** Implement graceful downsizing: a sustainedly-unprofitable-but-solvent, over-capacity business
sheds its most-expendable position(s), laying off staff back into the job market (mirror bankruptcy's layoff
path, without closure). Symmetric with growth thresholds. **Test:** an over-staffed loss-making business shrinks
(lays off) before it would otherwise bankrupt; staff re-enter the market.

### M7 — Coarse population sim drops years on large strides

**Evidence.** `simulatePopulation` (`Population.ts:44`) caps catch-up at `maxCatchUpYears` but advances
`lastSimulatedYear` to the full current year — years beyond the cap are never simulated nor revisited.

**Remediation.** Advance the cursor only by the years actually simulated (so the remainder is caught up next
call), or remove the cap for the offline path. **Test:** simulating with a stride > cap loses no
mortality/fertility years vs a per-year loop.

### L1 — Inert / undispatched Brain hooks

`actionCompletedHook`/`actionFailedHook` return `[]`; most `HookKind`s (`onActionStarted/Completed/Interrupted`,
`onShift*`, `onLocationArrived`) are declared but never dispatched by `processTick` (only onTick,
onEventCommitted, decline-path onActionFailed fire). **Remediation.** Either dispatch the declared kinds at their
real lifecycle points (so the API is honest and usable) or trim the union to what's dispatched and document the
extension seam. Prefer dispatching `onActionCompleted`/`onShiftStarted`/`onShiftEnded`/`onLocationArrived` since
downstream logic (next-action selection, arrival) genuinely wants them.

### L2 — Weight-default inconsistency

Free-time defaults missing `selection.weight` to 0 (`Brain.ts:240`); social hook to 1
(`SocialOpportunity.ts:73`). **Remediation.** Pick one convention (recommend: explicit weight required by
validator, or a single shared default constant) and apply everywhere.

### L3 — Homeless recovery gated on a vacant house

`runRecovery` requires a vacant house (`City.ts:1170`); a fully-built city permanently traps homeless
households regardless of funds. **Remediation.** Allow recovery into any house with spare capacity (move in with
a solvent relative/roommate arrangement) or document the trap as intended and surface it in the city dashboard.

### L4 — Cross-fidelity kinship staleness

Off-map spouse death (coarse sim) isn't reconciled onto a materialized partner's marital status; only
materialized deaths flow through `reconcileDeaths`. **Remediation.** On materialization / on coarse-sim death,
reconcile a materialized partner's marital state against the pool.

---

## Global acceptance criteria

- **No content pruned.** Every skill, object, action, and (computable) event authored is consumed by the
  simulation at task end.
- New CI-enforced reachability inverses land and stay green: every non-basic skill consumed by a job rank
  (M1); every object generatable/creatable/referenced (M2); every action proposable (M3); every consumed
  material produced (M5).
- H1 fixed (objects at placement, live). H3 money-flow model explicit + invariant test. M6 shrink implemented.
  M7 no dropped years. L1–L4 addressed or explicitly documented.
- H2: the mode-agnostic seams + co-location + logical inventory land; the remaining logical world is documented
  as 055's contract.
- `npm test`, `npm run typecheck`, `npm run validate-data`, `npm run docs:*` all green. CLAUDE.md updated per
  strand.
- Determinism preserved throughout (seeded, live↔bootstrap equivalence intact).

## Sequencing

H1 → M4 → M5 → M3 → M1 → M2 → M6 → M7 → H3 → L1–L4 → H2 (seams). Commit per strand. Update the tasks README and
CLAUDE.md as strands land.
