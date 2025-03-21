module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: [
        "**/*.test.ts",
        "**/src/__tests__/**/*.ts"
      ],
    verbose: true,
    testTimeout: 600000, // Default timeout of 60 seconds for all tests
    bail: false, // Continue running tests even after a failure
    collectCoverage: true,
    collectCoverageFrom: [
      'src/**/*.ts',
      '!src/api/**/*.ts',
      '!src/model/**/*.ts'
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['json', 'lcov', 'text', 'clover'],
    moduleFileExtensions: ['ts', 'js', 'json'],
    transform: {
      '^.+\\.ts$': 'ts-jest'
    },
    globals: {
      'ts-jest': {
        tsconfig: 'tsconfig.json'
      }
    }
  };