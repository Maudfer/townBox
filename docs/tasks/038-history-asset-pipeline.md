# [Feature] Offline history-asset pipeline + asset-fed new game

- **Type:** Feature / Simulation + Architecture + Tooling
- **Labels:** `feature`, `simulation`, `tooling`, `asset`, `strategic`, `framework-followup`
- **Depends on:** 036 (the history bootstrap — its engine loop, `daysPerStep`, worker/config are the raw material this repurposes), 013 (event engine), 003/save (compression + id-based serialization).
- **Supersedes / retires:** the **per-load** history bootstrap from 036 (`GameManager.runBootstrap`, `bootstrap.worker.ts`, `bootstrapWorkerFactory.ts`, `BootstrapLoader.tsx`, `json/bootstrap.json`). Their *logic* is repurposed into an offline generator; the browser worker/overlay are removed.

---

## 0. Why this exists (the paradigm)

TownBox is **not** a Cities-Skylines/SimCity "grow the biggest city" game. It is a **high-fidelity simulation of
individuals** — the interesting object is a *person* and their intertwined life story (family, work, illness,
love, conflict, mobility), surfaced by the inspectors (027) and feed (029) and, later, by gameplay mechanics
that make the player care about specific individuals.

036 proved the detailed event engine can manufacture real life histories, but also proved that running it
**per load** is a bad trade: even 8 years over a ~3k-living pool costs ~18s, and a genuinely deep run is
minutes-to-hours (the living pool is thousands and *grows*). So doing it every new game forces a permanent
compromise on depth.

**The reframe:** run the deep, no-compromise simulation **once, offline** (a run of a couple of hours is fine),
and **save the result as a versioned data asset**. The asset is a large, static genealogy — dozens/hundreds of
intertwined family groups, thousands of people, across centuries, each carrying a rich event history. At **new
game** the game does **not** simulate: it **selects** a slice of that asset — a random time window, with
identities re-randomized — as the starting world. Because the asset is deep and the selection is windowed +
re-identified, the space of distinct starting scenarios is enormous; a player will almost never see the same
story twice, and the asset can feed far more variety than any player will consume.

This task is two halves:

- **Part A — the offline generator** (`scripts/…`, run via a one-liner): produce the versioned history asset.
- **Part B — asset-fed new game**: retire the live bootstrap; on new game, load the committed asset, pick a
  window, re-randomize identities, and start there.

Maintainer decisions already taken (see §7):
- **Population bounding:** a **soft carrying capacity** (fertility throttles toward replacement as the living
  count approaches a target band) so the population self-stabilizes in the thousands. Configurable / disable-able.
- **Asset storage:** commit **one** compressed, versioned **default asset** (so a fresh clone runs out of the
  box) under `src/assets/history/`; weekly re-runs overwrite/version it via PRs. Revisit (Git LFS or a smaller
  committed sample) if the measured size is uncomfortable for git history (say > ~10–15 MB).

---

## 1. Background / current state (verified)

- **036's core** is `game/HistoryBootstrap.ts` `bootstrapHistory(state, params, onProgress)`: it constructs a
  filtered `EventEngine`, then for `tick` from `-(years·tpy)` to `-1` builds the living-id list
  (`Object.values(pool).filter(isAliveAt)`) and calls `engine.simulateDay(state, ids, tick, tpy, {}, stepDays)`.
  It mutates the pool (engine-driven births/deaths) and returns the accumulated `EventHistoryTable`.
- **Two 036 compromises** exist precisely so the per-load version was tractable — this task removes/inverts them
  (offline, we *want* full fidelity):
  1. **`marriage` is excluded** from the bootstrap manifest (`bootstrapManifest()` drops events whose non-subject
     roles need a `where` candidate search) because it is O(agents) per single adult. Offline we **re-include**
     it so the engine itself forms marriages (full fidelity), accepting the cost.
  2. **`daysPerStep`** (added to `EventEngine.simulateDay`, default 1) let 036 step weekly. Offline the default
     is **1 (daily)**; `daysPerStep` stays as a configurable knob, disabled (=1) by default.
