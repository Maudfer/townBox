# [Feature] The garbage service — litter, collection rounds, the depot

- **Type:** Feature (data + blueprint + repertoire)
- **Labels:** `simulation`, `services`, `objects`, `aliveness`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-aliveness.md`](../proposals/simulation-aliveness.md) — H3.
  Phase 4.

## Goal

The visible service: streets that are cared for should *look* cared for in the log and feed, and neglect
should visibly compound.

## What shipped

1. **Litter enters the world:** outdoor/venue activity generates `gum_wrapper`/`cigarette_butt` instances at
   low rates (`dropped_a_wrapper` etc. as pool children of street actions) — real, unowned objects at the
   location.
2. **Collection leaves it:** a `sanitation_depot` blueprint (≡ the future "Landfill") with
   `garbage_collector` jobs whose work repertoire is **collection rounds** — an ambulatory work action
   (`collection_rounds`) walking the streets and consuming litter through its pool children
   (`picked_up_litter`, `swept_up_butts`). Residents sweep their own sidewalk through the same discretes.
3. **Neglect compounds:** without a depot, litter accumulates; the cleaning/mood modifiers react, and the
   coverage ledger (096) has a garbage line. The household half of the loop (house→curb→collected) lands in
   task 112.
