# [Feature] The business draw coherence guard — no beach downtown, no duplicate schools

- **Type:** Feature / Economy generation
- **Labels:** `economy`, `generation`, `determinism`, `asset-regen`
- **Status:** 📋 Planned — deferred from the simulation-aliveness-4 arc (V7 remainder)
- **Depends on:** — (interacts with the maintainer's asset regeneration; changes the draw RNG stream)

## The problem

The generic work-lot blueprint draw is blind to what the town already has and to blueprint plausibility.
`City.openBusiness` (`game/City.ts` ~519) draws via `categorySupplyAndDeficits()` (abstract per-category
demand weighting) then a **uniform** `rng.pick` within the chosen category — and when there is no positive
demand deficit anywhere (a small/empty map) it falls back to a **uniform pick over all `drawable`
blueprints**. `isCivicBlueprint` (`City.ts` ~77, `placement: "civic"`) fences the civic set
(police/fire/hospital/jail/landfill) out of the draw, but nothing fences non-commercial **amenity** venues
(`beach`, `cemetery`, and arguably `park`), and nothing biases against **duplicates**.

The aliveness-4 audit's 30-person town drew a **beach between the bar and the bakery** and a **cemetery** as
generic work lots, plus **duplicate supermarket/school**, while whole demand categories went unserved — the
demand-weighted first draw (097) is category-blind to what is already placed, and the amenity blueprints (076
promoted them from 069 `deferred` contexts) are odd choices for a random business lot.

## Requirements

1. **Placement-aware draw.** Fold a *placement*-deficit term into the draw so it down-weights categories
   already well-supplied by **placed** businesses (not just abstract demand) and prefers unrepresented
   categories — no more stacking a second supermarket/school while dining/leisure is empty. Keep it
   deterministic (seed + anchor unchanged; only the weights feeding the draw change, as 097/I2 already does).
2. **Amenity coherence.** Exclude clearly non-commercial blueprints (`beach`, `cemetery`; decide `park`)
   from the random generic draw **and** the 037 re-occupancy **and** entrepreneurship — the same three-path
   fencing `placement: "civic"` gets. Introduce an analogous marker (e.g. `placement: "amenity"`) rather
   than hardcoding keys. Keep them venue-mapped (`json/venues.json`) so a future deliberate/menu placement
   still lets `visiting_beach`/park actions resolve.
3. **Validator coherence.** The "every object archetype is generatable/every blueprint reachable" family of
   guards (task 076) must not break — either make the fenced amenities placeable through a deliberate path
   (construction menu / pinned placement) or relax the reachability rule for `amenity` blueprints with a
   documented reason in the validator.
4. **Determinism + asset.** This changes the draw RNG stream, so byte-parity with the committed asset is
   **not** preserved — re-baseline the generation op-counts (`test/perf/generationPerf.test.ts`,
   `PERF_UPDATE_BASELINES=1`) and note the asset must be regenerated (the maintainer's step). Determinism
   *per seed* holds.
5. **Tests.** A seeded town no longer draws `beach`/`cemetery` from the generic path; a duplicate-suppression
   test (place N generic lots → categories spread rather than stacking); civic fencing untouched; the
   businessSetup/businessGen suites updated for any changed exact-blueprint expectations.

## References

`City.openBusiness` (~519), `City.categorySupplyAndDeficits`, `isCivicBlueprint` (~77),
`json/businesses.json` (`beach`/`cemetery`/`park` `placement`), `json/venues.json`, `json/construction.json`,
`test/economy/businessSetup.test.ts`, `test/economy/businessGen.test.ts`, `test/perf/generationPerf.test.ts`,
`test/data/dataValidation.test.ts`.
