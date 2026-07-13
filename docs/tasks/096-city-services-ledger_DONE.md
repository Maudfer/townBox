# [Feature] The city-services coverage ledger

- **Type:** Feature (derivation + wiring)
- **Labels:** `simulation`, `economy`, `services`, `aliveness`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-aliveness.md`](../proposals/simulation-aliveness.md) — H1–H2.
  Phase 4 — the gap signals 097/098/099/102 read.

## Goal

"No concept of public services and people don't miss them; no tracking of city needs." Give the town a
ledger of what it has vs. what its population warrants, and wire each ratio into a real person-level outcome
through a measured path.

## What shipped

1. **The coverage ledger (H1):** `game/economy/CityServices.ts` — a pure derivation over data that already
   exists (businesses, jobs, assignments, school seats, population), recomputed on the day cadence,
   serialized nowhere. Each service is a **ratio, not a boolean**: healthcare, education (seat-based),
   police, fire, garbage, jail. A facility must exist (no hospital → 0 regardless of credentialed people
   walking around) and coverage is practicing providers over what the population warrants. `json/services.json`
   declares the provider jobs, facility blueprints, and per-provider capacities (validated both ways).
2. **Coverage has consequences (H2):** each service publishes a factor the engines consume through the
   `healthcareCoverage`/`policeCoverage` context attributes — recovery hazards read healthcare (the neutral
   level sits in the ×1 band, so an unmeasured town drifts nowhere), the crime gate reads police (099). A
   monthly worst-gap feed advisory surfaces it.
3. **The dashboard panel:** `CityDetails` gains a services panel with the per-service ratios (providers /
   facilities). The player's town-building decisions finally push person-level outcomes.
