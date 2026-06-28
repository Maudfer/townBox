# [Feature] Save & load system

- **Type:** Feature / Persistence
- **Labels:** `feature`, `persistence`, `ui`

## Summary

Implement a save/load system that can persist and restore the **entire application/game state**.
Wire it to the title/splash menu, add an in-game save button and a `Ctrl+S` shortcut, show React
toasts on success, and support a **debug auto-load** path where a build can ship with an embedded
save that loads automatically and bypasses the splash screen.

Saves are stored as a **base64 string** via a **storage provider abstraction**. Ship a
`LocalStorageProvider` now; the provider pattern must make it easy to add a file-based provider
later. The on-disk save **format** should be chosen after evaluating the nature of the data being
serialized (see Notes).

## Background / current state

- **Boot/flow:** `main.tsx` builds `GameManager` → Phaser `Game` with `TitleScene` and `MainScene`.
  `TitleScene` shows a "Start Game" button that calls `this.scene.start('MainScene')`. `GameManager`
  creates `Field` and `City` after `sceneInitialized` and emits `gameInitialized`, which mounts the
  React `<HUD>`.
- **State lives across several systems** that must all be captured/restored:
  - `Field.matrix[row][col]` (every `Tile`: `Soil`/`Road`/`House`/`Workplace`, asset names, road
    curb/lane data, building entrances), plus `Field.destinations`, `Field.people`,
    `Field.vehicles`.
  - `City` (`name`, `population`) and each `House`'s `Family` (members, relationships, residents,
    occupants, garage).
  - Each `Person` (`SocialLife`: identity, age, gender, home, `RelationshipMap`; `WorkLife`: job,
    skills; plus position/indoors/travel state) and each `Vehicle` (position, destination).
  - `GameManager.gridParams` / `toolbelt` config.
- **Events:** the codebase uses the `GameManager` event bus (`types/Events.ts`). New save/load
  signals should be added to `EventPayloads`.
- **HUD:** React windowing exists (`Hud.tsx`, `Window.tsx`, `Toolbar.tsx`). There is currently **no
  toast system** and the toolbar buttons are not wired.
- There is **no existing persistence code**.

## Goals / Requirements

### Storage provider abstraction

1. Define a `SaveProvider` interface (e.g. `save(slot, data: string): Promise<void>`,
   `load(slot): Promise<string | null>`, `list()`, `delete(slot)`), where the payload is the
   **base64 save string**.
2. Implement `LocalStorageProvider` backed by `window.localStorage`. Structure the code so a
   future `FileSaveProvider` can be dropped in without touching call sites.

### Serialization

3. Implement serialization that captures the **entire game state** (the systems listed above) into a
   plain, serializable snapshot, and deserialization that fully reconstructs it — including
   re-establishing object references (e.g. `Person` ↔ `Family` ↔ `House`, relationship graphs,
   vehicle/person ownership). Rebuild Phaser assets/sprites and depth on load via the existing
   draw/event paths (`tileSpawned`, `personSpawned`, `vehicleSpawned`, etc.).
4. Encode the final snapshot as a **base64 string** for storage. Choose the snapshot format
   (see Notes) and document the choice and a top-level `version` field for future migrations.

### UI & interactions

5. **Title screen:** add menu options to **load a saved game** (in addition to "Start Game" /
   new game). Loading must boot directly into `MainScene` with the restored state.
6. **In-game save button:** add a working save control in the React HUD (wire it through the
   `GameManager` event bus; do not reach into game internals from React).
7. **Keyboard shortcut:** `Ctrl+S` saves the game (and must not trigger the browser's save dialog).
8. **Toasts:** add a React toast system and show success toasts for save and load (and an error
   toast on failure).

### Debug auto-load

9. Provide a debug capability to embed a save with a build and have it **auto-load on startup,
   bypassing the splash screen**. Gate this behind config (e.g. a flag in `json/config.json`,
   alongside the existing `debug` block) and/or a build-time/env switch, so production builds are
   unaffected.

### General

10. The game builds (`npm run dev`) and `npm test` passes. Add unit tests for serialization round-
    tripping (save → load → equivalent state) where feasible without a live Phaser scene.

## Out of scope

- Cloud saves, multiple named save profiles UI beyond what's needed for load, and the file-based
  provider implementation (only the abstraction must accommodate it).
- Save format migration tooling beyond reserving a `version` field.

## Acceptance criteria

- Saving then reloading the page and loading the save reproduces the world: tiles/roads/buildings,
  families and relationships, people, and vehicles.
- Save button, `Ctrl+S`, and title-screen load all work and show appropriate toasts.
- Debug auto-load boots straight into the restored game, skipping the splash.
- Switching the active provider is a single-point change (provider abstraction proven).
- `npm test` passes, including serialization round-trip tests.

## Notes

- **Format choice:** evaluate the data before committing. The state is a graph with cycles
  (relationships, ownership), so naive `JSON.stringify` will fail on circular references and lose
  object identity. Consider an **id-based normalized model** (assign stable ids to people, families,
  vehicles, tiles and reference by id) serialized to JSON, then base64-encoded. Document the
  decision in the PR.
- Keep serialization logic in `game/` and out of React; the HUD should only trigger save/load via
  events and render toasts.
- Be mindful of `localStorage` size limits for large cities; base64 inflates size ~33%.
