# [Feature] Crime, incidents, police & the visible chase

- **Type:** Feature (registry + data + Brain hook)
- **Labels:** `simulation`, `crime`, `police`, `aliveness`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-aliveness.md`](../proposals/simulation-aliveness.md) — G4.
  Phase 4 — needs 093 (ambulatory), 091 (mood), 096 (coverage).
- **Save:** v16 (the `incidents` section).

## Goal

"No concept of stealing; police should chase, criminals should run; coherent causes." Make property crime
gate on desperation, give police a real loop, and put the chase on the street.

## What shipped

1. **Property crime:** `shoplifting`, `pickpocketed_someone`, gated hard on desperation (arrears + low money
   + low mood + risk appetite — the selection gate literally *is* "financial struggle → theft"). Stolen
   instances keep their true owner (the ownership/possession split was built for this).
2. **Incidents (`game/economy/CityIncidents.ts`, `types/Incidents.ts`):** crimes file `Incident` records
   (id, kind, location, suspect, witnesses via 094, status) — the JobMarket/HousingMarket adapter pattern,
   engine-agnostic, scene-free, serialized. `isWanted` = named suspect of an open **witnessed** incident
   (unwitnessed crimes are unknowable to police).
3. **The chase (`game/actions/Pursuit.ts`):** when an on-duty officer and a wanted suspect co-locate, both
   sides get ambulatory intents — the suspect FLEES (survival band), the officer gives CHASE (obligation) —
   two sprites genuinely running down the street. City rolls the outcome (`resolveChase`): got_caught (fine
   + record) or evaded, weighted by age/health. The police day sweep (`runPoliceWork`) resolves witnessed
   incidents scaled by coverage, and cold cases expire. Records make hiring harder — an unscripted
   recidivism loop.
