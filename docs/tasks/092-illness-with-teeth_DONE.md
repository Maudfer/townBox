# [Feature] Illness with teeth

- **Type:** Feature (data + two small code hooks)
- **Labels:** `simulation`, `health`, `jobs`, `aliveness`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-aliveness.md`](../proposals/simulation-aliveness.md) — G2.
  Phase 3.

## Goal

The audit found 228 illnesses with **zero behavioral consequence**: `fell_ill` set `health: 0.5` and a feed
signal, nothing gated work/school/leisure on it, and `recovered` restored at a flat rate regardless of rest
or care. Illness was a log line, not an experience.

## What shipped

1. **Severity + minimum duration:** `fell_ill`/`injury` set real `health` levels; `recovered` is gated on a
   minimum duration (inverse `hasEvent` recency) so no one is cured within two days.
2. **The fitness gate (the crucial one):** the JobOrchestrator checks fitness — below `SICK_HEALTH_THRESHOLD`
   (0.6) a person doesn't start the shift; instead `resting_at_home_sick` runs and fires `called_in_sick`
   (manual — the absence is a log entry with a cause, not a silent no-show). Sustained absences raise the
   layoff hazard.
3. **Bedridden-band behavior:** while `health` is low, the rest need decays fast and outdoor/leisure weights
   collapse through the normal selection gates — sick people stay in bed *because of the same selection
   math*.
4. **Recovery reads care:** recovery speed ties to rest + (once 096 lands) healthcare coverage — a town with
   a hospital and doctors genuinely recovers faster, measured not scripted.
