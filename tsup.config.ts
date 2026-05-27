import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/vitest/index.ts', 'src/testing/index.ts', 'src/jest/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  external: ['zod', 'vitest', 'jest', '@jest/globals', 'perf_hooks', 'node:perf_hooks'],
  // @anthropic-ai/sdk is NOT external — it's a devDep, not a peerDep.
  // It ships inside the Tideline bundle as an implementation detail.
});
