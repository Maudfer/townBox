# [Core] Arbitration v2 — priority bands & the one utility currency

- **Type:** Core (the Brain rework)
- **Labels:** `simulation`, `brain`, `arbitration`, `aliveness`
- **Status:** ✅ Done
- **Proposal:** [`docs/proposals/simulation-aliveness.md`](../proposals/simulation-aliveness.md) — Workstream
  L (L1 tenet break, L2 bands, L3 utility, L4 interruption matrix, L6 decision cadence). Phase 2. The
  riskiest single change in the arc — every behavior flows through it.

## Goal

The flat `necessity(3) → priority → hook order` sort collapses once 084/085 multiply the intent sources
(a shift, a planned visit, a critical need, and a social opening can all claim "required"). Replace it with
priority bands and one shared utility currency — and formally break the Brain's stateless tenet.

## What shipped

1. **The tenet break (L1):** `Brain.ts`'s header and CLAUDE.md updated in the same change — the new
   doctrine is **"owns no state but reads many"**: a decision is a function of (log, active instance, needs,
   mood, edges, agenda, habits, traits), every one a serialized store *outside* the Brain read through
   `BrainDeps`. What survives: hooks propose / Brain arbitrates / the engine executes; nothing serializes
   inside the Brain; determinism; live↔bootstrap equivalence.
2. **Priority bands (L2):** a closed band enum highest-first — `survival` / `obligation` / `commitment` /
   `need` / `opportunity` / `fallback`; intents declare `band` + an in-band utility; built-in hooks migrated
   via the mechanical necessity mapping (`bandOf`). Arbitration is band → utility → hook order → actionId.
3. **One utility currency (L3):** a single `scoreIntent` helper prices every intent as authored weight ×
   need urgency × mood × trait affinity — no hook rolls its own scoring math ever again; data keeps the last
   word everywhere at once.
4. **Interruption matrix + commitment inertia (L4, `json/arbitration.json`):** an intent interrupts a
   running action only from a strictly higher band, or same-band above an authored hysteresis threshold
   (people finish what they start unless the case is clear — killing threshold flip-flop); survival
   interrupts anything. A post-start decision cooldown (L6) trims wasted re-evaluations.
5. **The migration proof (L7):** the built-in hooks migrated behind an equivalence corpus (old-sort vs.
   new-band outcomes match except where divergence is intentional and listed).
