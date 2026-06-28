# [Feature] City event feed / notifications

- **Type:** Feature / UI
- **Labels:** `feature`, `ui`, `hud`, `life-events`, `framework-followup`
- **Depends on:** 013d (event signals), 026 (selection, for click-through). Richer once 015–022 emit signals.

## Summary

A live, scrolling **feed of notable city events** — births, deaths, marriages, hires, layoffs, business
closures, evictions — so the player can watch the simulation's story unfold. This is the single most
important piece for making the emergent sim *felt*: today everything happens silently in `City.handleNewDay`.

## Background / current state (verified)

- The event engine already produces a `signals` queue per day (`DayResult.signals`:
  `{ signal, personId, tick }`) from `emit` effects (`rehousingNeeded`, `partnershipFormed`, `hired`,
  `laidOff`, `fellIll`, …). `City.handleNewDay` consumes rehousing and **drops the rest**. Deaths/births are
  also known there (`result.died`, `result.born`).
- There is currently **no bus event** carrying these to the HUD, and no feed UI. The HUD has a persistent
  `Clock` widget (`hud/Clock.tsx`) as a model for a non-window, always-on panel, and `Toasts.tsx` for
  transient messages.
- Future tasks emit more signals: `wagesPaid` (018), `businessClosed`/`massLayoff` (021),
  `evicted`/`becameHomeless`/`rehoused` (022), `structureDemolished` (025).

## Goals / Requirements

1. **Add a `cityEvent` bus signal** to `types/Events.ts` carrying a structured notification:
   `{ kind, tick, message, subjects?: { personId?, houseKey?, workplaceKey? } }` (enough to render text and
   link to the involved entities).
2. **Emit from `City`.** In `handleNewDay` (and the economy/household handlers as they land), translate
   engine signals + reconciliation outcomes (births, deaths) into `cityEvent`s. Keep this mapping in one place
   so new signal kinds are easy to surface. Use the clock to stamp readable dates.
3. **Feed UI.** A persistent, scrollable HUD panel (toggleable) that appends `cityEvent`s newest-first, with a
   cap/ring buffer so it doesn't grow unbounded. Style consistent with `Clock`/`glass` panels. Group or filter
   by kind (births/deaths/economy/…) is a nice-to-have.
4. **Click-through.** Clicking a feed entry opens the relevant inspector (027/028) via the selection events
   (026) — e.g. a "X and Y married" entry opens X's person window.
5. **Toggle & discoverability:** a toolbar button (030) and/or hotkey shows/hides the feed; decide default
   visibility.
6. **Don't block the sim.** Feed handling is HUD-side and must not slow `handleNewDay`; emitting structured
   events on the bus is enough.

## Out of scope

- Persisting the feed across save/load (it's a transient view; optional to keep last N).
- Player actions from the feed beyond opening inspectors.

## Acceptance criteria

- Births, deaths, and marriages appear in a live feed as they happen in-sim, with readable dates.
- New signal kinds from later tasks (hires, closures, evictions) surface by adding to the single mapping spot.
- Feed entries link to the involved person/building.
- No React in `game/`; `City` only emits `cityEvent`. `npm run dev` builds; `npm test` passes.

## Notes

- This is the payoff that turns the invisible daily simulation into the game's narrative surface. Coordinate
  the signal vocabulary with 015–025 so each meaningful life/economy event has a feed representation.
