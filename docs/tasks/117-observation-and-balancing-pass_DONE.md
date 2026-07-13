# [Task] The observation & balancing pass

- **Type:** Task (playtest + tuning)
- **Labels:** `simulation`, `balance`, `playtest`, `visibility`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-visibility.md`](../proposals/simulation-visibility.md) — task 117.
- **Deliverable:** [`docs/proposals/visibility-balancing-notes.md`](../proposals/visibility-balancing-notes.md).

## Goal

The payoff session: with both arcs landed, observe the simulation actually running, confirm aspects are
observably working and coherent, and rank what reads wrong for tuning.

## What shipped

1. **The scaffolding** (with the visibility arc): the `T` time-throttle (1× / 4× / 16×,
   `util/time.ts` `nextTimeScale`) and the masterSwitch-gated vitals overlay in `MainScene` / `GameManager`.
2. **The observation** — done headless through the same engines (the live Phaser renderer stalls in the
   available headless environment): a fully-hourly two-band generated cohort decoded with `decode-person` +
   a cohort histogram, plus the map layer confirmed by its green end-to-end suites. The simulation is
   **observably working**: the day has a shape (8h sleeps, the Part-0 24h-sleep artifact gone), the food
   chain connects (`bake_cake` completes — the 206/206-blocked flagship, closed), interactions are
   reciprocal and targeted, `had_sex` is down from 84% → 18% of events, and the new loops (garbage, pets,
   crime, illness→recovery, interruptions) fire coherently.
3. **The balancing notes** — `docs/proposals/visibility-balancing-notes.md`: ranked findings with
   recommended follow-ups. No manifest tuning was applied in this PR: the top items are structural (a
   `receiving_treatment` patient-side seek guard) or need a live-play regeneration to validate (the crime
   rate reads high off-map only because the generator binds no police consequence). Per the arc's rule,
   structural findings are proposed follow-ups.

## Remaining (deferred, documented in the notes)

- A live-visual eyeball with the `T` throttle once a working renderer is available (the headless observation
  + the E2E suites cover the substance).
- The recommended tunings, to be applied and validated against a full asset regeneration.
