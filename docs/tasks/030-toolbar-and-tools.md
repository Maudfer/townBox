# [Feature] Toolbar wiring & tool selection

- **Type:** Feature / UI
- **Labels:** `feature`, `ui`, `hud`, `cleanup`, `framework-followup`

## Summary

Wire the **toolbar** so its buttons actually select tools (place road/house/work, select, bulldoze), show the
active tool, and expose the windows added by other tasks (feed 029, overview 031). Today the toolbar is
almost entirely decorative — only the Save button works — and tools can only be changed with F1–F6 keys.

## Background / current state (verified)

- `Toolbar.tsx` (`src/app/hud/Toolbar.tsx`) renders five buttons; only the Save button has an `onClick`
  (`game.emit("saveGameRequest")`). The others (cursor, building, bulldozer, cog) do nothing.
- Tool selection currently happens **only in Phaser**: `MainScene.create()` binds F1–F6 (from
  `json/input.json`) and Esc to `this.setCursor(tool)`. There is **no bus event** for the React HUD to change
  the tool. `MainScene.setCursor(tool: Tool)` is the single entry point and updates the cursor preview.
- `Tool` enum (`types/Cursor.ts`): `Soil`, `Road`, `House`, `Work`, `Select`, `Bulldoze`. `json/toolAssets.json`
  maps tools → preview sprites; `json/input.json` maps keys → tools.
- The HUD ↔ game boundary is the bus (`game.emit`/`game.on`), per CLAUDE.md §4.9.

## Goals / Requirements

1. **Add a `toolSelected: Tool` bus event** (`types/Events.ts`). `MainScene` subscribes and calls
   `setCursor(tool)`; the existing F1–F6/Esc handlers should also emit `toolSelected` (or call a shared path)
   so keyboard and toolbar stay in sync.
2. **Wire the toolbar buttons** to emit `toolSelected` for each tool (road, soil, house, work, select,
   bulldoze). Keep Save. Replace/extend the current icon set so every placement tool is reachable
   (`@mdi/js` icons already in use).
3. **Active-tool indication.** Track and visually highlight the currently selected tool in the toolbar
   (listen for `toolSelected`, or have the HUD own tool state and broadcast it). Decide the source of truth and
   document it (recommended: HUD owns the selected tool, emits `toolSelected`, MainScene is a pure consumer —
   but keep keyboard shortcuts working by having MainScene emit back).
4. **Hook up the new windows/panels:** buttons/toggles for the City Overview (031) and the Event Feed (029),
   plus the existing cog (game options / `WindowTypes.GameOptions`) if cheap.
5. **Tooltips/labels** for discoverability.

## Out of scope

- A building palette for *multiple* house/work types (there's one of each today) — note as a future task
  (`WindowTypes.AvailableBuildings` is reserved for it).
- Restyling the whole HUD.

## Acceptance criteria

- Every placement/select/bulldoze tool is selectable from the toolbar and from the keyboard, and the two stay
  in sync; the active tool is visually indicated.
- Toolbar buttons open the Feed (029) and Overview (031) when those exist (graceful no-op until then).
- No React in `game/`; tool changes flow over the bus. `npm run dev` builds; `npm test` passes.

## Notes

- This removes the "toolbar buttons are not wired" caveat in CLAUDE.md §1/§4.9. Small but high-impact for the
  game actually being playable with a mouse.
