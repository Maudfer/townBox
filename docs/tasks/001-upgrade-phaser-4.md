# [Maintenance] Upgrade Phaser 3 → Phaser 4

- **Type:** Maintenance / Dependency upgrade
- **Labels:** `maintenance`, `engine`, `breaking-change`

## Summary

Upgrade the game engine from **Phaser `^3.80.1`** to **Phaser 4**. This is an infrastructure
upgrade with no intended gameplay changes: the game must look and behave the same after the
upgrade. Phaser 4 is a major version with API and rendering changes, so this requires careful
migration and verification rather than a simple version bump.

## Background / current state

Phaser is used directly throughout the simulation core (`src/app/game/`). Verify and migrate every
touch point, including (non-exhaustive — do a full exploration pass):

- `GameManager.ts` — constructs `Phaser.Game` with a `Phaser.Types.Core.GameConfig`
  (`type: Phaser.AUTO`, `Phaser.Scale.RESIZE`, `Phaser.Scale.CENTER_BOTH`, render options), and
  registers `TitleScene` + `MainScene`.
- `MainScene.ts` — extends `Phaser.Scene`; uses `this.load`, `this.add.image`, `this.add.grid`,
  `this.input` (mouse/keyboard), `Phaser.Cameras.Controls.SmoothedKeyControl`,
  `Phaser.Input.Keyboard.KeyCodes`, camera/zoom APIs, and depth APIs.
- `TitleScene.ts` — extends `Phaser.Scene`; uses `this.add.text/rectangle/graphics`, `this.tweens`,
  camera fade events (`Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE`), and `this.scene.start`.
- `Person.ts`, `Vehicle.ts` — use `Phaser.Math.RND.pick` and image/rotation/depth APIs via the
  `types/Phaser.ts` `Image` alias.
- `DebugTools.ts` — uses `scene.add.rectangle` / `scene.add.text`.
- `types/Phaser.ts`, `types/Grid.ts`, `types/Cursor.ts` — type aliases referencing Phaser types
  (e.g. `Phaser.GameObjects.Image`, `Phaser.Geom.Rectangle`).
- `package.json` — `phaser: ^3.80.1` dependency and the `phaser3` keyword.

The project is bundled with **Parcel 2** and uses **strict TypeScript**; the upgrade must keep both
building cleanly.

## Goals / Requirements

1. Bump `phaser` to the latest stable Phaser 4 release in `package.json` and update the lockfile.
2. Migrate all Phaser API usages flagged during the exploration pass to their Phaser 4 equivalents.
   Pay special attention to:
   - Game/scene config and the renderer (`Phaser.AUTO`, scale manager, render flags).
   - Input (mouse/keyboard) and the camera controls (`SmoothedKeyControl`).
   - GameObjects used: `image`, `text`, `rectangle`, `graphics`, `grid`, plus `depth`, `origin`,
     `rotation`, `alpha`, `visible`, `tint`.
   - Tweens and camera fade events.
   - `Phaser.Math.RND` usage.
3. Update `types/Phaser.ts` (and any other type alias files) so the TypeScript types resolve under
   Phaser 4 and the project compiles with no new errors under the existing strict settings.
4. Update incidental references to "Phaser 3" in `package.json` (`description`, `keywords`) and
   `README.md`.
5. The game must run via `npm run dev` and be **visually and behaviorally identical** to before:
   - Title screen renders and "Start Game" transitions to the main scene.
   - Grid renders; tiles, roads (auto-tiling), houses, and work buildings place correctly.
   - Tall-building depth/layering still works (people/cars in front below, behind above).
   - People walking and cars driving (lanes/curves) still work.
   - Camera pan/zoom, tool hotkeys (F1–F6, Esc), and `P`/`V`/`G` still work.
6. `npm test` passes.

## Out of scope

- Any gameplay, balancing, or visual redesign.
- Refactors unrelated to the engine migration.

## Acceptance criteria

- `npm run dev` builds and runs with Phaser 4; all behaviors in Goal 5 verified manually.
- `npm test` passes; `tsc` reports no new errors.
- No remaining references to Phaser 3 in code, types, `package.json`, or `README.md`.

## Notes

- Phaser 4 has notable rendering and API differences from Phaser 3; consult the official Phaser 4
  migration guide and changelog during the exploration pass.
- Confirm Parcel 2 resolves and bundles the Phaser 4 package correctly (ESM/CJS entry points).
- If a Phaser 4 API change forces a behavioral compromise, flag it in the PR rather than silently
  changing gameplay.
