# [Perf] Byte-identical generator perf pass — flatten the super-linear per-agent costs

- **Type:** Performance / Simulation
- **Labels:** `performance`, `simulation`, `generator`
- **Status:** 🔄 In progress (wave 1 landed; a long-workload profiling pass + wave 2 remain)
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

## Remaining work (this branch)

1. **A long-workload profile (~20 recorded years, default-shaped params)** — short profiles cannot see costs
   that grow with run length (log volume between flushes, GC pressure, any residual per-person accumulation).
   Profile the post-wave-1 generator over a workload long enough to expose growth, comparing early-vs-late
   step rates.
2. **Wave 2**: whatever that profile convicts, under the same byte-parity constraint and verification
   protocol (identical-seed before/after runs, file-for-file comparison).
3. Mark this file `_DONE` with the final measurements when the pass closes.
