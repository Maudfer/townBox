// Test modules (task: game/test reorg). Each folder under test/ is an independent Jest "project",
// so `npx jest --selectProjects <name>` runs one module in isolation and CI runs them as separate,
// concurrent checks. `npm test` runs them all; `npm run test:coverage` runs them all with the global
// coverage gate. Keep this list in sync with test/<module>/ folders and the CI workflow matrix.
// Each module owns a slice of the source tree for coverage. The union is the whole covered surface
// (game/** + util/** minus the Phaser-only glue: scene/ and GameManager, which have no unit tests).
// Per-module ownership (rather than one global collectCoverageFrom) is what lets CI's path-based
// skipping coexist with the coverage gate: a partial run reports ONLY the ran modules' slices, so the
// merged gate checks the coverage of exactly the code that ran instead of counting un-run files as 0%.
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

// Per-module coverage thresholds enforced in CI by scripts/coverage-gate.mjs (which groups the
// full-suite coverage report by module — so cross-module/integration coverage counts). The default is
// the project floor; ten modules clear it. world/agents/save fall short ONLY on browser/Phaser code
// that can't be meaningfully unit-covered without a scene harness — Vehicle/Road/Person render+drive
// animation and the localStorage SaveProvider — the same reason scene/ and GameManager are excluded
// entirely. They carry a documented lower floor here; raise them to the default as the browser
// integration suite (task 008) covers that code. These floors sit just under today's numbers, so a
// regression still trips the gate.
const DEFAULT_THRESHOLD = { statements: 72, branches: 60, functions: 75, lines: 72 };
const MODULE_THRESHOLDS = {
  world: { statements: 64, branches: 44, functions: 68, lines: 64 },
  agents: { statements: 44, branches: 32, functions: 56, lines: 44 },
  save: { statements: 72, branches: 60, functions: 55, lines: 72 },
};

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
  projects: MODULES.map((name) => ({
    ...base,
    displayName: name,
    testMatch: [`<rootDir>/test/${name}/**/*.test.ts`],
    // Per-project coverage scope (see MODULE_COVERAGE). Running one project with --coverage collects
    // only that module's slice; running all projects unions them into the whole covered surface.
    collectCoverageFrom: MODULE_COVERAGE[name],
  })),

  coveragePathIgnorePatterns: ['/node_modules/'],
  // 'json' emits coverage/coverage-final.json — CI's per-module jobs upload it and the coverage-gate
  // job (scripts/coverage-gate.mjs) merges every module's file, so the merged result is the true
  // aggregate. text-summary/lcov are for local + artifact reporting.
  coverageReporters: ['text-summary', 'lcov', 'json'],
  // Aggregate backstop for the local full run (`npm run test:coverage`): the whole suite clears this
  // with headroom (~85% stmts). CI additionally enforces the PER-MODULE thresholds above via
  // scripts/coverage-gate.mjs.
  coverageThreshold: {
    global: { statements: 72, branches: 60, functions: 75, lines: 72 },
  },
};

// Exported for scripts/coverage-gate.mjs (single source of truth for module scopes + thresholds).
module.exports.MODULE_COVERAGE = MODULE_COVERAGE;
module.exports.DEFAULT_THRESHOLD = DEFAULT_THRESHOLD;
module.exports.MODULE_THRESHOLDS = MODULE_THRESHOLDS;
