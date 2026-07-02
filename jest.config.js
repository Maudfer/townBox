module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.ts'],
  // tsconfig emits ES modules (so `import.meta` is allowed for the Web Worker, task 036), but the Node test
  // runner needs CommonJS — override just for ts-jest. The import.meta usage lives in a module only loaded via a
  // runtime dynamic import (game/bootstrapWorkerFactory), so tests never compile it.
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { module: 'commonjs' } }]
  },
  moduleNameMapper: {
    '^game/(.*)$': '<rootDir>/src/app/game/$1',
    '^hud/(.*)$': '<rootDir>/src/app/hud/$1',
    '^util/(.*)$': '<rootDir>/src/util/$1',
    '^types/(.*)$': '<rootDir>/src/types/$1',
    '^json/(.*)$': '<rootDir>/src/json/$1',
    '^css/(.*)$': '<rootDir>/src/css/$1'
  },
  // Coverage targets the pure simulation core + utils. The React HUD and the Phaser-only glue
  // (scene boot, render loop, debug overlays) can't be meaningfully unit-covered without a browser
  // harness — that's the Playwright integration suite's job (task 008) — so they're excluded here.
  collectCoverageFrom: ['src/app/game/**/*.ts', 'src/util/**/*.ts'],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    'src/app/game/MainScene.ts',
    'src/app/game/TitleScene.ts',
    'src/app/game/GameManager.ts',
    'src/app/game/DebugTools.ts',
    'src/app/game/bootstrap.worker.ts',
    'src/app/game/bootstrapWorkerFactory.ts'
  ],
  coverageReporters: ['text-summary', 'lcov'],
  // A floor the current suite clears with headroom (~78% stmts / 66% branches); ratchet it up over
  // time. Enforced only under --coverage (CI's `npm run test:coverage`), so `npm test` stays fast.
  coverageThreshold: {
    global: { statements: 72, branches: 60, functions: 75, lines: 72 }
  }
};