- **`EventEngine.simulateDay(state, agentIds, tick, ticksPerYear, adapters?, daysPerStep?)`** runs the full
  resolver over an arbitrary agent set against the pool — it is not intrinsically tied to the materialized world
  (036 already used it pool-wide). With **no adapters**, employment/housing/skill/money events don't fire (they
  need the on-map economy); this asset therefore covers the **pool-intrinsic** events (birth, death, marriage,
  had_sex, pregnancy, divorce, illness/injury/recovery, education-as-record, friendship/argument). That is the
  right scope — the on-map economy layers on at play time.
- **`generatePopulation(seed, params)`** (`game/Population.ts`) deterministically builds a whole multi-generation
  tree via a coarse forward pass (founders → `pairUp`/`birthChildren` → lifespans). For this task we only need
  its **founder creation** primitive (100 founders); the *engine* does the breeding, so the coarse descendant
  generation is not used by the asset path.
- **Compression:** `util/compress.ts` `compress(json)` / `decompress(payload)` (pako-deflate + base64, sync,
  works in browser and Node). Reuse it for the asset payload.
- **Save format:** `types/Save.ts` — id-based, versioned `WorldSnapshot`; the pool (`PopulationState`, v2) and
  per-person `eventHistory` (v5) already serialize. An in-progress game already round-trips; **asset selection
  happens only on NEW game**, after which the (rebased, re-identified) world saves/loads normally.
- **New-game flow (036):** `GameManager.postSceneInit` generates the pool then `await runBootstrap()` before
  `gameInitialized`; `main.tsx` shows `BootstrapLoader`. **This task replaces `runBootstrap` with asset
  selection** and removes the loader/worker.
- **Tooling:** no `scripts/` dir, no `ts-node`/`tsx` yet; alias imports (`game/*`, …) resolve via `tsconfig`
  `paths` (Parcel/tsc). The offline script needs a Node TS runner with alias resolution (see §3.6).

---

## 2. Part A — the offline generator

### 2.1 Phased algorithm

A deterministic function of `(seed, generatorParams)`. Three phases:

**Phase 0 — Founders.** Create `founderCount` (default **100**) founding people — paired into starting couples
with plausible ages — reusing the founder-creation logic from `generatePopulation` (extract a small
`createFounders(seed, count)` primitive; do **not** run the coarse descendant generation). Tick starts at 0.

