# [Feature] Fire particles — the blaze reads as a blaze

- **Type:** Feature (scene + bus event)
- **Labels:** `scene`, `fire`, `visibility`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-visibility.md`](../proposals/simulation-visibility.md) — task 116.
- **Depends on:** [102](102-building-condition-and-fire_DONE.md), [110](110-fire-end-to-end_DONE.md).

## Goal

The 102/110 fire chain resolved correctly but had no visual. Put flames on the burning building.

## What shipped

1. **The bus contract:** City emits the new `fireStateChanged` event (`{ buildingKey, burning }`) — `true`
   from the ignition sweep when an incident is filed, `false` from `resolveFires` when it resolves (including
   the bulldozed-mid-fire path, so no emitter is orphaned). Pinned by a unit test on the captured payloads
   (the preferred bus route over scene polling).
2. **The scene:** a small Phaser particle emitter anchored on the burning building — a generated 3×3 white
   square tinted per particle (orange/red flames + a gray smoke drift), upward cone with negative gravity,
   depth just above the structure. Created on ignition, destroyed on resolution; a game load clears all
   emitters wholesale (the world is rebuilt).

Visual verification is 117 / browser-suite territory.
