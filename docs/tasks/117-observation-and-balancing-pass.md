# [Task] The observation & balancing pass

- **Type:** Task (playtest + tuning)
- **Labels:** `simulation`, `balance`, `playtest`, `visibility`
- **Status:** 🚧 Open (scaffolding shipped; the session itself is the maintainer's pass)
- **Proposal:** [`docs/proposals/simulation-visibility.md`](../proposals/simulation-visibility.md) — task 117.

## Goal

The payoff session: with both arcs landed, run a real game, watch the town live, and tune the rates/weights
that read wrong. The scaffolding is code; the observation and the balancing-notes deliverable are a human
pass and are **not** part of the bundled PR.

## What shipped (the scaffolding)

- **The time throttle:** `T` cycles 1× → 4× → 16× (`util/time.ts` `nextTimeScale`, unit-tested with the
  out-of-band reset) — a pure frame-delta multiplier on `GameManager.advanceTime`, so every downstream signal
  and the whole simulation runs faster wall-clock with zero new code paths. Never serialized; always 1× in
  normal play; `debug.masterSwitch`-gated like the other overlays.
- **The vitals overlay:** one fixed camera-locked line (people / employed / open incidents / worst service /
  current speed) in `MainScene`, refreshed per in-game minute, created only under `masterSwitch`.

## Remaining (the maintainer's pass)

- Run the session (new game → roads, houses, the civic set, a supermarket → watch job seeking, commutes,
  venue trips, gossip, chases, dog walks; inspect inventories, person logs, the services panel).
- Produce `docs/proposals/visibility-balancing-notes.md` — observed issues ranked, with immediate small
  tunings applied (rates/weights only; structural findings become proposed follow-ups).
