# [Feature/HUD] Legibility — the inspector "Now:" line, day strip & feed filters

- **Type:** Feature / HUD
- **Labels:** `hud`, `react`, `legibility`, `aliveness`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-aliveness.md`](../proposals/simulation-aliveness.md) — Workstream
  J (J1 status line, J3 day strip, J4 feed follows). Phase 1.

## Goal

Close the audit's flagship legibility gap — `Brain.statusOf()` exists and **nothing reads it**. The richest
layer of the sim was invisible while it happened; make what a person is doing right now visible, and make
the feed a serialized-novel view rather than a firehose.

## What shipped

1. **The "Now:" line (J1)** in `hud/windows/PersonDetails.tsx`: the person's derived `Brain.statusOf` + the
   active instance's definition label + location name, refreshed on `timeChanged` through the bus (a HUD
   query that keeps the game/React seam clean — no reaching into game internals). The needs/mood bars join
   this panel as their stores land (084/091).
2. **The day-timeline strip (J3):** a 24-hour bucketed view of the person's log, so the rhythm the needs
   engine (084) creates is inspectable at a glance.
3. **Feed filters & follows (J4)** in `hud/Feed.tsx`: category filter chips (using the existing event
   `category`) plus "follow this person" so a followed person's texture events get through the filter — the
   feed becomes the per-life narrative view the project's premise promises.

The simulation core stays React-free; everything crosses the boundary through the `GameManager` event bus.
