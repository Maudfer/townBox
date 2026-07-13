# [Feature/HUD] The construction menu & civic placement

- **Type:** Feature (React HUD + data + validator)
- **Labels:** `hud`, `react`, `construction`, `visibility`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-visibility.md`](../proposals/simulation-visibility.md) — task 108.

## Goal

Put the player's hands on the levers. Civic buildings could only appear by luck (the demand-weighted draw
picks from the full blueprint table); let the player choose what to place, and fence civic blueprints out of
the random draws.

## What shipped

1. **The toolbar:** House and Work buttons removed; one **Construction** button (tool + F-key). Soil and
   Bulldoze folded into a single Bulldoze (grass IS the empty state).
2. **The construction window (`hud/windows/ConstructionMenu.tsx`, `json/construction.json`):** the
   Construction tool opens a grid of placeable buildings — Residence, Business, Fire/Police Stations,
   Hospital, Landfill, Prison, Supermarket — as **colored-square placeholders** (no art pass). Selecting one
   arms the placement cursor (`constructionSelected` → `MainScene`); placement works exactly like before.
3. **Pinned blueprints:** `ConstructionPick` carries an optional pinned blueprint key;
   `City.openBusiness`/`setupBusiness` instantiate exactly that business (size drawn as usual).
4. **`placement: "civic"` (data + validator):** civic blueprints are excluded from the generic draw, 037
   re-occupancy, AND entrepreneurship; the construction validator enforces every civic blueprint appears in
   the menu config and vice versa.
