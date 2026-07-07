# Task backlog

Each file in this folder is a **well-defined, self-contained piece of work that is safe to merge to
`main` on its own**, written JIRA-ticket style. See [`CLAUDE.md`](../../CLAUDE.md) §5 for the full
working agreements.

**Before starting any task:** pull `main`, create a branch, and do a fresh **exploration pass** to
verify the task's claims against current code. Decide if multi-phase planning is needed and, if so,
present a proposal before executing. **Finish with a Pull Request — never merge directly to `main`.
Always run `npm test` before opening the PR.**

## Tasks

| # | Task | Type | Status |
|---|------|------|--------|
| 001 | [Upgrade Phaser 3 → 4](001-upgrade-phaser-4_DONE.md) | Maintenance | ✅ Done |
| 002 | [Subdivide each tile into 3×3 sub-tiles](002-tile-placement-granularity-3x3_DONE.md) | Feature | ✅ Done |
| 003 | [Save & load system](003-save-load-system_DONE.md) | Feature | ✅ Done |
| 004 | [Household generation redesign](004-household-generation-redesign_DONE.md) | Planning | ✅ Done |
| 005 | [Clock & calendar system](005-clock-and-calendar-system_DONE.md) | Feature | ✅ Done |
| 006 | [Job commute pathfinding loop](006-job-commute-pathfinding_DONE.md) | Feature | ✅ Done |
| 007 | [Business generation](007-business-generation_SUPERSEEDED.md) | Feature | 🚫 Superseded |
| 008 | [Integration (Playwright) suite](008-test-suites-unit-integration.md) | Test | 🚧 Unit+coverage done; Playwright open |
| 009 | [GitHub Actions CI](009-github-actions-ci_DONE.md) | Test | ✅ Done |
| 010 | [Marriage / partnership formation over time](010-marriage-formation-over-time_DONE.md) | Feature | ✅ Done |
| 011 | [Emergent re-housing of household survivors](011-emergent-rehousing_DONE.md) | Feature | ✅ Done |
| 012 | [Live-app verification of clock & population](012-live-app-verification-clock-population.md) | Verification | ⬜ Open |
| 013 | [File-based procedural simulation framework (blueprints + life events)](013-procedural-simulation-framework_DONE.md) | Planning | ✅ Done |
| 014 | [People skills model & assignment](014-people-skills-model_DONE.md) | Feature | ✅ Done |
| 015 | [Skill-matched hiring as resource-slot events](015-skill-matched-hiring_DONE.md) | Feature | ✅ Done |
| 016 | [Retire debug/random spawning; spawn from the simulation](016-retire-debug-spawning_DONE.md) | Feature | ✅ Done |
| 017 | [Money model: wallets & ledger](017-money-model_DONE.md) | Economy | ✅ Done |
| 018 | [Wages & payroll](018-wages-and-payroll_DONE.md) | Economy | ✅ Done |
| 019 | [Cost of living & household spending](019-cost-of-living_DONE.md) | Economy | ✅ Done |
| 020 | [Business economics: revenue, materials, P&L & size dynamics](020-business-economics_DONE.md) | Economy | ✅ Done |
| 021 | [Business bankruptcy & closure](021-business-bankruptcy_DONE.md) | Economy | ✅ Done |
| 022 | [Household insolvency: eviction & homelessness](022-eviction-and-homelessness_DONE.md) | Economy | ✅ Done |
| 023 | [Newlywed cohabitation & household merging](023-newlywed-cohabitation_DONE.md) | Feature | ✅ Done |
| 024 | [Adult children move out / new-household formation](024-adult-children-move-out_DONE.md) | Feature | ✅ Done |
| 025 | [Structure teardown on bulldoze](025-structure-teardown_DONE.md) | Feature | ✅ Done |
| 026 | [Entity selection model (people & buildings)](026-entity-selection-model_DONE.md) | UI | ✅ Done |
| 027 | [Person inspector window (with event log)](027-person-inspector-window_DONE.md) | UI | ✅ Done |
| 028 | [Workplace / business inspector window](028-workplace-inspector-window_DONE.md) | UI | ✅ Done |
| 029 | [City event feed / notifications](029-city-event-feed_DONE.md) | UI | ✅ Done |
| 030 | [Toolbar wiring & tool selection](030-toolbar-and-tools_DONE.md) | UI | ✅ Done |
| 031 | [City overview / dashboard window](031-city-overview-window_DONE.md) | UI | ✅ Done |
| 032 | [Expand the life-event manifest](032-expand-life-events_DONE.md) | Content | ✅ Done |
| 033 | [Demand-driven business revenue + expanded blueprints](033-expand-business-blueprints_DONE.md) | Economy | ✅ Done (033c Tier-2 optional) |
| 034 | [Expand jobs & skills reference tables](034-expand-jobs-and-skills_DONE.md) | Content | ✅ Done |
| 035 | [Materials & products production/consumption chain](035-materials-and-products_DONE.md) | Economy | ✅ Done |
| 036 | [Pre-game history bootstrap (detailed fast-forward sim)](036-pregame-history-bootstrap_DONE.md) | Simulation | ✅ Done |
| 037 | [Bankrupt-lot re-occupancy (vacant buildings attract new businesses)](037-bankrupt-lot-reoccupancy_DONE.md) | Economy | ✅ Done |
| 038 | [Simulation enrichment & execution boundary — architecture + discovery baseline](038-simulation-enrichment-architecture_DONE.md) | Planning | ✅ Done |
| 039 | [Data-schema registry, validators & CI gate](039-data-schema-registry-and-validators_DONE.md) | Framework | ✅ Done |
| 040 | [Hourly ticks, shared tick lifecycle & execution boundary](040-hourly-ticks-and-execution-boundary_DONE.md) | Framework | ✅ Done |
| 041 | [Objects & Person Possessions](041-objects-and-possessions_DONE.md) | Feature | ✅ Done |
| 042 | [Event triggers (manual/probabilistic/automated) & causation](042-event-triggers-and-causation_DONE.md) | Feature | ✅ Done |
| 043 | [Actions: definitions, parameters, lifecycle, pools & sequences](043-actions-core_DONE.md) | Feature | ✅ Done |
| 044 | [Action Consequences DSL & object-action relationships](044-action-consequences-and-object-action-relationships_DONE.md) | Feature | ✅ Done |
| 045 | [Job shift schedules & work-Action declarations](045-job-shifts-and-work-actions_DONE.md) | Feature | ✅ Done |
| 046 | [Brain & the Hooks pattern](046-brain-and-hooks_DONE.md) | Feature | ✅ Done |
| 047 | [The Job Orchestrator](047-job-orchestrator_DONE.md) | Feature | ✅ Done |
| 048 | [Revise & backfill all existing Events (triggers, hourly, action links)](048-events-revision-hourly-migration_DONE.md) | Migration | ✅ Done |
| 049 | [Pre-initiative content planning lists](049-content-planning-lists_DONE.md) | Content | ✅ Done |
| 050 | [Objects data backfill (1,200+ archetypes)](050-objects-data-backfill_DONE.md) | Content | ✅ Done |
| 051 | [Actions data backfill (general + per-job)](051-actions-data-backfill.md) | Content | ⬜ Open |
| 052 | [Events data backfill (500 probabilistic + 500 manual)](052-events-data-backfill.md) | Content | ⬜ Open |
| 053 | [object-action-relationships backfill](053-object-action-relationships-backfill.md) | Content | ⬜ Open |
| 054 | [Action ↔ Event relationship documentation](054-action-event-relationship-docs.md) | Docs | ⬜ Open |
| 055 | [Offline history-asset pipeline + asset-fed new game](055-history-asset-pipeline.md) | Simulation | ⬜ Open (renumbered from 038) |

