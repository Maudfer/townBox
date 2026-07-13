# [Feature] Police, end to end — dispatch, the ride, the arrest, the sentence, the visits

- **Type:** Feature (Brain hook + data + City wiring)
- **Labels:** `simulation`, `police`, `crime`, `visibility`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-visibility.md`](../proposals/simulation-visibility.md) — task 109.
- **Depends on:** [099](099-crime-incidents-and-police-chase_DONE.md), [100](100-jail-and-detention_DONE.md),
  [108](108-construction-menu-and-civic-placement_DONE.md).

## Goal

The 099/100 crime chain grew its missing physical and social halves: officers didn't dispatch to the scene,
the arrest was a silent City roll, sentences were flat, no family counterparts, jail visits deferred.

## What shipped

1. **Dispatch:** the pursuit hook, with no suspect in sight, drives an on-duty officer to the oldest open
   **witnessed** case (`CityIncidents.oldestOpenCase`) via the hook-only `responding_to_incident` action
   (locationOverride, obligation band). On arrival the existing co-location chase takes over.
2. **The arrest ceremony (`City.arrestSuspect`):** a caught chase is a real arrest — `arrested_suspect`
   (officer) → `was_arrested` (suspect, chained to the arrest seq) → `relative_arrested` fan-out to
   spouse/children/parents → the ride texture (`offered_a_ride`/`got_a_ride`) → a `requestTransition` escort
   to the facility → conviction.
3. **Scaled sentences:** a suspect with priors in the record window serves `detentionDaysRepeat` (the long
   stretch) instead of `detentionDays`.
4. **Jail visits (the planner producer):** a detained relative gets `visiting_the_detained` at the facility;
   the visit travels TO its target so it rides a string param + a payload counterpart (`received_a_visitor`)
   through City's committed loop rather than an interaction contract.
5. **Impunity:** a WITNESSED case going cold fires `got_away_with_it` (+valence) on the suspect — emboldening
   through the 095 crime habit; unwitnessed crimes stay unknowable end to end (the 099 contract).

Tests: `test/economy/policeEndToEnd.test.ts` (5 arcs).
