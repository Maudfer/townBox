# [Feature] Expand the life-event manifest

- **Type:** Feature / Content + Simulation
- **Labels:** `feature`, `data`, `life-events`, `content`, `framework-followup`
- **Depends on:** 013c/013d (event compiler + runtime). New attributes/effects are code changes.

## Summary

Greatly **expand `json/events.json`** so people live richer lives: illness and recovery, injuries and
accidents (including vehicular), education, career progression, friendships and conflicts, crime, retirement,
hobbies, and more. The engine and compiler already support arbitrary new events as **pure data**; this task is
mostly content, plus the small number of **new Context attributes / effect kinds** the richer events need
(those are code changes by design — `docs/tasks/013` §7).

## Background / current state (verified)

- `json/events.json` currently has 8 events (death, had_sex, pregnancy, marriage, divorce, get_job, layoff,
  fell_ill). The compiler (`game/EventCompiler.ts`) derives deps/exclusions/topo/validation from each event's
  own requirements+effects; the runtime (`game/EventEngine.ts`) resolves per day over materialized people.
- Substrate: `Curve` (`util/curve.ts`) for probability gradients; `Predicate` (`util/predicate.ts`) for
  eligibility; the `SimulationContext` attribute set is **closed** (alive, age, gender, marital, employed,
  money, pregnant, homeless) — adding a new attribute (e.g. `health`, `education`) is a code change in the
  Context + `EventEngine.agentAttr`. The effect vocabulary is closed too (`setDeath/marry/divorce/birth/
  setAttr/acquireSlot/releaseSlot/adjustMoney/emit`) — new *primitive* effect kinds are code changes; most new
  events compose existing ones (`setAttr`, `emit`).
- `fell_ill` currently only emits a signal with no state — a good first candidate to make real via a `health`
  attribute.

## Goals / Requirements

1. **Add a `health` attribute** (Context + `agentAttr` + overlay), and model an illness lifecycle as events:
   `fell_ill` lowers health, `recovered` restores it, severe illness/`injury` can lead to `death` (via the
   existing exclusivity: low health raises death probability through a `Curve` factor on `subject.health`).
   This exercises the "new attribute = code, new events = data" line end-to-end.
2. **Add accidents**, including a multi-agent **vehicular accident** (driver + victim roles via spatial/
   relation binding — note this needs a way to bind a nearby victim; if no suitable binder exists yet, scope a
   minimal `nearbyOf` binder or defer the victim role and model a single-subject accident first).
3. **Add education & career events:** `study`/`graduate` that grant skills (`WorkLife.addSkill` hook from 014)
   and gate better jobs; `promotion` that raises salary/role (needs an effect or attribute — design it).
4. **Add social events:** `made_friend`, `argument`, `breakup` (for unmarried partners), reconciling with the
   marriage/divorce events and the relationship model.
5. **Add life-stage events:** `retirement` (gated on age/employment, releases the job slot), and any others
   that round out a life.
6. **Author labels/categories.** Add a `label` (and optional `category`) per event for the person event-log UI
   (027) and the feed (029). Decide whether this is a new manifest field (compiler ignores it) or a sidecar
   map; recommended: an optional `label`/`category` on `EventDefinition` (ignored by the compiler).
7. **Keep the manifest valid.** Run it through `compileEvents` (warnings must stay empty); add fixtures/tests
   for any new effect kind or attribute. Tune probabilities so the population stays demographically sane.

## Out of scope

- The economy events' *consequences* beyond what 015–022 implement (e.g. crime's justice system) — model the
  event + a signal; deep subsystems are their own tasks.
- UI for the new events (027/029 render whatever exists).

## Acceptance criteria

- `events.json` is substantially expanded; `compileEvents` reports no warnings; the runtime resolves the new
  events deterministically.
- At least one new Context attribute (`health`) and its illness→death gradient work end-to-end, demonstrating
  the data-vs-code flexibility line.
- New events carry labels for the UI. `npm test` passes with tests for new attributes/effects.

## Notes

- This is the "fill the manifests with as much data as we want" payoff. Each new *primitive* (attribute/effect)
  is a deliberate, tested code change; everything else is data. Coordinate labels with 027/029.