**Phase 1 — Warm-up (grow to the recording threshold).** Run the **full-fidelity** engine forward day-by-day
from the founders, letting marriages/births/deaths emerge, **until the living count first reaches
`recordThreshold` (default 1,000)**. Warm-up exists only to grow a demographically-mature population from a tiny
seed; its casualties are scaffolding. **Do not preserve the history of people who die during warm-up** — prune
them from the asset entirely (they are the "first few generations with poor history"). People **alive at the
threshold tick** are kept *with* their accumulated warm-up histories (they are already rich — that's the point),
and this **threshold tick becomes the asset epoch** `t0`.

**Phase 2 — Recording (the deep run).** From `t0`, simulate **`recordYears` (default 500)** more years at full
fidelity, **preserving everything**: every living person, everyone who is born, and everyone who **dies after
`t0`** (their completed life stories are the richest content), all with full event histories. Emit progress
(years done, current living count) to the console.

**Output.** The asset = { all people alive at `t0` } ∪ { everyone born after `t0` } ∪ { everyone who died after
`t0` }, minus the warm-up-only dead, with the full `EventHistoryTable` for the retained people, plus a metadata
header (§2.5).

### 2.2 Full fidelity (compromises removed, but configurable)

- **Re-include `marriage`** (and any other candidate-search events): run the complete default manifest. The
  O(agents) partner search is acceptable offline. (Consider a *bounded* candidate scan — e.g. sample K eligible
  singles rather than scanning all — as an optional perf knob if runtime is intolerable; keep the unbounded,
  exact search as the default "no-compromise" path.)
- **`daysPerStep` = 1** (daily) by default; expose it as a config knob (disabled) for cheaper draft runs.
- Every fidelity compromise 036 introduced must be **either removed or configurable-and-disabled-by-default**, so
  the canonical asset is the highest-fidelity the engine can produce.

### 2.3 Soft carrying capacity (decision §7-A)

Left uncapped, the population trajectory is emergent and may explode over 500 years (→ millions, a multi-GB
asset, an infeasible run). Add a **data-driven fertility throttle** so it self-stabilizes in the thousands:

- A `carryingCapacity` config: a target band (e.g. `soft: 3000`, and a `steepness`). Each recording step, scale
  the **`pregnancy`** probability by a factor that → 1 well below the target and → ~replacement (or lower) as the
  living count approaches/exceeds it (a logistic/`Curve` over `living / soft`). Implement as an engine-level
  global probability multiplier passed into `simulateDay` (a natural companion to `daysPerStep`), or as a
  pre-step manifest adjustment — **do not** hard-edit `events.json` (the live game must keep its own rates).
- **Disable-able** (uncapped) via config for experiments. Deaths/histories are never throttled — only births.
- **Determinism preserved** (the throttle is a pure function of the living count, which is deterministic).

> The exact target band + curve will need a couple of calibration runs (draft runs with `daysPerStep>1`) to land
> a stable "thousands" equilibrium; the script must print the trajectory so it's tunable.

### 2.4 Performance for a centuries-long run

Offline, hours are acceptable — but the run must *terminate* in a tolerable wall-clock and not blow memory:

- **Incremental living index (required).** 036 rebuilt the living list with `Object.values(pool).filter(...)`
  every tick — O(pool) per tick, and `pool` grows to include every dead person ever. Over centuries that is
  quadratic-ish and dominates. Maintain a **live `Set<PersonId>`** updated incrementally: add newborns, remove
  the tick's deaths. Recompute from scratch only once at load.
- **Marriage candidate search** remains the other cost centre; the optional bounded-scan knob (§2.2) mitigates it
  if needed.
- Consider periodic **progress checkpoints** and a `--max-hours`/`--max-people` safety valve that stops recording
  early and still writes a valid (shorter) asset, so a runaway run is recoverable.
- Memory: the retained pool + histories are held in RAM until write; if that's too large, stream/checkpoint to
  disk. Measure first (§6).

### 2.5 Asset format & versioning

A single compressed file under `src/assets/history/` (committed default, decision §7-B), e.g.
`history-v<generatorVersion>-<shortSeed>.tbz` (or `.json.z`). Structure (pre-compression):

```
{
  "meta": {
    "formatVersion": 1,          // asset schema version (bump on shape changes)
    "generatorVersion": "…",     // bumped when the sim/events change materially (drives re-seeding)
    "seed": 123456,
    "params": { founderCount, recordThreshold, recordYears, carryingCapacity, daysPerStep, … },
    "createdAt": "ISO-8601",
    "gitCommit": "…",            // provenance for reproducibility
    "epochTick": t0,             // the recording-start tick (asset-relative)
    "endTick": t0 + recordYears·tpy,
    "ticksPerYear": 360,
    "stats": { retainedPeople, livingAtEnd, births, deaths, medianHistoryLen, rawBytes, compressedBytes, runtimeMs }
  },
  "population": PopulationState,  // retained pool (id-based), reusing the save's shape
  "eventHistory": EventHistoryTable
}
```

- Reuse `util/compress.ts` for the payload. Reuse `types/Genealogy.PopulationState` +
  `types/LifeEvent.EventHistoryTable` shapes (so the game consumes them with existing machinery).
- **Versioning workflow:** the maintainer re-runs the generator every few weeks as event variety grows; each run
  bumps `generatorVersion` and overwrites the committed default (via PR). The game validates
  `formatVersion` on load (and can warn on `generatorVersion` mismatch).

### 2.6 The one-liner + runner

- `npm run generate-history` (e.g. `"generate-history": "tsx scripts/generateHistoryAsset.ts"`). Add a lightweight
  TS runner (`tsx` recommended — justify the dev-dependency in the PR) with **tsconfig-path alias resolution**
  (`tsx` + `tsconfig-paths`, or write the script with relative imports / a tiny alias register). The script must
  run in **Node** (no browser); it reuses the pure `bootstrapHistory`-derived core, **not** the browser worker.
- CLI flags override config for calibration: `--seed`, `--years`, `--threshold`, `--founders`, `--capacity`,
  `--step-days`, `--max-hours`, `--out`. Defaults come from a new `json/historyGenerator.json`.
- On completion, **print the measurements** (§6) and write the asset.

### 2.7 Determinism

Same `(seed, generatorParams, generatorVersion)` → **byte-identical** asset. The engine already forks its RNG per
tick from the world seed; the carrying-capacity throttle and incremental index must stay pure. This makes assets
reproducible and lets tests assert stability on a tiny config.

---

## 3. Part B — asset-fed new game

### 3.1 Retire the live bootstrap

Remove `GameManager.runBootstrap`, `bootstrap.worker.ts`, `bootstrapWorkerFactory.ts`, `BootstrapLoader.tsx`,
`json/bootstrap.json`, and the `bootstrapStarted/Progress/Finished` events. Revert the `main.tsx` overlay wiring
(HUD mounts on `gameInitialized` as before). Keep the `EventEngine.simulateDay` **`daysPerStep`** parameter (it's
generally useful and the generator uses it). Keep `HistoryBootstrap`'s reusable loop only insofar as the generator
reuses it (move shared code into the generator/core; delete the browser-only pieces).

### 3.2 Load + validate the asset

On new game (`pendingLoad === null`), instead of generating + bootstrapping: **load the committed default asset**
(import or fetch under `src/assets/history/…`), `decompress`, `JSON.parse`, validate `formatVersion`. If missing/
incompatible, fall back (§3.7).

### 3.3 Window selection (different time periods)

Pick a random **present tick** `w` uniformly in `[t0 + warmMarginYears·tpy, endTick]` — the `warmMarginYears`
(e.g. 30–60) skips the shallow-ancestry period right after the epoch so the chosen living cohort has deep
lineage. `w` becomes the game's "now". Then **slice** the asset:

- **Keep** everyone with `birthTick ≤ w` (they exist at/by now): the living cohort (`isAliveAt(p, w)`) plus their
  ancestors/deceased (needed for family trees + kinship).
- **Drop future** people (`birthTick > w`) and **truncate histories** to events with `tick ≤ w` (nothing from the
  asset's "future" leaks in).
- Anyone who died at/before `w` keeps their (now-complete) story; the living keep their history-to-date.

### 3.4 Tick rebasing

The game clock starts at 0, so rebase the slice by `−w`: subtract `w` from every `birthTick`, `deathTick`, and
history `lastTick`. Ages (`ageAt` against tick 0) and event recency (`hasEvent withinDays` of tick 0) then read
correctly at game start. `nextSeq` continues from the sliced max. `lastSimulatedYear` set to 0.

### 3.5 Identity randomization

Per new game, re-roll **names only** (`firstName`/`familyName` via seeded faker), preserving gender, the kinship
graph, ticks, partnerships, and histories — so the same underlying story reads as a *different* family each time.
Family-name coherence: re-map by lineage (a person inherits a re-rolled family name from their father's line, as
generation does) so surnames stay consistent within bloodlines. Deterministic per a fresh per-game seed (so a
save reproduces its identities). Scenario variety = choice of asset × window `w` × identity seed — a vast space.

### 3.6 Materialization unchanged

Household draw (`HouseholdDraw`/`Population.drawHousehold`) and materialization (`City.setupHousehold`) work
**as-is** on the sliced pool — drawn residents now simply arrive with populated `EventEngine` history (no cold
start), which is the whole point. Verify the draw against a pool whose living cohort came from an asset window.

### 3.7 Fallback

If no compatible asset is present (shouldn't happen with the committed default), the game must still start:
either a tiny built-in sample asset, or a minimal `generatePopulation` pool with empty histories (the pre-036
behaviour). Document the chosen fallback; log a warning.

### 3.8 Save/load

Unchanged and unaffected: once a new game has selected+rebased+re-identified its world, it saves/loads via the
existing `WorldSnapshot` (the asset is not re-consulted on load). No `SAVE_VERSION` bump.

---

## 4. Relationship to the coarse live sim (036 follow-up)

This task seeds a rich *starting* world; it does **not** by itself resolve the live two-fidelity split — during
play the coarse `Population.simulate` still advances off-map people while Engine B owns materialized ones. Full
live one-fidelity (running the detailed engine over the whole living pool each in-game day) remains the separate,
perf-gated follow-up noted in 036 (bounded growth + incremental living index — **both built here** — plus the
marriage role-search optimisation). Note the overlap: the incremental index and carrying-capacity work from this
task are prerequisites that task can reuse.

---

## 5. Determinism, testing

- **Generator core** (pure, Node-testable on a *tiny* config — e.g. founders 20, threshold 40, years 5): same
  seed → identical asset; warm-up dead are pruned; retained people carry history; carrying capacity bounds the
  living count; incremental living index matches a brute-force `filter` recompute (invariant test).
- **Window selection + rebase + re-identify** (pure): slicing at `w` keeps only `birthTick ≤ w` and truncates
  histories to `≤ w`; rebasing yields correct ages/recency at tick 0; identity re-roll preserves the graph +
  gender + ticks and only changes names; deterministic per identity seed.
- **Round-trip:** an asset → new-game world → save → load reproduces the world.
- Keep these in the fast Jest suite (tiny configs); the full multi-hour generation is **not** a test.

## 6. Measurements the generator must report (and the maintainer's three questions)

The script prints, and the asset `meta.stats` records, at least: **final living population** at 500 years;
**total retained people** (living + dead-after-epoch); **births/deaths**; **raw vs compressed bytes**;
**wall-clock runtime**; and the **population trajectory** (living count sampled per decade). These directly answer
"how many at the end", "how big on disk", "how long to run" — to be filled in from the first real run and used to
calibrate the carrying capacity and confirm the git-commit decision (§7-B).

*Rough, pre-measurement expectation (to be replaced by real numbers):* with the carrying capacity holding the
living band at a few thousand, 500 years turns over ~15–16 generations, so **total retained** likely lands in the
tens of thousands of people; at ~0.5–1 KB of compressed history per person that is **single-digit to low-tens of
MB compressed**; runtime is the unknown (036's daily cost suggests **~1–3 hours** for a daily 500-year run over a
few-thousand-strong pool, less with the incremental index). These are guesses — the run decides.

## 7. Decisions (locked)

- **A. Population bounding:** soft carrying capacity (fertility throttle toward replacement near a target band),
  configurable/disable-able. *(maintainer, this task)*
- **B. Asset storage:** commit one compressed, versioned **default** asset under `src/assets/history/`; regenerate
  locally and version via PRs; revisit LFS/sample if size is uncomfortable for git (> ~10–15 MB). *(maintainer)*

## 8. Out of scope

- On-map/economy events in the asset (no economy exists off-map; they layer on at play time).
- Multiple concurrent asset packs / culture-biome variety (a natural future extension; the format's `meta`
  leaves room).
- Live one-fidelity retirement of the coarse sim (separate 036 follow-up; §4).
- Player-visible generator UI (it's a CLI/dev tool).

## 9. Acceptance criteria

- `npm run generate-history` runs the full-fidelity, phased (100 → 1,000 → +500y) deterministic generation with a
  soft carrying capacity, prints the measurements, and writes a compressed, versioned asset committed under
  `src/assets/history/`.
- Warm-up-only dead are excluded; retained people carry rich histories; the living population stays bounded.
- A **new game** loads the committed asset, selects a random window, rebases to tick 0, and re-randomizes
  identities — so drawn households arrive with real histories and repeated new games yield different scenarios.
- The live 036 bootstrap (worker/overlay/`runBootstrap`) is removed; new-game load is fast.
- Determinism holds (asset per seed/params; per-game world per identity seed); world round-trips through
  save/load; `npm test` passes with generator + selection unit tests (tiny configs).

## 10. Notes / suggested sequencing

- **Phase 1 (this task's core):** extract the shared engine loop + incremental living index; build
  `generateHistoryAsset` (founders → warm-up → record) with carrying capacity; the CLI + one-liner; report
  measurements; commit a first (possibly draft-fidelity) asset.
- **Phase 2:** the game-side selection/rebase/re-identify + retire the live bootstrap + fallback.
- **Phase 3:** calibrate the carrying capacity and fidelity from the measured trajectory; regenerate the
  canonical asset.
- Land Part A before Part B (Part B needs an asset to consume; a tiny fixture asset unblocks Part B tests).
