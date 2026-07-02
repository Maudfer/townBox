# [Test] GitHub Actions CI pipeline

- **Type:** CI / Tooling
- **Labels:** `test`, `ci`, `tooling`, `infrastructure`
- **Status:** ✅ **Done.** `.github/workflows/ci.yml` runs on `pull_request`→`main`, `push`→`main`, and
  `workflow_dispatch`, with concurrency-cancel and npm caching. One `build-and-test` job (Ubuntu, Node 20,
  `npm ci`) runs **typecheck** (`tsc --noEmit`), the **coverage-gated unit suite** (`npm run test:coverage` —
  threshold in `jest.config.js`, ~72% floor / ~78% current, `lcov` uploaded as an artifact), the **production
  build** (`npm run build-prod`), and an advisory `npm audit`. Pinned action versions (`@v4`).
  **Coverage gate** lives in `jest.config.js` (`collectCoverageFrom` over `src/app/game/**` + `src/util/**`,
  Phaser-only glue excluded). **Branch protection (maintainer action, can't be set from code):** in repo
  Settings → Branches, mark **CI / build-and-test** a required status check for `main` and disable direct
  pushes to `main`, matching the no-direct-merge directive. **Playwright integration** is intentionally deferred
  to 008 — a job is reserved (commented) in the workflow and wired in when that suite lands. No deploy steps.

## Summary

Add a **GitHub Actions** continuous-integration suite under `.github/` that runs the project's tests
on **every pull request** and on **every merge to `main`**. Include quality **gates** (build, tests,
and **coverage**). Focus on **CI only — no deployment** for now.

## Background / current state

- **Repo:** `Maudfer/townBox`, default branch `main`. The codebase directives (see `CLAUDE.md`)
  require: never merge directly to `main`, always open PRs, and always run tests before a PR — CI
  enforces this.
- **Tooling:** Node project; Jest `^30` + `ts-jest` (`npm test`); Parcel build
  (`npm run package` / `build-prod`); strict TypeScript (`tsconfig.json`). Package manager is npm
  (presence of a lockfile should be verified during exploration).
- **No `.github/` workflows exist yet.**
- **Tests & coverage:** the unit/integration suites and the coverage script come from
  `008-test-suites-unit-integration.md`. CI consumes those scripts and the coverage report
  (e.g. `lcov`).

## Goals / Requirements

1. **Workflow triggers.** Create a workflow (e.g. `.github/workflows/ci.yml`) that runs on:
   - `pull_request` targeting `main` (and other long-lived branches if any), and
   - `push` to `main` (post-merge validation).
2. **Environment.** Run on a stable Ubuntu runner with a pinned Node.js LTS version, using npm
   dependency caching for speed. Install with a clean, reproducible install (`npm ci`).
3. **Pipeline stages / gates:**
   - **Type check / build:** ensure the project type-checks and builds (e.g. `tsc --noEmit` and/or
     the Parcel production build) — fail on type or build errors.
     (If a lint setup is added, run it here too.)
   - **Unit tests:** run `npm test` and fail the job on any test failure.
   - **Coverage gate:** run the coverage script (from `008`) and **fail the build if coverage falls
     below a configured threshold.** Pick a sensible initial threshold and make it easy to raise over
     time; document the chosen number. Upload the coverage report as a build artifact (and/or a job
     summary).
4. **Integration tests (Playwright).** Add a job (or stage) that runs the Playwright integration
   suite from `008`, installing the required browser(s) in CI. If integration depends on
   not-yet-merged features (e.g. debug auto-load from `003`), scope/skip gracefully and enable fully
   once available — document this in the workflow.
5. **Status & required checks.** The workflow's checks must be suitable to be configured as
   **required status checks** for merging into `main` (so PRs cannot merge red). Document the branch
   protection settings the maintainer should enable (CI required, no direct pushes to `main`).
6. **No deployment.** Do not add any deploy/publish/release steps.

## Proposed additional inclusions (implement the sensible ones, propose the rest)

- **Concurrency control** to cancel superseded runs on the same PR branch.
- **Matrix** across two Node LTS versions (optional; keep fast).
- **Dependency caching** keyed on the lockfile hash.
- **`npm audit` / dependency review** as a non-blocking (or advisory) job for security visibility.
- **Coverage reporting integration** (e.g. PR comment / summary table) if it can be done without
  external secrets; otherwise keep coverage as an artifact + threshold gate.
- **Artifact upload** of the Playwright report/trace on failure for debugging.
- **`workflow_dispatch`** to allow manual runs.

## Out of scope

- Any deployment, release, publishing, or environment provisioning.
- Self-hosted runners.

## Acceptance criteria

- A CI workflow runs automatically on PRs to `main` and on merges to `main`.
- The pipeline builds/type-checks, runs unit tests, and enforces a coverage threshold (failing below
  it), with the coverage report available as an artifact/summary.
- Playwright integration tests run in CI (or are explicitly, documentedly gated until their
  dependencies land).
- The checks are documented as required status checks for `main`, consistent with the no-direct-merge
  directive in `CLAUDE.md`.

## Notes

- Sequence after (or alongside) `008-test-suites-unit-integration.md`, since CI depends on the test
  and coverage scripts existing.
- Keep the workflow fast and cache-friendly; gate merges on green without making the pipeline
  painfully slow.
- Pin action versions and the Node version for reproducibility.