> Numbering is roughly a suggested ordering, not a hard dependency graph. Several tasks reference
> one another (e.g. 003 ↔ 005 ↔ 006 ↔ 007, and 008 → 009); each task's **Notes** section calls out
> its cross-dependencies.

### Status (as of the 038 planning pass)

The **014–037** procedural-framework arc is complete — employment, the full economy cascade
(wages → cost of living → business P&L → bankruptcy → eviction/homelessness → recovery, with a B2B supply chain),
household-lifecycle dynamics, the UI/inspector layer, content expansion, CI, and the per-load history bootstrap
all shipped. **Remaining open:** **008** (Playwright integration — would also let you verify 036 live),
**012** (live-app verification), **033c** (optional Tier-2 demand), the documented **036 one-fidelity
follow-up** (retire the coarse live pool sim), the **039–054 enrichment arc** (below), and **055** (the offline
history-asset pipeline that reframes 036 from a per-load cost into a versioned data asset — renumbered from 038
so it lands *after* the enrichment it should capture).

### The simulation-enrichment arc (038–055)

[038](038-simulation-enrichment-architecture_DONE.md) is the architecture + discovery baseline for making the
simulation dramatically richer before the offline pipeline freezes it into an asset. One system, two execution
modes (`live` / `bootstrap`) behind a formal **execution boundary** — never `if bootstrap` branches. Phases:

