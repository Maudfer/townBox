# [Feature] Workplace / business inspector window

- **Type:** Feature / UI
- **Labels:** `feature`, `ui`, `hud`, `business`, `framework-followup`
- **Depends on:** 026 (WorkplaceSelected + routing), 013b (business). Finance section: 020.

## Summary

A window for a work building's **business**: its name and line of work, size, the **job positions
(filled vs. open)**, its **employees**, and — once the economy lands — its **finances** (balance, monthly
P&L, bankruptcy risk). This makes businesses legible and is where the player understands hiring and (later)
why a business is failing.

## Background / current state (verified)

- `WindowTypes.WorkplaceDetails` exists but is `null` in `Hud.tsx`'s `windowMap`. After 026,
  `WorkplaceSelected` opens it with a `Workplace` payload.
- Data on a `Workplace` (`src/app/game/Workplace.ts`): `getBusiness()` → `BusinessInstance`
  (`blueprintKey`, `name`, `lineOfWork`, `size`, `positions: JobPosition[]`); `getEmployees(): Person[]`;
  `getOverview()` → `WorkplaceOverview` (max occupants/vehicles, occupant/employee overviews). Open positions
  today = the workplace's internal `avaiableJobs` (private); expose a getter if needed.
- After 015, filled vs open is meaningful (employees fill positions); after 020/021 the business has a
  balance, monthly P&L, and a stress/bankruptcy signal to display.
- Window scaffolding as in 027 (`Window.tsx`, `DetailsWindowProps`, `HouseDetails.tsx` reference).

## Goals / Requirements

1. **Create `hud/windows/WorkplaceDetails.tsx`** and register it in `windowMap`. Title = business name (or
   "Vacant" when the workplace has no business, e.g. after a bankruptcy — 021).
2. **Identity:** business name, line of work, size.
3. **Positions table:** per job title, **filled / total** counts (needs a public getter on `Workplace` for
   open positions; add one). Show required skills per job (from `json/jobs.json` / the position's
   `requirements`).
4. **Employees:** list with click-through to each person's window (027). Show their job title.
5. **Finances (gated on 020):** current balance, last monthly P&L (revenue / materials / payroll / fixed),
   and a clear "financially stressed / bankruptcy risk" indicator. Hide/placeholder this section until the
   economy exists.
6. **Live-ish updates** (poll on open / refresh on a clock tick), like 027.
7. **Reachability:** select a workplace (026); also openable from a person's "employer" link (027) and from
   the city overview (031).

## Out of scope

- Player commands (hire/fire/adjust prices) — read-only for now (a management UI could be a later task).
- The economy computation itself (020/021).

## Acceptance criteria

- Selecting a workplace opens a window showing the business identity, size, a filled/open positions table, and
  the employee list (with links to person windows).
- A vacant workplace renders a clear empty state.
- Finance section appears once 020 lands; before that it's absent/placeholder.
- No React in `game/`; data read via `game`/public getters. `npm run dev` builds; `npm test` passes.

## Notes

- Add a `Workplace.getOpenPositions()` (or filled/total summary) getter rather than exposing `avaiableJobs`
  directly. This window + 027 + the feed (029) are what turn the simulation from invisible to legible.
