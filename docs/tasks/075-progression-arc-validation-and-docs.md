# [Test/Docs] Progression & context arc — end-to-end validation and documentation

- **Type:** Test / Documentation
- **Labels:** `testing`, `docs`, `progression-arc`
- **Depends on:** all of [057](057-calendar-weekdays-and-weekends_DONE.md)–[074](074-person-targeted-actions-backfill.md) (final gate of the arc)
- **Blocks:** [055](055-history-asset-pipeline.md) should start only after this passes (the asset captures the arc)

## Goal

Prove the whole arc holds together as *one* simulation — closed loops, both execution modes, deterministic —
and document the two macro-flows so the next contributor (and 055's offline generator) inherits an accurate
map: **Calendar → Brain → School/Job → Skills → Actions/Events** and
**Building Tags → Object Generation → Action Requirements → Possessions**.

## Requirements

### End-to-end scenario suite (deterministic, fast configs)

One seeded fixture town (house(s) + school + a granting employer + shops), exercising each loop end to end —
these overlap per-task tests deliberately; here they run *together*, catching cross-system interference:

- **A life, fast-forwarded:** a child enrolls at 7 → attends weekdays only → basics grow at the calendar-exact
  rate → ages out at 18 with ≈60 basics (perfect attendance) → hired via the entry training grant into a
  skilled profession → work days accrue primary/secondary proficiency → promoted at a rank-evaluation boundary
  → the feed/logs narrate every step with correct causation.
- **Objects live:** generated house/business objects satisfy activity requirements (cook/write/shower); a
  person grabs/pockets/buys real instances (conservation asserted); a lend → return loop closes across two
  household members; a consent decline mutates nothing.
- **Negative paths:** unassigned child stays free-time with zero school progression; a person failing an entry
  grant closure is skipped but hireable elsewhere; a failed action is not retried within cooldown.

### Live ↔ bootstrap equivalence

- Run the same scenario seed under `live` (LiveWorld, real transitions) and `bootstrap` (BootstrapWorld,
  instant resolution); compare simulation-state outcomes **after materialization differences resolve** —
  skill records, ranks, logs-modulo-transition-timing, inventories. Extend `test/executionBoundary.test.ts`'s
  comparison machinery; document accepted divergences (arrival-tick offsets) explicitly. This is the arc's
  keystone guarantee for 055.

### Performance & budget re-pins

- Re-pin the tick budget (`test/eventEligibility.test.ts`-style) with the arc's full data (more events/actions,
  school+social hooks, SkillProgression) — record the new numbers; 055 depends on the headroom.
- Record snapshot-size growth (skills store, assignments, generated objects) on the fixture town; confirm the
  070 cap keeps it acceptable.

### Documentation (same-PR requirements, per §5.7)

- `docs/simulation-flows.md`: new numbered sections in the house style (prose + mermaid) — school day →
  progression; training-grant hire → work progression → promotion; building tags → generation → requirements →
  possessions; consent handshake; each tagged pure-data / code-change / execution-boundary in the closing
  section.
- `util/simulationDocs.ts` / `docs/simulation-relationships.md`: extend the generator to the new manifests
  (skills DAG, job ranks, placement tags, interaction contracts) so the checked-diff gate covers them;
  `npm run docs:sim` regenerated.
- `CLAUDE.md`: update §1 (current state), §3 (new files), §4 (new subsections: calendar/school, skills store &
  progression, ranks & grants incl. the **temporary College shortcut** and the proficiency vision note
  (musician 80/95), placement tags & object generation, interaction contracts & consent) — verifying each task
  already carried its slice (5.7 says same-PR; this task audits and fills gaps).
- `README.md`: refresh the simulation-loop diagram/roadmap (skills now have proficiency arrows into jobs;
  objects/context; the arc moves from planned to shipped).
- [055](055-history-asset-pipeline.md): append a short "captures the progression arc" note to its §0-bis
  (schools/skills/objects/consent must run in the offline world; the logical-world scope now includes school
  venues and building object generation).

## Non-goals

New features or balance work beyond what the scenarios expose as broken. Playwright/browser tests (008 remains
its own task).

## Testing

This task *is* testing; its own gate: `npm test`, `npm run test:coverage`, `npm run typecheck`,
`npm run validate-data`, `npm run docs:sim` diff-clean — all green with the full arc merged.
