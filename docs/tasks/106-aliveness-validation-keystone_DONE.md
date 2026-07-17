# [Test] The aliveness validation keystone

- **Type:** Test
- **Labels:** `test`, `simulation`, `aliveness`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-aliveness.md`](../proposals/simulation-aliveness.md) — Phase 6,
  task 106. The arc's acceptance checklist (Part 8 traceability).

## Goal

Assert the *new* invariants the whole arc exists to produce — the emergent chains, not the individual
mechanisms — and prove they arise from data multipliers with zero scripting.

## What shipped

`test/execution/alivenessArcs.test.ts` — the cross-system scenario suite in the 075 tradition:

- **grief → coping → recovery** (a bereavement impulse raises coping-action weights; social visits lift the
  person out),
- **desperation → crime → chase → justice** (arrears + low mood gate theft; the co-located officer chase
  resolves; the record makes rehiring harder),
- **decay → fire → displacement** (a derelict building ignites, the survival-band evacuation fires, the
  household rehouses),

all emergent from the data multipliers, plus live↔bootstrap equivalence over the new hook and band paths,
and the Part 0 metrics re-measured against 080's pins as the "after" evidence.