- **Foundation:** [039](039-data-schema-registry-and-validators_DONE.md) (schema registry/validators/CI gate) →
  [040](040-hourly-ticks-and-execution-boundary_DONE.md) (24 ticks/day, shared tick lifecycle, append-only
  logs with causation, the world/materialization adapter).
- **Core systems:** [041](041-objects-and-possessions_DONE.md) (objects & possessions),
  [042](042-event-triggers-and-causation_DONE.md) (event triggers), [043](043-actions-core_DONE.md) (actions) →
  [044](044-action-consequences-and-object-action-relationships_DONE.md) (consequences & object transformations).
- **Integration:** [045](045-job-shifts-and-work-actions_DONE.md) (shifts & work actions),
  [046](046-brain-and-hooks_DONE.md) (Brain), [047](047-job-orchestrator_DONE.md) (Job Orchestrator) →
  [048](048-events-revision-hourly-migration_DONE.md) (per-event revision for the new model).
- **Content:** [049](049-content-planning-lists_DONE.md) (planning lists, done) feeds
  [050](050-objects-data-backfill_DONE.md)–[053](053-object-action-relationships-backfill.md);
  [054](054-action-event-relationship-docs.md) documents the action↔event web.
- **Strategic:** [055](055-history-asset-pipeline.md) then runs the *enriched* sim offline into the
  versioned history asset.

Framework lands before content on purpose: never author 1,000+ data records against unstable schemas.

### Procedural-framework follow-ups (014–037)

Tasks 014–037 wire the procedural simulation framework ([013](013-procedural-simulation-framework_DONE.md)) into
an actual gameplay loop — no loose ends, everything in use during play. Rough phases & order:

- **Employment & movement:** 014 → 015 → (006, 016). Hiring unlocks the commute and retires the
  tech-demo keyboard/random spawning.
- **Economy:** 017 → 018 → 019 → 020 → 021 → 022. Money in (wages) vs. out (cost of living), business P&L,
  and the bankruptcy → eviction cascade ("bad numbers make businesses fail and people lose homes").
- **Living-arrangement dynamics:** 023, 024, 025 (share one "relocate people into a coherent household"
  helper, generalised from 013e).
- **UI / surfacing:** 026 (selection foundation) → 027 (person event-log window), 028 (business window),
  029 (city event feed — the emergent "story"), 030 (toolbar/tools), 031 (city overview).
- **Data expansion:** 032 (life events), 033 (businesses + demand), 034 (jobs & skills), 035 (materials &
  products / B2B supply chain), 037 (bankrupt-lot re-occupancy). Mostly pure data on the framework; new event
  *primitives*/attributes are deliberate code changes.
- **Test infra:** 008 (Playwright integration, open) → 009 (GitHub Actions CI + coverage gate).
- **Strategic:** 036 (pre-game history bootstrap) — fast-forward the detailed sim on a loading screen so
  materialized people arrive with real histories; → 055 (offline history-asset pipeline, renumbered from 038)
  reframes it into a versioned data asset the game selects from, the foundation for one-fidelity simulation.
