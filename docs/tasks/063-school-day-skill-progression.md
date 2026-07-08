# [Feature] School-day skill progression

- **Type:** Feature / Simulation
- **Labels:** `skills`, `school`, `progression-arc`
- **Depends on:** [058](058-school-assignments-and-scheduling.md) (`completed_school_day`), [059](059-skill-proficiency-schema-and-store.md) (store), [060](060-basic-skills-backfill.md) (the basic set)
- **Blocks:** [062](062-skill-initialization-and-early-childhood.md) reuses this task's gain math for synthesized histories (land the math as a pure util both can import)

## Goal

Completed school days convert into basic-skill proficiency: **once per completed school day**, every basic
skill gains `schoolDailyGain`, calculated from the person's **actual calendar** so that perfect attendance from
the 7th to the 18th birthday lands **exactly at 60.0** — regardless of weekday alignment. Missed days simply
mean lower proficiency; nothing normalizes anyone back up.

## Background (verified)

058 provides the seam: `attend_school` completes into the manual `completed_school_day` event with
`limit: { once: 'perDay' }` (the `stopped_working` pattern — `EventEngine.limitAllows` already enforces per-day
via `dayOfTick`). There is no daily-aggregation machinery today; this task adds the **SkillProgression
service** — the prompt's contract: *the Action engine confirms the school day completed; a dedicated service
awards the progression; Brain decides attendance but never mutates skills outside the normal lifecycle.*

## Requirements

- **Pure gain math** (`util/`, importable by 062): `totalEligibleSchoolDays(person)` = the number of school-day
  weekdays (via 057/058's `isSchoolDay` weekday logic) between the person's 7th and 18th birthday ticks
  (birthdays derive from `birthTick`; pure function of the calendar); `schoolDailyGain(person)` =
  `60.0 / totalEligibleSchoolDays(person)`. The 52-weeks reference figure (2,860 days ⇒ ≈ 0.020979/day) is a
  sanity anchor only — **the person-specific count is authoritative** (the 360-day year ⇒ weekday drift means
  per-person counts differ slightly by birth weekday).
- **SkillProgression service** (scene-free, `game/`): consumes committed `completed_school_day` events inside
  the tick lifecycle (phase 6 — the committed-event dispatch that already feeds Brain hooks; mode-identical by
  construction) and awards `schoolDailyGain` to **every basic skill**, provenance `school`, clamped at **60.0
  for school-sourced progression** (the store's global 100 cap still applies; the 60 clamp is this provenance's
  ceiling — other sources may later push basics past 60).
- **Single-credit guarantee, twice over:** the event's `perDay` limit is the primary gate; the service keeps a
  per-person last-credited-day guard as a belt-and-braces invariant (interrupt/resume of the same school action
  in one calendar day must never double-award — pin with a test).
- Eligibility mirrors 058: only fires for the enrolled 7–17 attendance flow; a child without an assignment
  never receives progression (no event, no award). Late starters / assignment gaps naturally finish below 60 —
  **no normalization**, assert it.
- RNG-free (fixed gain) — no determinism surface beyond the calendar.
- HUD: nothing new required (059's proficiency display shows the drift upward); optional: provenance already
  distinguishes `school`.

## Non-goals

Job progression (065). Grades/performance variance, subject choice, per-action awarding (explicitly rejected in
the vision: per-day, not per-child-action). Adult education.

## Testing

- **Exactness:** simulate (or fast-forward with the pure math + a scripted attendance record) perfect
  attendance 7→18 ⇒ every basic skill exactly 60.0 at the 18th birthday, for several birth weekdays.
- Missed days ⇒ proportionally lower final proficiency; late enrollment ⇒ lower, never topped up.
- Same-day interrupt/resume ⇒ one credit (both gates exercised: event limit and service guard).
- Clamp: school progression never exceeds 60.0 even with a corrupted extra credit injected.
- Mode-identical: the same attendance history in live and bootstrap runs produces identical records (extend
  `test/executionBoundary.test.ts`).
