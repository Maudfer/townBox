# [Feature] Street wander graph + seeded wander — walks that end somewhere

- **Type:** Feature / Simulation
- **Labels:** `simulation`, `movement`, `street-life`, `determinism`
- **Status:** 📋 Planned — deferred from the simulation-aliveness-4 arc (V2 remainder)
- **Depends on:** V2 (road-anchor roaming + cell co-location, landed)

## The problem

V2's road-anchor roaming declusters building entrances: an ambulatory walk now picks from
`Field.roadAnchors` and stops mid-block instead of pathing to a building's front door. Two gaps remain:

1. **No loiter nodes.** A walk ends at an *arbitrary* road tile, not a *meaningful* spot — there is no
   authored set of places people gather (a bench, the park interior, a storefront-adjacent curb). Street
   life reads as aimless drifting rather than "went to sit in the park".
2. **Unseeded wander.** `Person.updateDestination` still uses the global unseeded `Phaser.Math.RND`. This was
   harmless before V2 (outdoor position fed nothing in the sim), but V2 made **outdoor pixel position feed
   cell co-location** — so the wander pick now has a (best-effort) determinism stake: two runs of the same
   seed can diverge on who meets whom outdoors. (Live movement is frame-paced, so exact positions stay
   best-effort; but the *pick* should be deterministic.)

## Requirements

1. **Loiter nodes.** An authored set of curb/loiter points — benches, park interiors, storefront-adjacent
   curbs, sourced from placement tags / building object generation — that ambulatory walks **prefer** as
   destinations, so people gather at plausible spots. The road-anchor roam stays as the fallback where no
   loiter node is near.
2. **Seeded wander.** Move the ambulatory wander pick onto a documented seeded stream (a world-seed fork by
   `tick`/`personId`, the `SOCIAL_SALT`-style convention), so the *choice* is deterministic per
   (seed, tick, person). Note in the code/comment that live movement remains frame-paced (arrival timing is
   not deterministic), so this is a partial-determinism improvement, not a live byte-guarantee.
3. **Tests.** Ambulatory destinations bias toward loiter nodes when present; the wander pick is deterministic
   per (seed, tick, person) across two runs.

## References

`game/agents/Person.ts` (`updateDestination` — `Phaser.Math.RND`), `game/world/Field.ts`
(`roadAnchors`/`nearestRoadTile`, the `Field.update` roam-target routing), `json/placement.json` +
`game/objects/ObjectGeneration.ts` (loiter contexts / benches), `util/random.ts` (`SeededRandom`, the salt
convention), `test/agents/personTravel.test.ts`, `test/world/fieldUpdate.test.ts`.
