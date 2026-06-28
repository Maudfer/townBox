# [Feature] Newlywed cohabitation & household merging

- **Type:** Feature / Simulation
- **Labels:** `feature`, `simulation`, `households`, `life-events`, `framework-followup`
- **Depends on:** 013d/013e (marriage event + rehousing infra)

## Summary

When two materialized people **marry** (the `marriage` event), they should **start living together** instead
of remaining in separate households. Today the `marriage` event forms the partnership and emits
`partnershipFormed`, but `City` ignores that signal, so spouses keep separate homes — an incoherent living
arrangement. This task consumes the signal and merges/moves the couple into one home.

## Background / current state (verified)

- `EventEngine` `marry` effect adds the `Partnership` to both pool records and emits a `partnershipFormed`
  signal (`target: subject`). The `DayResult.signals` reach `City.handleNewDay`, which currently only handles
  death-driven rehousing and ignores `partnershipFormed` (see the "remaining signals … consumed by later
  phases" comment).
- `City` has the relocation machinery from 013e: `resolveRehousing` / `relocateMember` move a person between
  houses/households, updating `House` resident lists, `Household.memberIds`, head, and `Person.social.setHome`.
- `spouseAt(pool, id, tick)` (`util/kinship.ts`) resolves the partner. Materialized people are indexed by pool
  id in `City.handleNewDay` (`personByGenId`).
- House capacity: `House.getOverview().maxResidents` (8).

## Goals / Requirements

1. **Consume `partnershipFormed`.** When a marriage forms between two materialized people, move them (and any
   dependent minors in the moving spouse's household) into a single home.
2. **Choose the shared home, with a clear policy.** E.g. the couple moves into the home with more capacity /
   the head's home / the larger household; document the rule. Respect `maxResidents`; if neither home can hold
   the combined household, fall back (stay put, or seek a vacant larger home if a housing market exists later).
3. **Update both households coherently.** Merge `memberIds`, reassign/keep a head, update resident lists and
   each moved person's `home`. If a household is emptied by the move, mark the house vacant.
4. **Handle the mixed materialized/unplaced case.** A materialized person may marry someone only in the pool
   (not on the map) — decide: only act when both are materialized, or materialize the spouse. Recommended:
   only relocate when both are materialized; otherwise just record the partnership (document it).
5. **Reuse, don't duplicate.** Generalise 013e's relocation helper into a shared "move person(s) into household
   H" routine used by death-rehousing, eviction (022), this, and 024.
6. **Determinism & save:** relocations are deterministic; the resulting households round-trip.

## Out of scope

- The marriage event/probability itself (013d) and divorce-driven splits (could be a small follow-up).
- Housing-market relocation when neither home fits (note as a fallback).

## Acceptance criteria

- After a materialized couple marries, they (and dependents) share one home; both households are left coherent
  (no spouse living alone in a separate house, no over-capacity homes).
- Existing death-driven rehousing (013e) is not regressed.
- Deterministic; survives save/load.
- `npm test` passes with a marriage→cohabitation scenario test.

## Notes

- Pairs with 024 (move-out) and 022 (eviction) — all three are "relocate people into a coherent household,"
  so land the shared helper first.
