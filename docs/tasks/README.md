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
| 001 | [Upgrade Phaser 3 → 4](001-upgrade-phaser-4.md) | Maintenance |
| 002 | [Subdivide each tile into 3×3 sub-tiles](002-tile-placement-granularity-3x3.md) | Feature |
| 003 | [Save & load system](003-save-load-system.md) | Feature |
| 004 | [Household generation redesign](004-household-generation-redesign.md) | Planning |
| 005 | [Clock & calendar system](005-clock-and-calendar-system.md) | Feature |
| 006 | [Job commute pathfinding loop](006-job-commute-pathfinding.md) | Feature |
| 007 | [Business generation](007-business-generation.md) | Feature |
| 008 | [Unit & integration test suites + coverage](008-test-suites-unit-integration.md) | Test |
| 009 | [GitHub Actions CI](009-github-actions-ci.md) | Test |
| 010 | [Marriage / partnership formation over time](010-marriage-formation-over-time.md) | Feature |
| 011 | [Emergent re-housing of household survivors](011-emergent-rehousing.md) | Feature |
| 012 | [Live-app verification of clock & population](012-live-app-verification-clock-population.md) | Verification |
| 013 | [File-based procedural simulation framework (blueprints + life events)](013-procedural-simulation-framework.md) | Planning |

> Numbering is roughly a suggested ordering, not a hard dependency graph. Several tasks reference
> one another (e.g. 003 ↔ 005 ↔ 006 ↔ 007, and 008 → 009); each task's **Notes** section calls out
> its cross-dependencies.
