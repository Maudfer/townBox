# Visibility arc — observation & balancing notes (task 117)

**Status: observation pass complete.** This is the deliverable of task 117: watch the simulation actually
run, confirm aspects are observably working, and rank what reads wrong for tuning. The debug scaffolding
(the `T` time-throttle + the vitals overlay, `MainScene`/`GameManager`, masterSwitch-gated) shipped with the
arc; this document is the session it exists for.

## How this was observed

The live Phaser scene could not be driven in the available headless renderer (the WebGL boot stalls), so the
observation was done **through the same engines, headless** — the strongest signal available here:

1. **The behavior layer** — a fresh, fully-hourly (two-band) generated cohort (43 people × 2 years, seed
   424242), decoded with `npm run decode-person` and a cohort-wide histogram (`scripts/observeCohort.ts`,
   a throwaway instrument). This exercises the Brain, needs, mood, habits, traits, the social graph, the
   planner, actions/events, skills, and the economy — every motivational and social system the aliveness arc
   added. It does **not** exercise the live-City reactive systems (police/incidents, fire response, the
   services ledger, the pet/detention registries) — those are map-bound and don't run off-map.
2. **The map layer** — the physical-grounding features (police dispatch/chase/arrest, fire dispatch +
   arrival-scaled outcomes, hospital treatment, household garbage, the real market, the services nagbar) are
   confirmed by their dedicated end-to-end suites, all green this session:
   `test/economy/{policeEndToEnd,fireService,hospitalEndToEnd,marketEndToEnd}.test.ts`,
   `test/actions/{fireHooks,garbageService}.test.ts`, `test/util/services.test.ts`, plus the aliveness
   keystone `test/execution/alivenessArcs.test.ts` (emergent grief/justice/fire chains).

## What is observably working (and coherent)

The behavior layer reads as **rhythm, not noise**. From the decoded cohort (1.1M log entries, 306 distinct
action kinds, median ~25.6k actions/person over 2 years):

- **The day has a shape.** Every completed sleep is **8h (100%)** — the Part-0 audit's "every one of 24,819
  sleeps lasted exactly 24 hours" artifact is gone; the two-band generator (105) gives real diurnal texture.
  A decoded day (p0, d342) runs: night sleep → morning walk → cooking a meal → childcare (refereed a
  squabble) → visiting friends → the bar in the evening → chores → a nap. That is a life with a shape.
- **The food chain connects, and `bake_cake` completes.** cooking_meal is the 2nd-most-common continuous
  action (24,907 runs) with its real children (chopped_ingredients, stirred_the_pot, tasted_the_dish,
  ate_a_meal). p5 runs **bake_cake to completion** (mix_dough → bake_dough → add_topping → a cake) — the
  flagship transformation that the audit found **blocked 206/206 times**. Closed.
- **Interactions are reciprocal and targeted.** Social acts carry real target ids: `consoled_person
  {target:p5}`, `asked_for_advice {target:p12}`, `apologized_to_person {target:p10}`, `hugged_person
  {target:p37}`. The social graph forms (made_friend 338, became_close_friends 178). The old "random
  companion" target-picking is gone.
- **had_sex is fixed.** 864 events = **18.1% of all events**, down from **84%** in the Part-0 audit (the 080
  quick-win). It is no longer drowning the log 100:1.
- **The new loops fire.** Household garbage (filled_the_trash_bag 11,055, took_out_the_trash) — the 112 loop
  produces and clears real bags; pets (adopted_a_pet 250); illness→recovery (fell_ill 139, recovered 199,
  injury 61); crime as lived behavior (shoplifting → pocketed_merchandise → committed_shoplifting);
  interruptions (`sleep interrupted` — the 086/087 arbitration + pause/resume at work).
- **Careers advance** (get_job 74, layoff 40, trade_school 20, nursing_school 7 — the retcon-adjacent
  education).

Conclusion: **the simulation is observably working.** People do coherent, connected, personal things.

## Balancing flags (ranked) — recommended follow-ups

None of these were applied in this PR: the top items are **structural** (hook guards, not rate/weight) and
the pure-data candidates need a full asset **regeneration** to validate, which is the maintainer's pre-merge
step. Per the arc's rule, structural findings are proposed follow-ups.

1. **`receiving_treatment` over-fires (highest priority, structural).** It is the 3rd-most-common continuous
   action cohort-wide (18,201 starts) against only ~210 illness onsets — a sick person re-enters treatment
   roughly every few ticks for the whole illness. Off-map this is inflated (the bootstrap `hasVenue` is
   always true and no doctor is on duty to set `recentlyTreated`, so recovery never speeds and the seeking
   never stops); but even in live play a sick person with a hospital would camp there re-running short
   sessions. **Fix:** a patient-side seek guard in `game/actions/Treatment.ts` — don't re-propose while a
   `receiving_treatment` ran within the last N ticks (mirror the doctorRounds 24-tick re-treat cooldown), or
   lengthen the session so it isn't a rapid re-fire. Structural; a follow-up task.
2. **Crime volume is high in a small, poor cold-start town (medium, verify-in-live).** committed_shoplifting
   (1,035) is the #2 event category, above had_sex. Partly a generator artifact — the generator binds no
   incidents/police, so crime has **no consequence off-map** (no chase, no record, no deterrent), and a
   40-person cold-start town with a thin economy runs many people into the desperation gate. The rate should
   be re-measured **in live play** (where police coverage + records gate and cool it) before any tuning; if
   it is still high there, nudge the desperation-gate thresholds (pure data) or the crime-action base
   weights down. Do not tune from generator data alone.
3. **`spending_time_at_home` leads the free-time fallback (low, data).** It is the single most common action
   (~51k starts, ~2× the next). Plausible (people spend evenings at home) but worth a small base-weight trim
   in `json/actions.json` if live observation agrees, to spread the home-leisure variety (watched_tv_show,
   took_a_nap, rearranged_possessions already exist as alternatives).
4. **`became_pregnant` (texture, 21) still fires somewhat independently of `pregnancy` (vital, 3) (low).**
   The C2 rewire demoted the flagship fake-doubles; this one reads like it still free-rolls. Confirm and, if
   so, gate `became_pregnant` on the real `pregnancy` (a coherence fix, pure data).

## Caveat on the instrument

The generator observes the motivational/social/action/economy core richly but **not** the live-map systems
(work-as-actions via the JobOrchestrator, commutes, police/fire/hospital/services). So the absence of
`started_working`/`stopped_working` in the cohort is **by design** (careers advance via
`LogicalWorld.runDaily` accrual off-map — the 077 contract), not a regression; those work-action loops fire
in live play and are covered by the E2E suites above. A live playtest with the `T` throttle remains the way
to eyeball the map layer once a renderer is available.
