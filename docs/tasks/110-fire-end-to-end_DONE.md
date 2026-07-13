# [Feature] Fire, end to end — dispatch to the blaze, arrival-scaled outcomes

- **Type:** Feature (Brain hook + data + City wiring)
- **Labels:** `simulation`, `fire`, `services`, `visibility`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-visibility.md`](../proposals/simulation-visibility.md) — task 110.
- **Depends on:** [102](102-building-condition-and-fire_DONE.md).

## Goal

The 102 firefighter rush was generic street running, and outcomes read the coverage *ratio*, not who
actually **arrived**. Drive the crew to the burning building and let physical arrival decide the outcome.

## What shipped

1. **Dispatch:** on-duty firefighters are driven TO the oldest burning building — the fire-response hook
   proposes the hook-only `responding_to_fire` action with a locationOverride (the 109 dispatch seam); the
   generic outside run stays as the no-building-address fallback. The evacuation hook exempts the responding
   crew (the alarm doesn't chase them back out).
2. **Arrival matters (the organic consequence):** `resolveFires` rides the effective response —
   `City.fireResponseAt(key)` = fire coverage × (firefighters physically on scene / `crewForFullResponse`,
   capped 1). No firefighters employed → arrival unmeasured → pure coverage (the 102 behavior). A crew that
   never arrives → the baseline burn-down odds no matter what the ledger claims. Never hardcoded — always the
   measured path.
3. **The home-wart closed:** `locationOf` reads 'home' for a resident inside their own house, so 102's
   building-keyed queries silently skipped the one family a house fire is about — no evacuation, no injury.
   The evacuation hook now reads `objectLocationOf` (physical presence) and the lingerer injury loop counts
   at-home residents. Both fixes revert-danced.

Tests: `test/actions/fireHooks.test.ts` + `test/economy/fireService.test.ts`.
