import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['examples/**/*.test.ts'],
    testTimeout: 60_000, // 30s is usually enough for a first run to write snapshot, even with a slow LLM. Subsequent runs should be much faster. Adjust as needed.
  },
});
