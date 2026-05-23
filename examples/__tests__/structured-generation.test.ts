// Excluded from CI — vitest.config.ts include: ['src/**/*.test.ts'] only picks up src/ files.
// Run manually: npx vitest run examples/__tests__/structured-generation.test.ts (requires ANTHROPIC_API_KEY)
// Snapshot test doubles as integration test fixture when ANTHROPIC_API_KEY is set.
import { it } from 'vitest';
import { expectPromptFn } from '../../src/vitest/index.js';
import { generateFn } from '../structured-generation.js';

it('generateFn matches snapshot', async () => {
  await expectPromptFn(generateFn).toMatchSnapshot([
    {
      name: 'typescript-testing',
      input: {
        topic: 'TypeScript snapshot testing for LLM applications',
      },
    },
    {
      name: 'open-source',
      input: {
        topic: 'Benefits of open source software for developer productivity',
      },
    },
  ]);
});
