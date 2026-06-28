# [Test] Unit & integration test suites + coverage

- **Type:** Test infrastructure
- **Labels:** `test`, `tooling`, `coverage`, `playwright`

## Summary

Establish **two test suites** for the project:

1. A **unit test suite** — traditional unit tests, aiming for the **largest practical coverage** of
   the simulation core.
2. An **integration test suite** — boots the game with a **debug save loaded** and uses
   **Playwright** to drive and assert real in-app functionality.

Also wire up an `npm` script to **generate test coverage**.

## Background / current state

- **Test runner:** Jest `^30` + `ts-jest`, `testEnvironment: node` (`jest.config.js`), with module
  aliases mirroring `tsconfig.json` (`game/*`, `hud/*`, `types/*`, `util/*`, `json/*`, `css/*`).
  `npm test` runs `jest`.
- **Existing tests:** only `test/personTravel.test.ts` (exercises `Person`'s `TravelStep` machine
  with hand-built stubs for `GameManager`/`PathFinder`).
- **No coverage script, no Playwright, no integration harness** exist today.
- **Testable core:** the `game/` simulation is largely pure TypeScript and unit-testable with stubs
  (e.g. `PathFinder` A\*, `Road` auto-tiling/curb/lane math, `Family` generation, `SocialLife`
  relationship logic, `WorkLife`/`Workplace` hiring, `GameManager` tile↔pixel coordinate math).
  React/Phaser rendering is the part that needs an in-browser (Playwright) harness.
- **Debug save / auto-load:** the debug auto-load capability comes from
  `003-save-load-system_DONE.md` (ship a build with an embedded save that bypasses the splash). The
  integration suite depends on it.

## Goals / Requirements

### Unit suite

1. Organize unit tests (under `test/` or a clearly separated unit path) and aim for the **largest
   practical coverage** of `game/`, `util/`, and pure logic in `types/`. Prioritize:
   - `PathFinder` (A\* correctness, no-path, neighbor validity).
   - `Road` auto-tiling neighbor codes and curb/lane point math; `Building.calculateEntrance`.
   - `GameManager.tileToPixelPosition` / `pixelToTilePosition` round-trips and bounds handling.
   - `SocialLife` relationship add/remove/query; `Family` generation invariants
     (member counts, relationship symmetry) — note this is slated for redesign in `004`, so keep
     tests resilient or scope them.
   - `WorkLife` / `Workplace` hiring and skill matching.
   - `Person` / `Vehicle` movement helpers (target-reached, axis switching) and travel state machine
     (extend the existing test).
2. Use lightweight stubs for `GameManager`/Phaser as the existing test does; keep unit tests free of
   a real browser/Phaser runtime.

### Coverage

3. Add an `npm` script to generate coverage (e.g. `test:coverage` → `jest --coverage`) and configure
   Jest `collectCoverageFrom` to target `src/app/game/**`, `src/util/**`, and other pure modules
   (exclude pure-render React/Phaser glue that can't be meaningfully unit-covered). Produce a
   machine-readable report (e.g. `lcov`) for CI consumption (see `009-github-actions-ci.md`).

### Integration suite (Playwright)

4. Add **Playwright** as a dev dependency and a separate script to run the integration suite
   (e.g. `test:integration`). Keep it isolated from the Jest unit run (`npm test` should remain the
   fast unit run; integration runs under its own command).
5. The integration harness must **launch the app with a debug save auto-loaded** (via the capability
   from `003`), bypassing the splash, so tests start from a known, deterministic world state. Define
   and commit the fixture save used by integration tests.
6. **Define and implement integration use cases**, including at minimum:
   - App boots from the debug save into `MainScene` (no splash), and the HUD mounts.
   - Selecting a house (Select tool) opens the `HouseDetails` window and renders a family tree.
   - Placing a road/house/work building with a tool updates the world (a tile/sprite appears).
   - Tool hotkeys (`F1`–`F6`, `Esc`) switch the active tool/cursor.
   - Spawning a person (`P`) / vehicle (`V`) adds an entity that moves.
   - The save flow works: save button / `Ctrl+S` triggers a save and the success toast appears
     (depends on `003`).
   - The clock/date-time widget renders and advances (depends on `005`).
   - Add further high-value cases discovered during the exploration pass.

### General

7. Document how to run each suite (unit, coverage, integration) in the PR / `README.md`.
8. `npm test` (unit) and the new coverage and integration scripts all run successfully locally.

## Out of scope

- Achieving a specific coverage **threshold** number (the gate is configured in
  `009-github-actions-ci.md`); this task focuses on building the suites and the coverage script.
- Visual-regression / screenshot-diff testing (can be a follow-up).
- Cross-browser matrices (target a single Chromium runner initially).

## Acceptance criteria

- A unit suite runs via `npm test` with meaningful coverage of the simulation core.
- `npm run test:coverage` (or equivalent) emits a coverage report including `lcov`.
- A Playwright integration suite runs via its own script, boots from a committed debug save, and
  asserts the defined use cases.
- Running instructions are documented.

## Notes

- The integration suite depends on `003-save-load-system_DONE.md` (debug auto-load + committed fixture
  save). Sequence accordingly; if `003` is not yet merged, scope the integration harness to what is
  bootable and expand once auto-load lands (call this out in the plan).
- Some integration cases depend on `005` (clock widget) and the save toast from `003`; gate those
  cases on the relevant features being present.
- Keep integration tests deterministic: fixed fixture save, controlled timing, and stable selectors
  (add `data-testid` attributes to HUD elements where needed).
