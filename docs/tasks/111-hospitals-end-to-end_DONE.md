# [Feature] Hospitals, end to end — treatment as lived behavior

- **Type:** Feature (Brain hooks + data + attribute)
- **Labels:** `simulation`, `health`, `hospitals`, `visibility`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-visibility.md`](../proposals/simulation-visibility.md) — task 111.
- **Depends on:** [092](092-illness-with-teeth_DONE.md), [096](096-city-services-ledger_DONE.md),
  [107](107-venue-grounding_DONE.md).

## Goal

Healthcare coverage already sped recovery, but nobody *went* to the hospital and doctors treated nobody.
Make treatment lived behavior — and make untreated severe illness kill more, organically.

## What shipped

1. **The treatment trip (`game/actions/Treatment.ts`):** below the sick threshold, the `treatment` hook
   sends the person to the hospital venue (107) to run `receiving_treatment` (obligation band, urgency-
   scaled priority). No hospital → no proposal: the 092 resting behavior stands.
2. **The doctor's rounds:** the `doctorRounds` hook binds `treating_patient` to the first co-located
   patient-in-treatment not seen today — counterparts `treated_a_patient` / `was_treated_by_doctor` with one
   causation. A hospital with no doctor on duty treats nobody.
3. **Organic recovery speedup:** the new `recentlyTreated` context attribute (recent `was_treated_by_doctor`
   commits, via `LifeLog.countRecentEvents`) joins `recovered`'s factor list (×1 untreated, ×2 treated).
   Coverage stays the system factor; treatment is the personal multiplier. Death already reads low health,
   so untreated severe illness killing more people is **emergent arithmetic** — pinned by a seeded year over
   a severe cohort (strictly more deaths without treatment).
4. **The sick visit:** the planner enqueues `visiting_the_sick` for a sick relative (locationOverride
   `person:<id>` — bedside wherever that is); the `was_visited_while_sick` counterpart feeds the patient's
   mood (the 095 support loop, made physical).

Tests: `test/economy/hospitalEndToEnd.test.ts` (6 arcs).
