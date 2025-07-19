module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.ts'],
  moduleNameMapper: {
    '^game/(.*)$': '<rootDir>/src/app/game/$1',
    '^hud/(.*)$': '<rootDir>/src/app/hud/$1',
    '^util/(.*)$': '<rootDir>/src/util/$1',
    '^types/(.*)$': '<rootDir>/src/types/$1',
    '^json/(.*)$': '<rootDir>/src/json/$1',
    '^css/(.*)$': '<rootDir>/src/css/$1'
  }
};
