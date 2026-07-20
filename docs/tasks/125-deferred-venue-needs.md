# [Feature] Deferred venue needs — a closed door is a plan, not a shrug

- **Type:** Feature / Simulation
- **Labels:** `simulation`, `needs`, `planner`, `venues`, `illness`
- **Status:** ✅ Done — landed in the aliveness-4 follow-up batch (PR #103). `WorldAdapter.hasVenuePlaced`
  distinguishes closed-from-absent; a placed-but-closed hospital makes the sick WAIT (rest) via the
  treatment hook instead of dissolving; the severity-banded illness suppressor collapses going-out/leisure/
  outdoor free-time weights for the seriously ill (`Brain`, both selection paths). Perf re-baselined.
- **Depends on:** V5 (nurses treat, landed); the planner/agenda (task 085)

## The problem

V5 made a staffed hospital actually treat, but a need whose venue is **closed** still **dissolves** instead
of **deferring**. The aliveness-4 audit's seriously-ill man went **grocery shopping** because the hospital
was closed: `treatmentHook` (`game/actions/Treatment.ts`) gates on `world.hasVenue('hospital')`, which in
live mode returns false when no staff is on shift (`LiveWorld.venueHostOpen`) — so the treatment producer
proposes nothing, the hunger producer wins, and the sick man runs errands past a clinic that opens in two
hours. The same collapse hits every venue-gated need at night (shopping at a closed shop, dining at a closed
restaurant): a blocked need doesn't wait, it disappears and something else fills the slot.

Separately, **severity-banded illness barely gates behavior**: the audit's mildly-ill people walked, visited
friends, and laughed until midnight. The 092 bedridden-band weights exist; they need verifying/widening so
that *serious* illness (health ≤ ~`SICK_HEALTH_THRESHOLD`/0.3 band) visibly cancels leisure and errands.

## Requirements

1. **Closed-venue deferral (the general fix).** When a needed venue is *placed but closed* (`hasVenue` false
   only because it is unstaffed/out of hours), the producer enqueues a planner "go at opening" agenda entry
   (the 085 machinery) rather than proposing nothing — a person **waits and goes when it opens** instead of
   substituting an unrelated activity. The opening hour derives from the venue's staffed shifts
   (`LiveWorld.venueHostOpen`). Apply to treatment, shopping, and dining venue needs.
2. **Severity-banded illness.** Verify and widen the bedridden-band selection so serious illness collapses
   leisure/errand weights and holds the 092 resting behavior; pin it with a cohort assertion.
3. **Tests.** A sick person whose town's hospital is closed plans to attend at opening (and does *not* go
   shopping in the meantime); a severely-ill cohort's leisure output collapses vs. a healthy cohort.

## References

`game/actions/Treatment.ts` (`treatmentHook`, `SEEK_COOLDOWN_TICKS`), `game/actions/Planner.ts`,
`game/execution/LiveWorld.ts` (`hasVenue`/`venueHostOpen`), `game/actions/JobOrchestrator.ts`
(`SICK_HEALTH_THRESHOLD`), `json/actions.json` (`resting_at_home_sick`, the sick-band modifiers),
`test/economy/hospitalEndToEnd.test.ts`, `test/actions/planner.test.ts`.
