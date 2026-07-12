# [Test] Integration (Playwright) suite — the browser-level test layer

- **Type:** Test infrastructure
- **Labels:** `test`, `tooling`, `playwright`, `integration`, `ci`
- **Status:** ✅ **Done.** The Playwright integration suite is implemented under `test/integration/` (harness +
  `window.__townbox` determinism hook, HUD/canvas/scenario suites, committed save fixtures, browser coverage of
  the scene/HUD gap, and a non-blocking `integration` CI job). See `test/integration/README.md`. Original
  scope note: the unit suite + coverage from the 008/009 era were long done and rebuilt into the modular
  per-module architecture; this task delivered the remaining **Playwright integration** layer that exercises
  what the headless Jest suite structurally cannot — the React HUD, the Phaser canvas, real input, windows,
  save/load round-trips through the actual UI, and emergent on-map behaviour over time.

---

## 0. Read this first — the current test architecture (so you build *with* it, not around it)

The repo already has a mature, opinionated test setup. Study it before adding anything; your integration suite
should feel like a first-class citizen of it, not a bolt-on. Sources of truth: **`CLAUDE.md` §2 (Scripts), §4
(Architecture), §5.3 (Testing & quality gates)**, `jest.config.js`, `.github/workflows/ci.yml`,
`scripts/coverage-gate.mjs`.

**Unit suite (Jest, done — do NOT fold Playwright into it):**

- One Jest **project per module**: `test/<module>/` mirrors `src/app/game/<group>/`, with `test/util/` for pure
  utilities and `test/perf/` for the offline-generator perf gates. Run all with `npm test`; run one with
  `npx jest --selectProjects <module>`. There are **~111 suites / ~1500+ tests** now (not the "41/220" an older
  version of this file claimed).
- **Per-module coverage, BLOCKING at 80%.** Each `test (<module>)` CI job uploads its own coverage report; the
  `coverage` job runs `scripts/coverage-gate.mjs`, which **filters each report to the files that module OWNS**
  (`jest.config.js` `MODULE_COVERAGE`) before scoring — because Jest's `collectCoverageFrom` is *additive* (it
  forces owned files in but doesn't filter transitively-required files out). `COVERAGE_THRESHOLD` is one number
  in `jest.config.js`.
- **What the unit suite deliberately does NOT cover:** the Phaser-only glue and the React HUD — i.e.
  `src/app/game/scene/**` (MainScene, TitleScene, DebugTools), `src/app/game/GameManager.ts` (excluded from
  coverage), and everything in `src/app/hud/**` (no jest tests at all). These "can't be meaningfully unit-covered
  without a browser harness" — **that browser harness is THIS task.** So the integration suite is also where the
  scene/HUD coverage gap gets filled (see §7).

**CI (`.github/workflows/ci.yml`)** is split into concurrent, independently-reported checks aggregated by a
single stable `ci-success` job (the required status check): `changes` (path-filters which modules a PR touched),
a dynamic `test` matrix (one job per affected module), `typecheck`, `build`, `lint` (ESLint + markdownlint),
`perf`, and `coverage` — all **blocking**. `audit` is advisory. **Your integration job must NOT be in
`ci-success`'s needs** (see §8 — it's slow and runs async/non-blocking).

**Working agreements that apply to your tests too (CLAUDE.md §5):** deterministic (seed any RNG — the whole sim
is deterministic per world seed; no reliance on wall-clock), keep it green, don't weaken gates, one task → one
branch → one PR. Every task ships with tests; this task's *deliverable* is tests, so the "tests" are the suite
itself + proof it runs.

---

## 1. The app under test — how it boots, serves, and can be driven

- **Stack:** Phaser 4 canvas + React 18 HUD, bundled by Parcel, entry `src/html/index.html` → `src/app/main.tsx`.
  `main.tsx` builds a `GameManager` (the event bus + orchestrator + `Clock`), which creates the Phaser `Game`
  with `TitleScene` and `MainScene`; React `<HUD>` mounts on the `gameInitialized` event into `#hud-container`.
