# [Feature] Jail & detention as a lived state

- **Type:** Feature (state + wiring + data)
- **Labels:** `simulation`, `crime`, `jail`, `aliveness`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-aliveness.md`](../proposals/simulation-aliveness.md) — G5.
  Phase 4 — needs 099.
- **Save:** v16 (the `detention` section).

## Goal

The gripe list names jail — make it a place, not a flag. A sentenced person becomes visible, inspectable,
and constrained; family can visit; release re-enters housing honestly.

## What shipped

1. **The building:** the `jail` blueprint (civic, "County Jail") with `corrections_officer` jobs and
   placement tags generating cell/canteen objects. Short detentions serve at the police station until a town
   builds a jail; detention prefers the jail when one stands.
2. **Detention as a lived state (`game/economy/DetentionRegistry.ts`, `game/actions/Detained.ts`):** a
   sentenced person relocates to the facility — materialized, visible — their agenda suspends, job/school
   pause with the honest absence consequences, and the `detainedHook` runs `serving_time` (the cell outranks
   the shift). New constrained repertoire: `paced_the_cell`, `ate_prison_food`, `worked_in_the_laundry`.
3. **Release & reintegration:** `runReleases` frees lapsed sentences back into whatever life is left,
   re-entering housing through the existing relocation helper (the homelessness machinery catches them if
   the household moved on); the criminal record weights JobMarket scoring down over a decaying window —
   recidivism needs no scripting.
