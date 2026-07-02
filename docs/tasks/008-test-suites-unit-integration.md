# [Test] Integration (Playwright) suite

- **Type:** Test infrastructure
- **Labels:** `test`, `tooling`, `coverage`, `playwright`
- **Status:** 🚧 **Re-scoped (updated 2026-06-29).** The original task asked for a unit suite + a coverage
  script + a Playwright integration suite. The **unit suite** and **coverage** are now **done** and unrelated to
  their original "only `personTravel.test.ts` exists" baseline:
  - The repo has a mature Jest + ts-jest unit suite — **41 test files / 220 tests** covering the simulation core
    (pathfinding, footprint/depth, save/load, curves/predicates, business gen + economics + demand, the event
    compiler/engine, households/rehousing/cohabitation/move-out/eviction, life events, city stats, teardown, …).
  - **Coverage** is wired (task 009): `npm run test:coverage` (`jest --coverage`) with `collectCoverageFrom`
    over `src/app/game/**` + `src/util/**` (Phaser-only glue excluded), an `lcov` report, and a
    `coverageThreshold` gate (~72% floor, currently ~78% statements). CI consumes it.
  - **The remaining work — and the active scope of this task — is the Playwright integration suite below.**

## Summary

Add an **integration test suite** that boots the real app (React HUD + Phaser) with a **debug save auto-loaded**
and uses **Playwright** to drive and assert in-app behaviour the headless unit suite can't (rendering, input,
window interactions). Keep it isolated from the fast Jest unit run (`npm test`); it runs under its own script.

## Background / current state (verified)

- **Unit + coverage:** done (see Status). `npm test` is the fast unit run; `npm run test:coverage` gates
  coverage. Do **not** fold Playwright into `npm test`.
- **Debug auto-load exists** (`003`): `json/config.json` → `debug.autoLoad.{enabled,save}` boots straight into
  `MainScene` from an embedded save, bypassing the splash (`GameManager` applies it on `hudReady`). The
  integration harness should use this for a deterministic start state.
- **No Playwright, no integration harness, no committed fixture save** exist yet.
- HUD elements mostly lack stable selectors; add `data-testid` attributes where needed for robust assertions.

## Goals / Requirements

1. **Add Playwright** as a dev dependency and a dedicated script (e.g. `test:integration`) plus a
   `playwright.config.ts` targeting a single Chromium project. Document how to run it.
2. **Boot from a committed fixture save** via the `003` debug auto-load, so tests start from a known,
   deterministic world (no splash). Commit the fixture.
3. **Implement high-value cases**, at minimum:
   - App boots from the debug save into `MainScene` (no splash) and the HUD mounts.
   - Select tool → clicking a house opens `HouseDetails` and renders a family tree; clicking a workplace opens
     `WorkplaceDetails`; clicking a person opens `PersonDetails` with its life-event log.
   - Placing a road/house/work building with a tool updates the world (a tile/sprite appears).
   - Tool hotkeys (`F1`–`F6`, `Esc`) switch the active tool/cursor.
   - Save flow: toolbar save / `Ctrl+S` triggers a save and the success toast appears.
   - The clock/date-time widget renders and advances; clicking it opens the **city overview** (031).
   - The city event **feed** (029) shows entries as the sim runs.
4. **Wire it into CI (009).** Add the reserved Playwright job to `.github/workflows/ci.yml` (install Chromium
   with `npx playwright install --with-deps chromium`, run `test:integration`, upload the report/trace on
   failure). Keep it a separate job so the unit gate stays fast.
5. **Determinism:** fixed fixture save, controlled timing, stable `data-testid` selectors.

## Out of scope

- A specific coverage threshold number (configured in `009`, done).
- Visual-regression / screenshot-diff testing; cross-browser matrices (single Chromium initially).

## Acceptance criteria

- A Playwright integration suite runs via its own script, boots from a committed debug save, and asserts the
  defined use cases; it is wired into CI as its own job.
- Running instructions are documented.

## Notes

- The unit-suite/coverage portions of the original task are complete; this file now tracks only the integration
  suite. Sequence after 009 (CI) — which reserves a Playwright job — and reuse the `003` auto-load.