- **Boot flow:** `TitleScene` splash with **Start Game** (new world → `MainScene`) and **Load Game** (restores
  the most recent save via the pluggable `SaveProvider` → `LocalStorageProvider`). The HUD emits `hudReady`;
  `GameManager` applies any queued load (title-screen load or debug auto-load) only then.
- **Debug auto-load (the key hook for deterministic starts):** `src/json/config.json` →
  `debug.autoLoad.{enabled, save}`. When `enabled: true`, `GameManager` boots **straight into `MainScene` from
  the embedded `save` string, bypassing the splash**, on `hudReady`. The `save` is a compressed+base64 save
  payload (see §3). This is how a build "auto-loads a scenario". Other debug flags live under `debug`
  (`masterSwitch` gates overlays, `spawnKeys` enables the `P`/`V` debug spawns, `drawCurbs`/`drawLanes`/etc.).
- **Tools & input (`json/input.json`, `MainScene`):** `F1`–`F6` = soil / road / house / work / **select** /
  bulldoze; `Esc` = select. `G` toggles the grid overlay. `W/A/S/D` pan, `Q/E` zoom. `Ctrl+S` saves (handled in
  the HUD, which suppresses the browser dialog). The **Select tool** is the universal inspector: clicking a
  person/house/workplace/the clock opens `PersonDetails`/`HouseDetails`/`WorkplaceDetails`/`CityDetails`.
- **Building/placement:** roads snap to a 3×3 supertile grid and auto-tile from neighbours; buildings soft-snap
  flush against a road side (invalid spots preview red). Each structure occupies a 3×3 footprint. Bulldozing an
  occupied building tears it down coherently (evict residents / close business).
- **Time:** the `Clock` advances from the frame loop (1 in-game day = 1 real hour; the canonical tick is the
  in-game hour). `timeChanged`/`newTick`/`newDay` fan out on the bus; the HUD clock widget shows the live date.
  **This real-time advance is your biggest determinism challenge** — solve it with a test hook (§6), don't
  `sleep`.
- **Serving for tests:** `npm run build-prod` bundles to `./bin` (Parcel), and `postbuild-prod` copies the
  history asset + sprites there. Serve `./bin` as static files (any static server — the dev setup uses
  `browser-sync`; `npx serve ./bin` or `http-server ./bin` work too). Point Playwright's `webServer.command` at
  a build+serve and `baseURL` at it. (The dev path is `npm run dev` → Parcel watch + `browser-sync` on `./dist`;
  fine for local iteration, but CI should test the **production build**.)

---

## 2. Deliverables (what to build)

1. **Playwright harness.** Add `@playwright/test` as a devDependency, a `playwright.config.ts` (single Chromium
   project to start; `webServer` that builds+serves `./bin`; `baseURL`; trace/screenshot/video on failure;
   sensible timeouts since the sim runs in real time), a `test:integration` npm script, and a `test/integration/`
   directory. Keep it **entirely separate** from the Jest projects (do not add it to `jest.config.js`
   `projects`, do not let `npm test` pick it up).
2. **A deterministic test hook** to make the opaque canvas + real-time sim assertable (§6) — the single most
   important enabler. Plus `data-testid` attributes on HUD elements (§4) for robust React selectors.
3. **Scenario save fixtures + a generator script** (§3).
4. **The baseline suites** (§4 HUD, §5 canvas) + **scenario-specific tests** (§4.3).
5. **Coverage collection** for the scene/HUD gap (§7).
6. **CI wiring as an async, non-blocking job** (§8).
7. **Docs:** a short README/section on how to run it locally and what the hook exposes.

---

## 3. Scenario saves — fixtures + a generator script

