// Test modules (task: game/test reorg). Each folder under test/ is an independent Jest "project", so
// `npx jest --selectProjects <name>` runs one module in isolation and CI runs them as separate,
// concurrent checks. `npm test` runs them all.
//
// Each module owns a slice of the source tree for coverage (collectCoverageFrom below). Running one
// project with --coverage collects ONLY that module's slice, covered by ONLY that module's own tests —
// so each CI `test (<module>)` job emits a self-contained per-module coverage report. The `coverage`
// job then reads every module's report and fails if any is below COVERAGE_THRESHOLD (see
// scripts/coverage-gate.mjs). NOTE: these per-module numbers are much lower than the whole-suite
// aggregate because this codebase's tests are integration-heavy (a file is driven to high coverage by
// OTHER modules' tests, which a module's own isolated report can't see) — that gap is deliberate: the
// gate is a forcing function to grow each module's own unit tests.
const MODULE_COVERAGE = {
  world: ['src/app/game/world/**/*.ts'],
  agents: ['src/app/game/agents/**/*.ts'],
  population: ['src/app/game/population/**/*.ts'],
  events: ['src/app/game/events/**/*.ts'],
  actions: ['src/app/game/actions/**/*.ts'],
  // execution owns the tick spine plus the two root orchestrators the cross-system suite exercises.
  execution: ['src/app/game/execution/**/*.ts', 'src/app/game/City.ts', 'src/app/game/Clock.ts'],
  economy: ['src/app/game/economy/**/*.ts'],
  skills: ['src/app/game/skills/**/*.ts'],
  objects: ['src/app/game/objects/**/*.ts'],
  history: ['src/app/game/history/**/*.ts'],
  save: ['src/app/game/save/**/*.ts'],
  data: ['src/app/game/data/**/*.ts'],
  util: ['src/util/**/*.ts'],
};
const MODULES = Object.keys(MODULE_COVERAGE);

// The single global coverage floor (statement %) every module must independently meet. Set it here —
// scripts/coverage-gate.mjs imports it, so this is the one place to change the number.
const COVERAGE_THRESHOLD = 80;

// Shared per-project settings. tsconfig emits ES modules (so `import.meta` is allowed for the Web
// Worker, task 036), but the Node test runner needs CommonJS — override just for ts-jest. The
// import.meta usage lives in a module only loaded via a runtime dynamic import
// (game/execution/... worker factory), so tests never compile it.
const base = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { module: 'commonjs' } }],
  },
  moduleNameMapper: {
    '^game/(.*)$': '<rootDir>/src/app/game/$1',
    '^hud/(.*)$': '<rootDir>/src/app/hud/$1',
    '^util/(.*)$': '<rootDir>/src/util/$1',
    '^types/(.*)$': '<rootDir>/src/types/$1',
    '^json/(.*)$': '<rootDir>/src/json/$1',
    '^css/(.*)$': '<rootDir>/src/css/$1',
  },
};

module.exports = {
  // Memory safety (local dev). This machine has 32 logical CPUs, so Jest's default maxWorkers (CPUs - 1 = 31)
  // spins up ~31 ts-jest worker processes for a full `npm test` sweep — each holding the heavy simulation
  // module graph (faker + the object/event manifests + the sim core) — which spikes NodeJS RAM to ~20GB and
  // thrashes the Windows page file. Cap the pool and give each worker a heap ceiling so a bloated worker is
  // recycled between test files. Override with `--maxWorkers=<n>` when you have headroom. CI runs modules as
  // separate `--selectProjects` jobs (few files each), so this cap doesn't slow it.
  maxWorkers: process.env.JEST_MAX_WORKERS ? Number(process.env.JEST_MAX_WORKERS) : 4,
  workerIdleMemoryLimit: '1GB',

  projects: [
    ...MODULES.map((name) => ({
      ...base,
      displayName: name,
      testMatch: [`<rootDir>/test/${name}/**/*.test.ts`],
      // Per-project coverage scope: `jest --selectProjects <name> --coverage` collects only this module's
      // slice, so the emitted report is that module measured by its own tests.
      collectCoverageFrom: MODULE_COVERAGE[name],
    })),
    // Perf module — unit perf-regression gates for the generation spine. Its own project so
    // `jest --selectProjects perf` runs it in isolation; CI runs it --runInBand with NO coverage (istanbul
    // instrumentation would skew the timings). Deliberately OUTSIDE MODULE_COVERAGE, so the coverage gate
    // never expects a `coverage-perf` report; it collects no coverage of its own.
    {
      ...base,
      displayName: 'perf',
      testMatch: ['<rootDir>/test/perf/**/*.test.ts'],
      collectCoverageFrom: [],
    },
  ],

  coveragePathIgnorePatterns: ['/node_modules/'],
  // json  -> coverage/coverage-final.json, read by scripts/coverage-gate.mjs (the machine-readable gate input)
  // lcov  -> coverage/lcov.info, human-readable per-module report (the artifact)
  coverageReporters: ['text-summary', 'lcov', 'json'],
};

// Exported for scripts/coverage-gate.mjs (single source of truth for module scopes + the threshold).
module.exports.MODULE_COVERAGE = MODULE_COVERAGE;
module.exports.COVERAGE_THRESHOLD = COVERAGE_THRESHOLD;
