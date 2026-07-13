# [Feature/HUD] The services nagbar

- **Type:** Feature (React HUD + bus event + data)
- **Labels:** `hud`, `react`, `services`, `visibility`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-visibility.md`](../proposals/simulation-visibility.md) — task 114.
- **Depends on:** [096](096-city-services-ledger_DONE.md).

## Goal

The 096 coverage ledger had a dashboard panel and a monthly feed advisory; give it a prominent, persistent
live surface so the player is told what the town lacks and what it costs.

## What shipped

1. **The nagbar (`hud/Nagbar.tsx`):** a persistent, dismissable top banner naming the worst degraded service
   in its own authored words, fed live by the new `servicesChanged` bus event City emits from every daily
   coverage sweep (payload = `services.latest()`, pinned against the dashboard's lines). Dismissal is
   **per-service-set** (`util/services.ts` `warningsKey`) — a new degrading service re-arms it.
2. **The Services window (`hud/windows/ServicesDetails.tsx`, opened by clicking the banner):** the 096 panel
   promoted — per-service rows (ratio, providers, facilities) plus **what to build**: construction-menu
   entries derived from `json/construction.json` by blueprint match, each button arming the placement cursor.
3. **Data-driven copy:** every `services.json` line carries a required `warning` string (validator + invalid
   fixture); the threshold is the existing `advisoryBelow`. Pure logic (`computeServiceWarnings` /
   `warningsKey`) is split out and unit-tested; the React component only renders what they decide.
