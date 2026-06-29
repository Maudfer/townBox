# TownBox

Simple city builder in javascript using Phaser 4 engine

![townbox](https://github.com/RunoFawkes/townBox/assets/118758876/cbaf1c38-cd21-461b-ab87-3888de5c1c9c)

# Usage

```
npm install
npm run dev
```

# Testing & CI

```
npm test               # unit suite (Jest + ts-jest, fast)
npm run test:coverage  # unit suite with coverage + threshold gate (game/ + util/)
npm run typecheck      # strict TypeScript check (tsc --noEmit)
npm run build-prod     # production Parcel build
```

GitHub Actions (`.github/workflows/ci.yml`) runs the type check, the coverage-gated unit suite, and the
production build on every PR to `main` and every push to `main`. These should be set as **required status
checks** on `main` (and direct pushes to `main` disabled) so PRs can't merge red — consistent with the
no-direct-merge directive in `CLAUDE.md`. The Playwright integration suite (task 008) is not wired into CI yet;
a job is reserved in the workflow for when it lands.
