# [Task] Live-app verification of the clock & population simulation

- **Type:** Verification / QA
- **Labels:** `qa`, `verification`, `simulation`, `time`

> **Status: placeholder.** Created as a backlog stub from the 004d/005 follow-up notes. **Not yet
> detailed — run a fresh exploration pass before executing** (verify the references below against
> current code).

## Summary

The clock/calendar (`005`) and the live population simulation (`004d`) are currently covered by **unit
tests + `tsc` only** — they have **not been exercised in the running Phaser app**. This task is a
manual (and, where practical, automatable) verification pass in the actual game to confirm the systems
behave correctly end-to-end and look right.

## Background / current state (verify during exploration)

- The clock is driven from `MainScene.update` → `GameManager` (`advanceTime`), exposed as `game.clock`,
  and shown by the HUD widget `src/app/hud/Clock.tsx` (fed by the `timeChanged` event).
- The live simulation runs in `City.handleNewDay()` (on the `newDay` event) → `Population.simulate()`.
- 1 in-game day = 1 real hour, so natural changes are **slow** to observe — a temporary debug
  time-scale / fast-forward would make verification practical (note: pause/fast-forward was explicitly
  out of scope for `005`).
- Run via `npm run dev` (Parcel + browser-sync).

## Things to verify (to refine later)

1. The HUD clock widget appears and advances; date/time format is correct; years count from Year 1.
2. Placing a **house** spawns a coherent household; the family-tree window renders, showing
   cross-household links and **deceased** ancestors (dimmed / †).
3. Over (accelerated) time, residents **age**, some **die**, and dead residents **despawn** and leave
   their house/household; new **births** appear in the pool.
4. **Save → reload** resumes at the saved date/time and preserves the population/households.
5. No console errors, leaked sprites, or perf cliffs when the yearly simulation runs over a populated
   city.

## Deliverables

- A short verification report (pass/fail per item, with screenshots where useful) and bug tickets for
  anything found.
- Optionally, a small **debug time-scale** toggle (gated by `json/config.json`) to make the above
  observable — or a follow-up ticket for it.

## Notes

- Covers `005-clock-and-calendar-system_DONE.md` and the `004d` work in
  `004-household-generation-redesign_DONE.md`. Consider whether a lightweight Playwright/Claude-preview smoke
  check could automate part of this.
