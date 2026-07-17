# [Perf] Byte-identical generator perf pass — flatten the super-linear per-agent costs

- **Type:** Performance / Simulation
- **Labels:** `performance`, `simulation`, `generator`
- **Status:** ✅ Done
- **Branch / PR:** `task/generator-performance-2` → [PR #100](https://github.com/Maudfer/townBox/pull/100) (against `main`, stacked on #99)
- **Depends on:** [118](118-generator-perf-pass_DONE.md) (the 078/079 profiling playbook); [119](119-generator-extinction-fix_DONE.md) (the run this pass profiles is the 119-fixed generator).

## Goal

The maintainer's first full post-119 regeneration (250 living × 100 years, default params) ran ~7–9 h against
a ~1.5 h projection. Find and remove the costs responsible — under a hard constraint the earlier passes never
had: **full byte parity of the generated asset for the default params** (same seed ⇒ same bytes, no
`generatorVersion` bump). Only behavior-invisible changes qualify: indexes, memos of pure/immutable functions,
provably-no-op work removal.

## Diagnosis (profiled at two capacities to expose the scaling terms)

| µs/agent-step (1 hot year) | cap ~60 | cap ~158 |
| -------------------------- | ------- | -------- |
| planner hook               | 10.8    | 28.3 (+161%) |
| socialOpportunity (incl. target) | 8.2 | 26.8 (+228%) |
| social:target              | 3.8     | 21.0 (+454%) |
| TOTAL                      | 71.1    | 110.9    |

- **`SocialGraph.edgesOf` scanned the entire global edge table per call** (the planner's `visiting_friends`
  producer + the `partnerOrDatingOf`/`engagedOf` event role binds). The table grows with population AND with
  elapsed run time: pruning is lazy-on-read, so a drifted-apart pair's dust edge is never physically deleted
  until one of them dies — the run gets slower every simulated year. This growth term is invisible in short
  profiles and is the prime suspect for the full run's degradation.
- **`resolveStanding` derived direct family per co-located pair** — the `siblingsOf` leg scans the whole
  ever-lived pool, and the social hook's target weighting calls it for every companion: O(company × pool)
  per proposal.
- The free-time/need/social candidate picks **re-sorted their filtered candidate lists** per person per tick
  with `localeCompare` — the source lists are already sorted with the same comparator at build, so the sorts
  were provable no-ops.
- The daily **spoilage sweep iterated the whole instance table** (grows with population; only 12 of 1,517
  archetypes can expire).

## Wave 1 — shipped (commits `d8a3ac7`, `39264fc`, `802b835`)

1. **Per-person adjacency index on SocialGraph** (`Map<person, Set<pairKey>>`, maintained at the create/delete
   points, rebuilt on load): `edgesOf`/`removePerson` never scan the global table. Same edge sets, same
   sorted output.
2. **Family-standing memo** in `resolveStanding` (per-pool WeakMap): parentage is set at creation and never
   reassigned, so the memo needs **no invalidation**; both legs are symmetric, so the unordered pairKey is
   sound.
3. **Dropped the redundant sorts** (the social candidate cache now pre-sorts at build).
4. **Expiring-candidates set** for `Inventory.sweepExpired`, membership maintained through
   create/remove/in-place-transform/load. (No expiring archetype is a container, so the
   remove-throws-on-contents ordering case is unreachable in shipped data.)
5. *Measured and dropped:* memoizing `hashStringToSeed` — the FNV hash of a ~5-char id is cheaper than a Map
   lookup (the profile agreed: `social:rng` = 0.06 µs).

**Results:** capacity-150 fell **110.9 → 70.3 µs/agent-step (1.58×)** and per-agent cost is **flat across
capacities again** (cap-150 now costs what cap-60 did). Same-workload wall clock 339 s → 230 s. The full run
gains more than the short profile can show, because the edge-table growth-over-time term is removed entirely.

**Byte parity:** identical-seed 2-year runs (cap 150) before/after — **162/162 person+section files
byte-identical** (meta identical modulo `createdAt`/`runtimeMs`), verified independently for the wave-1 index
commit and the spoilage commit against the same pre-pass baseline. Regression tests: the index invariants
through every mutation path, memo correctness + pool isolation, spoilage-set membership through load and
in-place transform. Full suite green; perf op-count pins unaffected.

## Wave 2 — the growth term (commit `8becfdb`)

The long-workload instrument (a timestamped 20-recorded-year run at capacity 250, 10 cold + 10 hot) exposed
what short profiles cannot: the cold band was flat (~15–20 s/year), but hot-band years climbed **228 → 303 →
401 → 525 → 574 s** — a per-step cost growing with elapsed simulated time, the exact shape of the
maintainer's 9-hour run. A store-size diagnostic (sampling every persistent store quarterly under the real
hot-band loop) convicted the driver:

