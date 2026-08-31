import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['packages/*/src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // Tests run against real shared Postgres + Redis; each test file truncates
    // the tables it owns in beforeEach, so files must run sequentially to avoid
    // cross-file state collisions on the same database.
    fileParallelism: false,
    pool: 'forks',
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/node_modules/**'],
      // Keep the floor below the current baseline so CI is not flaky, but high
      // enough to prevent new code from silently dropping coverage.
      thresholds: {
        statements: 50,
        branches: 45,
        functions: 45,
        lines: 50,
      },
    },
  },
});
