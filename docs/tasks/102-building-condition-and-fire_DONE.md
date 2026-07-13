# [Feature] Building condition, fire & the fire service

- **Type:** Feature (state + registry + outcome curves)
- **Labels:** `simulation`, `fire`, `services`, `aliveness`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-aliveness.md`](../proposals/simulation-aliveness.md) — H4.
  Phase 4 — the survival-band / evacuation showcase; needs 086/087 and 099's incident registry.
- **Save:** v16 (the `buildingConditions` section).

## Goal

The gripe list names firemen; fire needs one prerequisite no other service does — things that can burn.
Build the damage model and the fire service, and use it as the survival-band showcase.

## What shipped

1. **Building condition (`game/economy/BuildingConditions.ts`, `json/fire.json`):** a per-building 0–100
   condition, worn **closed-form** (level minus wear over days since last touch — the K2 rule, reads never
   mutate), damaged in steps by fires. Independently useful texture (shabby vs. kept-up buildings).
2. **Ignition:** a per-building fire hazard factored by condition — a derelict building ignites where a
   kept-up one, same seed same day, does not. Ignition files a `fire` incident in the 099 registry (one
   registry for all emergencies).
3. **Response & evacuation:** a `fire_station` blueprint + `firefighter` job; on-duty firefighters RUSH to
   any open fire (ambulatory, obligation band — the chase tech at emergency pace); occupants **evacuate**
   (the survival-band showcase — leisure interrupted, everyone out, resumable activities paused). The
   outcome resolves on a curve over fire coverage: extinguished / heavy-damage / destroyed.
4. **Aftermath:** a destroyed building tears down through the coherent teardown bulldozing uses (residents
   rehoused or homeless, business closed), the lot heals via 037, `lost_home_to_fire` lands, and lingerers
   risk an injury roll feeding the grief arcs. (Dispatch-to-the-blaze and arrival-scaled outcomes land in
   task 110.)