- The **object-instance table grows without bound off-map**: `took_out_the_trash` moves garbage bags to the
  `outside` container that nothing collects (the 112 collection loop is live-only — 25k instances after 4
  small-scale years), and homes accumulate created objects (~300/home/year). Every other store (edges,
  action instances, agenda) is bounded.
- Every `objectAtLocation` requirement check, OAR satisfiability probe, purchase-stock lookup, and
  curiosity-grab **scanned the location's whole contents list** — and the hot band runs 24× more such checks
  per simulated day than the daily band.

**Fix (byte-identical):** Inventory maintains **per-container archetype buckets** (containerKey →
archetypeId → ids) alongside `byContainer` — same mutation points, plus the in-place `transformInstance`
swap, rebuilt on load. Every `ObjectQuery` condition (archetype/tag/flag) is an archetype-level property, so
boolean queries answer O(1)/O(distinct archetypes) (`hasMatchingAtLocation`), pick paths get the same
ascending-id order the old sorted-contents walk produced (`matchingIdsAtLocation`), the two instance-level
filters (business stock, curiosity grabs) narrow to qualifying buckets first, and `findStack` merges via the
spec's own bucket. Verified: 162/162 files byte-identical (wave-1 baseline vs wave-2, identical seed); the
re-run store diagnostic shows identical counts with **flat** per-quarter wall time (~5.3 → ~6.1 s over 16
hot quarters) where the cost previously compounded; `inv.contentsBuild` re-pinned 372 → 322.

## At-scale verification (the closing measurement)

The same 20-recorded-year capacity-250 workload, re-run post-wave-2:

| hot year        | 10  | 11  | 12  | 13  | 14  | 15  | 16  | 17   | 18  | 19  |
| --------------- | --- | --- | --- | --- | --- | --- | --- | ---- | --- | --- |
| pre-fix (s)     | 228 | 303 | 401 | 525 | 574 | —   | —   | —    | —   | —   |
| post-wave-2 (s) | 160 | 177 | 204 | 188 | 210 | 200 | 215 | 307* | 228 | 267 |

\* contains a confirmed **85 s flush stall** (the 5-year log drain landing mid-year) — a one-off, not a
trend. Pre-fix was killed at year 14 (still compounding ~+30%/year); post-wave-2 is flat-with-noise around
~200 s with a mild ~4%/year residual (in-flush-window log-RAM/GC — bounded, resets at each drain; left as a
known non-target). Cold years are ~15–20 s in both (never the problem). Whole run: **43 m 31 s**, 97.8
µs/agent-step overall, 241 living / 314 retained, 776 MB on disk.

**Full default regeneration projection: ~1h15m ± 15m** (was 9h+ and unfinished) — warmup ~8 m + 90 cold
years ~24 m + 10 hot years ~39 m + writes. Byte parity means a regeneration on this branch produces exactly
the asset the pre-pass code would have.

## Proposed follow-up (out of scope — NOT byte-identical)

The off-map world's **garbage is never collected** (and homes hoard non-perishable creations): a simulation
gap vs live play (112), not just a perf artifact — the generator's asset carries ever-growing `outside`
stacks. Fixing it (a logical-world collection sweep mirroring the live loop) changes the RNG-visible world
state ⇒ a `generatorVersion` bump; it belongs to its own task, not this pass.
