# [Feature] Wages & payroll

- **Type:** Feature / Economy
- **Labels:** `feature`, `economy`, `framework-followup`
- **Depends on:** 015 (employment), 017 (money model)
- **Unblocks:** 019, 020, 022

## Summary

Make businesses **pay their employees**. On a regular cadence, each employed person receives their job's
salary from their employer's balance — the first real money flow in the economy (business → person).

## Background / current state (verified)

- `JobPosition.salary` (`src/types/Work.ts`) exists; seeded jobs carry salaries (`json/jobs.json`). A hired
  person's job is on `WorkLife.job` after 015.
- `Workplace` knows its `employees: Person[]` and its `BusinessInstance` (with a balance after 017).
- Cadence signals: the clock emits `newDay`; the calendar is 30-day months / 360-day years
  (`util/time.ts`, `Clock`). `JobPosition` also carries `shiftStart`/`shiftEnd`. `City.handleNewDay` already
  runs each day and is the natural payroll tick.
- Salaries in `json/jobs.json` are currently expressed as monthly-ish round numbers (e.g. 1300–6000); confirm
  and document whether `salary` is monthly or annual.

## Goals / Requirements

1. **Choose a payroll cadence and document it.** Recommended: **monthly** (on the calendar month rollover —
   detect via the clock's timestamp in `City.handleNewDay`). Pay each employee `salary` (interpreting the
   `salary` unit per the documented convention) by transferring from the employer business balance to the
   person balance through the 017 ledger primitive.
2. **Drive it from the framework where it fits.** Either a dedicated payroll pass in `City` on month rollover,
   or an `adjustMoney`-based mechanism — but salaries are a structural business→employee obligation, so a
   payroll pass keyed off `Workplace.getEmployees()` is cleaner than per-person events. Document the choice.
3. **Handle an employer that can't pay.** If the business balance can't cover payroll, pay what it can / go
   negative (debt) and **flag the business as financially stressed** — this is the hook 021 (bankruptcy) and
   020 (P&L) consume. Don't resolve insolvency here.
4. **Emit a signal** (`wagesPaid` or per-business summary) so the event feed (029) and finance views (028/031)
   can surface payroll.
5. **Determinism & save.** Payroll is a deterministic function of the day + balances; ensure month-rollover
   detection survives load (don't double-pay or skip after a load jump — coordinate with the clock resync in
   `GameManager.resyncTimeTracking`).

## Out of scope

- Where the business gets the money (revenue) — 020.
- Household spending of wages — 019.
- Bankruptcy consequences — 021.

## Acceptance criteria

- Employed people receive their salary from their employer on the documented cadence; totals are conserved via
  the ledger.
- A business that can't cover payroll goes into debt and is flagged stressed (no crash).
- Payroll is deterministic and does not double-run across save/load.
- `npm test` passes with payroll unit tests (incl. the can't-pay case and the month-rollover trigger).

## Notes

- Salaries × headcount is the dominant business cost; tune `json/jobs.json` salaries and `businesses.json`
  economics together (020) so the loop can actually drive bankruptcies when numbers are bad — that tunability
  is an explicit design goal (`docs/tasks/013`).
