# [Data/Tooling] Aliveness quick-wins + the person-history decode diagnostic

- **Type:** Data pass + Tooling
- **Labels:** `simulation`, `data`, `tooling`, `aliveness`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-aliveness.md`](../proposals/simulation-aliveness.md) — Part 5
  (quick wins) + K4 (the decode diagnostic). Phase 1, the first task of the arc.

## Goal

Stop the worst incoherences the Part 0 audit found before the framework work lands, and pin the "before"
metrics the arc's validation keystone (106) re-measures against. These are pure-data manifest edits plus
one permanent diagnostic — no engine change.

## What shipped

1. **The quick-win manifest edits** (`json/events.json`): `had_sex` `perYear: 60 → ~12` (it was 84% of a
   life's events — the single biggest driver of log noise); `get_job` `perYear: 4 → 26` (≈ 2-week expected
   wait, a stopgap ahead of 097's visible seeking, safe because `canBeHired` already gates the roll);
   illness minimum-duration (`recovered` inverse-gated on `fell_ill within > 48 ticks`, `perYear 24 → 18`)
   so nobody is cured within two days; and gates on the most-incoherent texture events (the
   `argued_with_partner`-without-a-partner class) — a taste of the 091/094 coherence pass.
2. **The decode diagnostic** (`scripts/decodePersonHistory.ts`, `npm run decode-person`): promotes the
   audit's throwaway decoder into a permanent tool emitting the timeline/frequency views used in Part 0, so
   the audit is repeatable after every generator change and the Part 0 numbers become the arc's benchmark.
3. **The before-metrics pinned** in the proposal's Part 0 / traceability matrix (Part 8): the
   sleep-dominated frequency table, `bake_cake` 206/206 blocked, the median-553-carried number.

Nothing was deleted; every edited event kept its identity, only its trigger/gates changed.
