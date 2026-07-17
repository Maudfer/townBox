# [Fix] Generator extinction — off-map courtship + the extinct-warm-up bail

- **Type:** Bug fix / Simulation
- **Labels:** `simulation`, `generator`, `population`
- **Status:** ✅ Done
- **Depends on:** the romance arc ([090](090-romance-arc_DONE.md)); the two-band generator ([105](105-generator-two-band-and-regeneration_DONE.md)).

## The problem

The maintainer's first full default regeneration after the aliveness arc went **extinct**: 100 founders → 183
peak → 0 living over 100 years (98 births / 198 deaths), 0 retained people, after a 1h29m run that burned the
full 400-year warm-up ceiling.

Root cause — not the population thermostat (which was working): the romance arc (090) gates `pregnancy` on a
real **spouse** edge, `had_sex` on a partner-or-dating edge, and `marriage` on an engagement — edges that only
form through the Brain's social **actions**, which the off-map logical world runs far too sparsely for the
second generation to pair up. The pre-married founders reproduce, age out, and births run at roughly half of
deaths. The thermostat scales the pregnancy *hazard*, which is gated to zero by the missing spouse — it was
pushing on a nailed-shut door.

## What shipped (commit `0fa151c`, docs `a4c08e4`)

1. **`pairUnpartneredAdults`** (`game/population/Population.ts`, **generator-only** — `LiveWorld` never calls
   it, so real on-map dating/engagement/marriage is untouched): each step the generator marries a bounded,
   deterministic fraction of compatible unpartnered adults (18–45, age gap ≤ 12, non-siblings, nearest-age
   pick on a salted RNG fork), Poisson-honest per stride so the daily and hot bands agree. The rate runs full
   while the living count is below the thermostat target and drops to a trickle above it — the thermostat's
   intent applied at the real bottleneck (pairing, not fertility). Wired as
   `populationControl.pairRatePerYear` (default 1.5) in `json/historyGenerator.json` + the params validator.
2. **Extinct-warm-up bail**: warm-up stops the instant the living count hits 0 — a 0-population never
   recovers, so grinding the remaining (up to ~400) warm-up years was pure fixed per-step overhead (the bulk
   of the extinct run's runtime).

`generatorVersion` 078.0 → 119.0 (the pairing consumes RNG, so the stream changes).

## Verification

- Diagnostic reproduction: rate 0 = extinct at year 100; rate 1.5 = stable ~239–263 around the 250 target.
- Real-generator dev run (threshold 120): records with 132 living, 33 births / 1 death (was extinct).
- `test/population/pairing.test.ts` pins eligibility (age band, gap, siblings, already-married, determinism);
  the warm-up edge-case suite covers the extinction bail vs. the `maxWarmupYears` ceiling.
