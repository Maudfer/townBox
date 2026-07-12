# Integration suite (Playwright) — task 008

The browser-level test layer. It boots the **real production build** (Parcel → `./bin`, the React HUD + the
Phaser canvas) and drives it through a deterministic, test-only hook, asserting the things the headless Jest
unit suite structurally cannot: the HUD, the canvas, real input, windows, save/load round-trips, and emergent
on-map behaviour over simulated time.

It is **entirely separate** from the Jest unit suite — its own `playwright.config.ts`, its own npm scripts, and
its own **non-blocking** CI job (`integration`, not in `ci-success`'s needs). Do **not** add it to `npm test`.

## Running it

```bash
npx playwright install chromium      # one-time: fetch the browser
npm run test:integration             # build ./bin, serve it, run the suite (Chromium)
npm run test:integration:coverage    # same, plus the scene/HUD browser-coverage report
npm run test:integration:report      # open the last HTML report
```

The `webServer` in `playwright.config.ts` runs `npm run build-prod` and serves `./bin` with the dependency-free
`scripts/serveIntegration.mjs`. Locally the server is **reused** if already running (so iterating on a spec
doesn't rebuild every time); on CI it always builds fresh. To iterate fast on one spec:

```bash
npm run build-prod                                   # once
node scripts/serveIntegration.mjs --dir ./bin        # leave running in another shell
npx playwright test hud/windows.spec.ts --project=chromium
```

## The determinism hook — `window.__townbox`

The linchpin (see `src/app/game/TestHarness.ts`). It is installed on `window.__townbox` **only in test mode**
and never in a normal production session. Test mode is enabled by a `?test=1` URL param **or** a
`window.__TOWNBOX_TEST = true` global set before boot (the helpers use `addInitScript`). In test mode the
RAF-driven clock is **paused**, so in-game time advances only when a test asks.

Boot params (test mode only): `?boot=new` skips the splash into a fresh game; `?boot=load` skips it and loads
the default save slot (seeded by the test); `?seed=N` pins the cold-start pool for reproducible scenarios.

Hook API (control + read):

- **Time / frames** — `stepTicks(n)` advances the sim `n` in-game hour ticks deterministically (awaits the full
  `newDay`/`newTick` lifecycle each tick); `pumpFrames(count, deltaMs)` drives the render/movement loop
  (`Field.update`) without depending on the throttled RAF loop; `pause()`/`resume()`, `getTick()`, `getDate()`.
- **Build / save** — `build(tool,row,col)` / `bulldoze(row,col)` place/tear-down through the real `tileClicked`
  path (awaiting async household/business setup); `focusTile(row,col)` centres the camera on a tile and returns
  the screen point for a **real** canvas click; `savePayload()` serializes the world (fixture recording).
- **World reads** — `tileAt(row,col)`, `structureCounts()`, `buildings()`, `people()`, `personById(id)`,
  `vehicles()`, `cityStats()`, `historyLength(personId)`.

Specs talk to the hook through thin delegators in `support/app.ts` (each a single `page.evaluate`). Every spec
imports `{ test, expect }` from `support/fixtures.ts` (the coverage-collecting extension of Playwright's test).

## Layout

```text
test/integration/
  support/
    app.ts             # boot helpers + window.__townbox delegators + real-click helpers
    types.ts           # a local mirror of the hook API surface (keeps the suite decoupled from app TS)
    fixtures.ts        # extended `test` that captures V8 coverage per test when COVERAGE=1
    coverageReporter.ts# converts raw V8 coverage → istanbul, scoped to scene/** + GameManager + hud/**
  fixtures/
    recordFixtures.ts  # the scenario recorder (npm run generate-scenarios; the `fixtures` PW project)
    *.txt              # committed save-string fixtures (small-town, commuter)
  hud/                 # §4: start/save/load, toolbar, windows, feed + clock
  canvas/              # §5: placement, bulldoze, movement/commute
  scenarios/           # §4.3: household draw, economy cascade, demographics
  smoke.spec.ts        # the harness sanity check
```

## Scenario fixtures

Deterministic starting worlds live under `fixtures/*.txt` as committed save strings. Regenerate them with
`npm run generate-scenarios` (the recorder drives the real app to build a small town and writes the fixtures via
the app's own serializer, so every fixture is a valid `WorldSnapshot`). Keep fixture assertions **structural**
(counts, "an employed adult exists") rather than identity-specific, so a regenerated fixture doesn't break tests.

## Notes / known limits

- **On-map pixel travel** (people walking, cars driving to arrival) is driven by Phaser's per-frame loop + A\*
  pathfinding, which the headless browser throttles; positions don't advance to arrival reliably here. The
  commute tests therefore assert the **deterministic, hook-observable** facts — the travel state machine engages
  and a commute vehicle is assigned — not full arrival (that's exercised by the shipped game's real render loop).
- **Phaser key input** (F1–F6 / Esc) is processed on the game loop; use `pressToolKey` (press + settle) so a
  keypress isn't missed under headless throttling.
- Browser coverage (`COVERAGE=1`) is **informational** — it collects the scene/HUD surface the Jest per-module
  gate excludes and uploads it as an artifact; it does **not** gate.
