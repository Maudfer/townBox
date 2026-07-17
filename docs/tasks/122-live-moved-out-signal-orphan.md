# [Fix] Live move-out is orphaned — nothing in the manifest emits the `movedOut` signal

- **Type:** Bug fix / Simulation
- **Labels:** `simulation`, `events`, `live-play`
- **Status:** ⬜ Open
- **Depends on:** — (found by the task-121 headless-gap sweep; independent of the generator work)

## The problem

Live adult move-out (task 024) is event-driven: a manifest event was meant to roll per adult, gate on the
`canMoveOut` context attribute (the `HousingMarket` adapter — a vacant house exists and the person lives in
a household they don't head), and `emit` the **`movedOut`** signal, which `City.handleTick`'s onCommitted
block routes to `City.resolveMoveOut` (the relocation into the vacant house, the new single-person
household, the `left_home_first_time` milestone).

**The consumer side all still exists; the producer is gone.** A full scan of the current 730-event manifest
finds **no event that emits `movedOut` and none that references `canMoveOut`** — the likely casualty of the
task-052 manifest regeneration (the manifest was rebuilt from the 049 planning lists; the regenerated
`moved_out_of_parents` is effect-free texture with no gate and no signal). Consequences in live play:

- `City.resolveMoveOut` (`City.ts` ~2455) is dead code — the `'movedOut'` branch of the signal switch
  (`City.ts` ~958) can never fire.
- `HousingMarket.canMoveOut` (`game/economy/HousingMarket.ts`) is computed and supplied to the engine every
  tick, but no predicate ever reads it (the engine's `canMoveOut` attribute derivation is unreachable from
  data).
- Adult children never leave home on the live map: households only shrink via death/eviction, and vacant
  houses stop attracting the 024 move-out flow. (Newlywed cohabitation, 023, is unaffected — `marriage`
  emits `partnershipFormed`, which the sweep confirmed alive.)
- No test caught it because `test/population/householdDynamics.test.ts` exercises `resolveMoveOut` by
  calling the handler directly, not through the event path.

Note the off-map contrast (task 121): the generator now drives its logical move-out by reacting to
`moved_out_of_parents` **commits** — so the deep sim has household churn while live play silently lost it.

## Requirements

1. **Restore the producer.** Either (a) re-add the effect-bearing `move_out` event to `json/events.json` —
   probabilistic, adult-gated, requiring `canMoveOut == true`, with `emit: movedOut` — or (b) attach the
   gate + emit to the existing `moved_out_of_parents` event (one event, one story; its off-map consumer in
   `LogicalWorld.moveOutOfParents` already tolerates a no-op when the subject doesn't live with a parent —
   verify the `canMoveOut` gate doesn't starve the generator, whose logical world supplies no housing
   market: absent market ⇒ `canMoveOut` reads `false` in the engine derivation, which would kill the 121
   off-map channel — resolve this coupling deliberately, e.g. gate live-only via the market-absent default
   or supply a trivially-true logical housing market). Decide (a) vs (b) during the exploration pass.
2. **Live behavior end to end:** with a vacant house and an eligible adult non-head, the event fires over
   time, `resolveMoveOut` relocates them, the household shrinks, `left_home_first_time` lands, and the feed
   announces it.
3. **A durable guard against re-orphaning:** a CI test asserting that every signal name
   `City.handleTick`'s onCommitted switch consumes (`partnershipFormed`, `movedOut`, `crimeCommitted`,
   `chaseConcluded`, `petAdopted`) is emitted by at least one manifest event — so the next manifest
   regeneration cannot silently sever a consumer again.
4. **Regression test through the EVENT path** (manifest-driven, not a direct handler call), proven by the
   revert-dance (§5.1).
5. Update the stale `CLAUDE.md` references if the shape changes (§4.8/§4.13 still describe the original
   `move_out` event by name).
