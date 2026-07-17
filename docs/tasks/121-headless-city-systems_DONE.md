# [Fix] Headless city systems — the off-map world stops dropping live play's loops

- **Type:** Bug fix / Simulation
- **Labels:** `simulation`, `generator`, `aliveness`
- **Status:** ✅ Done
- **Branch / PR:** `task/generator-performance-2` → [PR #100](https://github.com/Maudfer/townBox/pull/100)
- **Depends on:** [112](112-household-garbage_DONE.md) (whose collection loop was live-only — the gap that
  triggered the sweep); [120](120-generator-perf-byte-identical-pass_DONE.md) (which convicted the garbage
  accumulation as a perf term and flagged the simulation gap).

## The sweep

Task 120's diagnosis showed the generator's off-map world accumulating garbage nothing collects. Before
fixing it, a systematic sweep diffed **everything City runs in live play** (its `handleTick` onCommitted
signal/commit reactions, the `handleNewDay` loops, the monthly economy) against what the generator's
TickPlan + LogicalWorld actually replicate. Findings:

1. **Garbage was never collected** — live collection rides the garbage collector's work actions, and no
   work actions run off-map at all (no `jobOf` in the generator's TickPlan, by 077 design).
2. **Every live signal/commit reaction was dropped**: `partnershipFormed` (cohabitation), `crimeCommitted`
   (incident filing), `chaseConcluded` (arrests), `petAdopted` (adoption), `shared_gossip` transfers, and
   the jail/sick-visit counterparts (`received_a_visitor`, `was_visited_while_sick`). Off-map consequences:
   couples married by the 119 pairing (or engine marriages) never shared a home; crimes had no justice chain
   (no convictions, no impunity — the 095 crime-habit feedback underfed); adoptions fired as ghost events
   (uncapped, no registry, no lifecycle); gossip never traveled; sick visits never lifted the patient.
3. **Adults never moved out** (the 077 §9 "no move-out churn" open decision) — households were frozen natal
   groups forever.
4. **No money existed off-map** (`ledger` absent → `money` read 0 for everyone): the `money < 150` poverty
   modifiers were always on, `money >= 400` content was unreachable, purchases were free.
5. Non-gaps, verified and documented: services coverage absent already reads the configured
   `neutralCoverage` (the right abstract-town posture); building conditions/fire remain live-only (map
   physics); business P&L/demand remains live-only (needs the map's business roster).
6. **A live-side finding flagged for the maintainer** (not fixed here): nothing in the 730-event manifest
   emits the `movedOut` signal, so City's live `resolveMoveOut` handler looks orphaned — live move-out may
   have regressed silently when the manifest was regenerated (task 052).

## What shipped

All in `game/history/LogicalWorld.ts` + the generator loop (`HistoryAsset.ts`), mirroring City's rules with
the same salted-RNG conventions; `generatorVersion` 119.0 → **121.0** (world content changes):

- **Stores wired**: `CityIncidents`, `DetentionRegistry`, `PetRegistry`, `KnownFacts`, and a real `Economy`
  now live on LogicalWorld and ride `tickFacts` markets (`ledger`/`incidents`/`pets`/`knownFacts`), plus
  `detentionOf` facts into the TickPlan (the detained hook and the planner's jail visits light up off-map).
- **`handleTickOutcomes`** — the off-map analogue of City's onCommitted block: cohabitation on
  `partnershipFormed`, incident filing on `crimeCommitted` (kind from the log, witnesses from real
  co-location), the chase→arrest→conviction→detention chain on `chaseConcluded` (same catch-chance formula,
  record-scaled sentences at the abstract facility), adoption on `petAdopted` (cap-gated species draw),
  gossip transfers, and both visit counterparts.
- **Household churn**: `cohabit` (larger household stays, mover brings dependent minors — the live rule) is
  driven by the marriage signal AND directly by the 119 pairing (which bypasses the engine, so
  `pairUnpartneredAdults` now returns its couples); `moved_out_of_parents` commits relocate adults living
  with a parent into a fresh home (their minors and co-resident spouse follow). The event is effect-free
  texture, so the reduced manifest never rolled it — `GENERATOR_CONSUMED_EVENTS` now unions it into the
  walk.
- **Day sweeps in `runDaily`**: curbside garbage collection, police work (cold-case impunity + resolution at
  `neutralCoverage`), sentence releases, pet lifecycles.
- **The monthly money loop**: adults arrive with the live starting stake; wages flow monthly from the
  logical salary (external-mirrored), and the cost of living mirrors `City.runCostOfLiving` — purchases net
  off the charge (floored at housing), households drain available funds member-by-member, **never forced
  negative**. Money stays conserved (people + external invariant). No arrears/evictions/business P&L
  off-map (elastic housing) — documented divergence.

## Verification

A 3-hot-year, 60-founder run of the real loop, before → after: curbside bags **25,023 → 0**; married
couples cohabiting **0 → 26 of 28**; adult balances a real spread (−11k…+80k, conserved) instead of a flat
0; and the histories now carry the chains — 175 `got_caught`, 143 `was_detained`, 129 `released_from_jail`,
44 `moved_out_of_parents`, 370 `received_a_visitor`, 2,123 `was_visited_while_sick`, 108 capped adoptions.
`test/history/logicalCitySystems.test.ts` pins each mechanism (cohabitation rule + dependent minors,
move-out relocation, the garbage sweep, starting funds + cost-of-living + conservation, pet cap + lifespan
grief, gossip transfer, sick-visit counterpart, detention round-trip). Full suite green (1,836 tests).

Observed-for-balancing (not plumbing): at `neutralCoverage` almost every witnessed case resolves
(`got_away_with_it` is rare), and the shipped crime/adoption rates produce ~175 convictions and ~1.7
pets/adult over 3 years — numbers for the maintainer's balancing radar, tuned in data.
