# [Feature] Person inspector window (with event log)

- **Type:** Feature / UI
- **Labels:** `feature`, `ui`, `hud`, `life-events`, `framework-followup`
- **Depends on:** 026 (PersonSelected + window routing), 013d (event history)

## Summary

A window that shows everything about a person — identity, age, home, **job & skills**, relationships, and most
importantly their **life-event log** (the history the event engine records). This is the primary way the
player reads an individual's emergent story, and the headline "float people's event logs in the UI" ask.

## Background / current state (verified)

- `WindowTypes.PersonDetails` exists but is mapped to `null` in `Hud.tsx`'s `windowMap`. After 026,
  `PersonSelected` opens it with a `Person` payload.
- Data available on a `Person`:
  - `person.social` (`SocialLife`): `getInfo()` (firstName, familyName, **stored** age, gender, relationships),
    `getFullName()`, `getAge()` (clock-derived — prefer this over the stored age), `getHome()`,
    `getPersonId()`, `getBirthTick()`.
  - `person.work` (`WorkLife`): `getJob()` (title, salary, shift, requirements), `getSkills()`.
  - `person.getOverview()` builds a `PersonOverview` with relationship names already resolved.
- **Event history** lives in `EventEngine` (`game.eventEngine.getHistory()` → `EventHistoryTable` keyed by
  pool `personId`, each `{ eventId: { count, lastTick } }`). The clock (`game.clock`) converts ticks → dates
  (`util/time.ts` / `Clock.getTimestamp`-style helpers).
- Window scaffolding: `Window.tsx` (react-rnd; title/header/footer/body), `DetailsWindowProps`
  (`game`, `index`, `data`, `onClose`). `HouseDetails.tsx` is the reference implementation, and it can already
  render a person's family tree from the pool (reuse for the relationships section).

## Goals / Requirements

1. **Create `hud/windows/PersonDetails.tsx`** and register it in `Hud.tsx`'s `windowMap`. Title = the person's
   full name.
2. **Identity & vitals:** name, age (use `getAge()`), gender, home address (house identifier / household name),
   and current marital/employment status (derive from relationships / `getJob()`; richer state once the
   engine's attributes are exposed).
3. **Work:** job title, employer (workplace — link to its window, 028), salary, shift; and the skill list.
4. **Relationships:** list (or reuse the family-tree renderer) with click-through to other people's windows
   (open `PersonDetails` for a related person — needs the related `Person`; resolve via materialized people or
   pool→materialized lookup).
5. **Event log (the centerpiece):** read `eventEngine.getHistory()[personId]` and render a readable,
   chronological list — event label, last-occurrence date (tick→date via the clock), and count. Use friendly
   labels (a small id→label map, or a `label` field added to the event manifest in 032). Most-recent first.
6. **Live-ish updates:** the window reads current data on open; a simple refresh (poll on an interval or on a
   `timeChanged`/`newDay` tick) is enough to keep age/log fresh. Avoid heavy per-frame work.
7. **Reachability:** opened by selecting a person (026); also openable from a family-tree node and from
   household/employee lists in other windows.

## Out of scope

- Editing/commands on the person (read-only inspector).
- Economy fields (balance) until 017 exists — leave a slot and add when money lands.

## Acceptance criteria

- Selecting a person opens a window showing identity, age, job, skills, relationships, and a readable event
  log derived from the engine's history.
- Multiple person windows can be open at once (per 026's identity-keyed dedupe).
- No React imports leak into `game/`; the window reads only via `game` (the bus / public getters).
- Builds (`npm run dev`) and `npm test` pass.

## Notes

- Event-log readability is greatly improved by adding a `label` (and maybe `category`) to each event in the
  manifest — coordinate with 032 (events expansion). Until then, derive labels from the event id.
