# Task backlog

Each file in this folder is a **well-defined, self-contained piece of work that is safe to merge to
`main` on its own**, written JIRA-ticket style. See [`CLAUDE.md`](../../CLAUDE.md) §5 for the full
working agreements.

**Before starting any task:** pull `main`, create a branch, and do a fresh **exploration pass** to
verify the task's claims against current code. Decide if multi-phase planning is needed and, if so,
present a proposal before executing. **Finish with a Pull Request — never merge directly to `main`.
Always run `npm test` before opening the PR.**

## Tasks

| # | Task | Type |
|---|------|------|
| 001 | [Upgrade Phaser 3 → 4](001-upgrade-phaser-4_DONE.md) | Maintenance |
| 002 | [Subdivide each tile into 3×3 sub-tiles](002-tile-placement-granularity-3x3_DONE.md) | Feature |
| 003 | [Save & load system](003-save-load-system_DONE.md) | Feature |
| 004 | [Household generation redesign](004-household-generation-redesign_DONE.md) | Planning |
| 005 | [Clock & calendar system](005-clock-and-calendar-system_DONE.md) | Feature |
| 006 | [Job commute pathfinding loop](006-job-commute-pathfinding_DONE.md) | Feature |
| 007 | [Business generation](007-business-generation.md) | Feature |
| 008 | [Unit & integration test suites + coverage](008-test-suites-unit-integration.md) | Test |
| 009 | [GitHub Actions CI](009-github-actions-ci.md) | Test |
| 010 | [Marriage / partnership formation over time](010-marriage-formation-over-time_DONE.md) | Feature |
| 011 | [Emergent re-housing of household survivors](011-emergent-rehousing_DONE.md) | Feature |
| 012 | [Live-app verification of clock & population](012-live-app-verification-clock-population.md) | Verification |
| 013 | [File-based procedural simulation framework (blueprints + life events)](013-procedural-simulation-framework_DONE.md) | Planning |
| 014 | [People skills model & assignment](014-people-skills-model_DONE.md) | Feature |
| 015 | [Skill-matched hiring as resource-slot events](015-skill-matched-hiring_DONE.md) | Feature |
| 016 | [Retire debug/random spawning; spawn from the simulation](016-retire-debug-spawning_DONE.md) | Feature |
| 017 | [Money model: wallets & ledger](017-money-model_DONE.md) | Economy |
| 018 | [Wages & payroll](018-wages-and-payroll.md) | Economy |
| 019 | [Cost of living & household spending](019-cost-of-living.md) | Economy |
| 020 | [Business economics: revenue, materials, P&L & size dynamics](020-business-economics.md) | Economy |
| 021 | [Business bankruptcy & closure](021-business-bankruptcy.md) | Economy |
| 022 | [Household insolvency: eviction & homelessness](022-eviction-and-homelessness.md) | Economy |
| 023 | [Newlywed cohabitation & household merging](023-newlywed-cohabitation.md) | Feature |
| 024 | [Adult children move out / new-household formation](024-adult-children-move-out.md) | Feature |
| 025 | [Structure teardown on bulldoze](025-structure-teardown.md) | Feature |
| 026 | [Entity selection model (people & buildings)](026-entity-selection-model_DONE.md) | UI |
| 027 | [Person inspector window (with event log)](027-person-inspector-window_DONE.md) | UI |
| 028 | [Workplace / business inspector window](028-workplace-inspector-window_DONE.md) | UI |
| 029 | [City event feed / notifications](029-city-event-feed_DONE.md) | UI |
| 030 | [Toolbar wiring & tool selection](030-toolbar-and-tools_DONE.md) | UI |
| 031 | [City overview / dashboard window](031-city-overview-window.md) | UI |
| 032 | [Expand the life-event manifest](032-expand-life-events.md) | Content |
| 033 | [Expand business blueprints](033-expand-business-blueprints.md) | Content |
| 034 | [Expand jobs & skills reference tables](034-expand-jobs-and-skills.md) | Content |
| 035 | [Materials & products production/consumption chain](035-materials-and-products.md) | Economy |
| 036 | [Pre-game history bootstrap (detailed fast-forward sim)](036-pregame-history-bootstrap.md) | Simulation |

> Numbering is roughly a suggested ordering, not a hard dependency graph. Several tasks reference
> one another (e.g. 003 ↔ 005 ↔ 006 ↔ 007, and 008 → 009); each task's **Notes** section calls out
> its cross-dependencies.

### Procedural-framework follow-ups (014–036)

Tasks 014–036 wire the procedural simulation framework ([013](013-procedural-simulation-framework_DONE.md)) into
an actual gameplay loop — no loose ends, everything in use during play. Rough phases & order:

- **Employment & movement:** 014 → 015 → (006, 016). Hiring unlocks the commute and retires the
  tech-demo keyboard/random spawning.
- **Economy:** 017 → 018 → 019 → 020 → 021 → 022. Money in (wages) vs. out (cost of living), business P&L,
  and the bankruptcy → eviction cascade ("bad numbers make businesses fail and people lose homes").
- **Living-arrangement dynamics:** 023, 024, 025 (share one "relocate people into a coherent household"
  helper, generalised from 013e).
- **UI / surfacing:** 026 (selection foundation) → 027 (person event-log window), 028 (business window),
  029 (city event feed — the emergent "story"), 030 (toolbar/tools), 031 (city overview).
- **Data expansion:** 032 (life events), 033 (businesses), 034 (jobs & skills), 035 (materials & products).
  Mostly pure data on the framework; new event *primitives*/attributes are deliberate code changes.
- **Strategic:** 036 (pre-game history bootstrap) — fast-forward the detailed sim on a loading screen so
  materialized people arrive with real histories; the foundation for one-fidelity simulation.