Tests need known, deterministic starting worlds. The save format is an **id-based `WorldSnapshot`**
(`types/Save.ts`) → JSON → deflate (`pako`, `util/compress.ts`) → base64, produced/consumed by
`game/save/SaveManager.ts` through a `SaveProvider` (`LocalStorageProvider` today). Save version is `SAVE_VERSION`.

**Create a generator script** (e.g. `scripts/generateScenario.ts`, run via `tsx` like the existing
`scripts/generateHistoryAsset.ts`) that produces committed scenario save strings under
`test/integration/fixtures/`. Two viable approaches — pick per scenario:

- **(a) Headless snapshot builder (preferred for small, precise scenarios).** Construct a `WorldSnapshot`
  object directly (roads/buildings by anchor key, people/vehicles with stable ids, households, businesses,
  economy, clock) and serialize it with the same `compress`/base64 path `SaveManager` uses. Fully deterministic,
  no browser. Study `SaveManager`'s serialize/deserialize and `types/Save.ts` for the exact shape; reuse the real
  `Population`/`BusinessGen`/`Economy` generators to fill realistic data from a fixed seed.
- **(b) Record-a-scenario via Playwright.** Drive the real app to build a scenario (place roads/buildings, let
  it run N ticks), trigger a save, then read the payload out of `localStorage` (LocalStorageProvider's key) and
  commit it as a fixture. Good for complex emergent scenarios that are painful to hand-build.

**Wiring a fixture into the debug auto-load.** The `debug.autoLoad.save` in the committed `config.json` must
stay empty (don't ship a scenario in the real config). To boot a *specific* fixture per test without rebuilding
per scenario, add a **small, test-only parametrization hook** (consistent with the existing `debug` flags),
choosing one:

- Seed `localStorage` before load (`page.addInitScript`) with the fixture under the `LocalStorageProvider` key,
  then drive the title-screen **Load Game** (or set `autoLoad` to consume localStorage). Cleanest — no rebuild.
- OR have `GameManager` also honour a `?load=<fixtureName>` URL param / a `window.__TOWNBOX_AUTOLOAD` global in
  addition to `config.autoLoad`, gated so it only activates for the test build. Document whichever you add.

A single shared "default" scenario (a small town with a few houses, a workplace, roads, a couple of
residents/commuters) covers most HUD + canvas baseline cases; add a handful of purpose-built fixtures for the
scenario-specific tests.

---

## 4. HUD (React) baseline suite — `test/integration/hud/`

Add stable `data-testid` attributes to the HUD components as you go (`hud/Hud.tsx`, `hud/Toolbar.tsx`,
`hud/Clock.tsx`, `hud/Feed.tsx`, `hud/Window.tsx`, `hud/windows/*`). Cover, at minimum, **every** operation
below with real Playwright interactions + assertions:

- **Start a game.** From the splash: **Start Game** boots a new world into `MainScene` and the HUD mounts (clock
  + feed + toolbar visible). Also **Load Game** restores a seeded save. Also the **debug auto-load** path boots
  straight in with no splash.
- **Save.** Toolbar save button **and** `Ctrl+S` each trigger a save and surface the success **toast**
  (`Toasts.tsx`, from `gameSaved`); a failure surfaces the error toast.
- **Load.** Round-trip: save a modified world, reload the page, load it back, assert the world matches (via the
  test hook — e.g. same building/resident counts).
- **Toolbar buttons.** Click **each** tool button (soil/road/house/work/select/bulldoze) and confirm the action:
  the active tool highlights, the emitted `toolSelected` takes effect, and the cursor/placement mode changes;
  confirm `F1`–`F6` / `Esc` keys do the same and stay in sync with the buttons.
- **Windows (via the Select tool):** open a window (click a house → `HouseDetails` with a family tree; a person →
  `PersonDetails` with its life-event log; a workplace → `WorkplaceDetails`; the clock → `CityDetails` overview);
  **move** a window (drag the title bar — `react-rnd` — assert position changes); **resize** a window (drag a
  handle — assert size changes); **close** a window (assert it unmounts). Cover the singleton vs. per-identity
  window rules (house/city are singletons; person windows dedupe by identity).
- **Event feed updates.** With the sim running (advance time via the hook), assert the city event **feed**
  (`Feed.tsx`, from `cityEvent`) gains entries (births/deaths/hires/etc.), that clicking a feed entry opens the
  subject's inspector, and that the feed collapses/expands.
- **Clock widget** renders and **advances** (the date/time changes as the sim ticks).

### 4.3 Scenario-specific tests — `test/integration/scenarios/`

Auto-load purpose-built fixtures and assert emergent outcomes over controlled sim time (advance via the hook,
§6). Examples (pick a meaningful handful): a **commuter scenario** → the resident leaves home, reaches the
workplace, and returns; a **household draw** → placing a house materialises a coherent family whose tree renders;
an **economy scenario** (oversupplied category / understaffed business) → the business trends toward
shrink/bankruptcy over months; a **death/rehousing** scenario → a resident dies, is despawned, and an orphaned
minor is re-housed. These are the payoff — they assert the *simulation*, end to end, through the real UI.

---

## 5. Visual canvas operations suite — `test/integration/canvas/`

The Phaser canvas is opaque to DOM queries, so assert via the **test hook** (§6), not pixel diffs. Cover:

- **Place a road tile:** select the road tool, click a grid cell, assert a `Road` now exists at that anchor
  (and that adjacent roads auto-tiled — the sprite/neighbour code updated).
- **Place a building:** house and work — click a valid road-side cell, assert a `House`/`Workplace` exists with
  its 3×3 footprint, and (house) a household materialised / (work) a business generated.
- **Bulldoze a built tile:** select the bulldozer, click a placed building, assert it's removed and the teardown
  was coherent (residents evicted / business closed; the lot desaturated).
- **People move:** with the sim advancing, assert a person travels from one building to another (their
  position/`currentBuilding` changes over ticks) — leverage a commuter fixture so a trip is guaranteed.
- **People enter/exit cars:** during a commute, assert the travel state machine progresses
  (`ExitingBuilding → WalkingToCar → EnteringCar → Driving → … → Arrived`), i.e. a car is spawned/assigned and
  the person boards then disembarks.
- **Cars move:** assert a `Vehicle` drives along lanes between buildings (position changes; it despawns on
  arrival).

Because movement is real-time, drive these with the hook's **step-N-ticks** control (deterministic) rather than
waiting on wall-clock, and assert on the resulting simulation state.

---

## 6. The determinism hook — expose a test-only window API

This is the linchpin. Add a **test-only** global (e.g. `window.__townbox`) that the app installs **only** when a
debug/test flag is set (reuse the `config.json` `debug` mechanism, a `?test=1` param, or a Parcel env var — never
in normal production). It should expose read + control access to the live sim:

- **Read:** the `Field` (query a tile at `(row,col)` → is it a `Road`/`House`/`Workplace`?; footprint anchors),
  the `City`/`Population` (resident/household/business counts, a person's `currentBuilding`, travel state,
  vehicle count/positions), the `Clock` (current tick/date), and the event history/feed.
- **Control:** **advance the sim deterministically** — e.g. `stepTicks(n)` that drives the same
  `newTick`/`newDay`/economy cadence the frame loop does, without depending on real elapsed time. This lets a
  canvas test do `place → stepTicks(24) → assert person arrived` with zero flakiness. Optionally pause/resume the
  RAF loop so time only advances when the test asks.

Expose it through `GameManager` (which already owns the `Clock`, `Field`, `City`) so it stays inside the
game→HUD boundary (no reaching into internals from tests except through this documented seam). Keep it strictly
gated so it never ships enabled.

---

## 7. Coverage — fill the scene/HUD gap (don't fight the per-module gate)

The Jest per-module gate intentionally **excludes** `scene/**`, `GameManager.ts`, and all of `hud/**`. The
integration suite is the right place to cover them. Wire it **separately** from the jest coverage gate:

- **Collect browser coverage.** Either instrument the test build with `babel-plugin-istanbul` (then read
  `window.__coverage__` after each test and merge with `istanbul-lib-coverage` — already a devDependency — into
  an lcov/`coverage-final.json`), or use Playwright's Chromium **V8 coverage** API and convert to istanbul.
- **Scope + report.** Produce a coverage report scoped to the browser-only surface (`src/app/game/scene/**`,
  `src/app/game/GameManager.ts`, `src/app/hud/**`). Upload it as a CI artifact. Start it **informational**
  (report + trend), and only later — once the suite is broad enough — consider a separate integration-coverage
  threshold (a distinct gate, NOT folded into the per-module `coverage-gate.mjs`, whose owned-file model assumes
  the jest scoping). Reuse the spirit of `scripts/coverage-gate.mjs` if you add a threshold.

---

## 8. CI wiring — a slow, async, NON-BLOCKING job

The suite boots a real browser and runs the sim over many ticks — it will take minutes, not seconds. **It must
not gate merges.** Add an `integration` job to `.github/workflows/ci.yml`:

- Steps: checkout → setup-node (20, npm cache) → `npm ci` → `npx playwright install --with-deps chromium` →
  `npm run build-prod` (or let `playwright.config.ts` `webServer` build+serve) → `npm run test:integration`.
- `if: always()` on report upload; **upload the Playwright HTML report + traces/videos on failure**, and the
  coverage artifact.
- **Do NOT add `integration` to `ci-success`'s `needs`** (keep it advisory/non-blocking, exactly like `audit`
  and how `coverage`/`perf` were staged before they were trusted). Optionally gate it to `pull_request` +
  `push` to main, or behind a label / `workflow_dispatch`, so it doesn't run on every trivial push. Give it a
  generous `timeout-minutes`. It runs concurrently with everything else; its result is visible but never blocks.
- Follow the file's existing conventions (the `changes` job, comment style, pinned action versions).

When it's mature and stable, a follow-up can promote it (its own required check, or into `ci-success`) — call
that out in the PR but don't do it here.

---

## 9. Out of scope

- Visual-regression / screenshot-diff testing, and cross-browser matrices (single Chromium initially; the hook +
  state assertions are more robust than pixel diffs for this canvas app).
- Any change to the Jest per-module gate, `COVERAGE_THRESHOLD`, or `ci-success`'s required checks.
- Touching `docs/tasks/**` history.

## 10. Acceptance criteria

- `@playwright/test` + `playwright.config.ts` + a `test:integration` script exist; the suite boots the real
  production build (React HUD + Phaser) from a committed scenario fixture via the debug auto-load / seeded load,
  with a documented, test-gated determinism hook (`window.__townbox` or equivalent) and `data-testid`s on the HUD.
- A **scenario generator script** produces committed fixtures under `test/integration/fixtures/`.
- The **HUD suite** (§4) covers start/save/load, every toolbar button + hotkey, window open/move/resize/close,
  the event feed updating, and the clock advancing; the **canvas suite** (§5) covers road/building placement,
  bulldozing, and people/cars moving + commute enter/exit; plus a handful of **scenario-specific** tests (§4.3).
- Tests are deterministic (fixtures + the step-ticks hook, no wall-clock waits) and green locally.
- Browser coverage of the scene/HUD gap is collected and uploaded (§7).
- CI runs the suite as a **separate, async, non-blocking** job (§8) — visible, never in `ci-success`'s needs.
- Running instructions are documented (README/section).

## 11. Notes

- Reuse the debug auto-load (`003`) for a deterministic, splash-free start; add `data-testid`s where the HUD
  lacks stable selectors.
- Do **not** fold Playwright into `npm test` / the Jest projects — it's a separate suite with its own script and
  its own (non-blocking) CI job, the browser analogue of how `test/perf/` is isolated.
- Never commit a scenario in the real `config.json`, and never ship the test hook enabled.
