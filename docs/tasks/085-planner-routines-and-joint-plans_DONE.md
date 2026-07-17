# [Framework] The planner, routines & joint plans

- **Type:** Framework (state + Brain hook + schema + mechanism)
- **Labels:** `simulation`, `planner`, `brain`, `framework`, `aliveness`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-aliveness.md`](../proposals/simulation-aliveness.md) — Workstream
  D (D1 agenda, D2 producers/routines, D3 joint plans). Phase 2.
- **Save:** v16 (the `agenda` section).

## Goal

Give people **intentionality across ticks** — the answer to "no logic to plan and go where that person is to
do important stuff", cadence ("some things you do on a schedule"), and joint activities (the couple walk).

## What shipped

1. **The agenda (D1):** `game/actions/Agenda.ts` — a persisted per-person store of planned intents
   (`{ actionId, params, window, prerequisites, locationOverride, routineId }`), shaped like the event
   engine's persisted schedule queue (042). Fulfillment and expiry are detected **lazily on read** (no
   sweeps — the closed-form discipline). A `plannerHook` (`game/actions/Planner.ts`) proposes due entries at
   commitment band; unmet prerequisites defer.
2. **Producers & routines (D2):** `json/routines.json` — the habit cadence between hourly needs and rare
   milestones (weekly shopping, calling family, hobby nights, seeing friends), deterministically adopted per
   `(worldSeed, personId, routineId)`. The `see_friends` routine upgrades to a **located** visit
   (`locationOverride: person:<id>`) when a real friend edge exists — the general "go to where that person
   is" mechanism, resolved through the world adapter.
3. **Joint plans (D3):** an invite-consent pattern (`invite_to_activity`) installs **mirrored linked agenda
   entries** in both people's agendas (host at home, guest follows the host) — two linked instances +
   co-location get the couple stroll / dinner guest / playdate with ~20% of a true multi-person-action's
   complexity. Declines ride the existing consent machinery.
