import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: true,
    coverage: {
      reporter: ['text', 'json-summary', 'lcov'],
      // Thresholds sit a few points below measured coverage so real regressions fail
      // the build without being brittle. Update alongside intentional coverage shifts.
      thresholds: {
        lines: 85,
        statements: 84,
        functions: 88,
        branches: 70,
      },
    },
  },
});
