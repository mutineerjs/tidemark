// Excluded from CI — vitest.config.ts include: ['src/**/*.test.ts'] only picks up src/ files.
// Run manually: npx vitest run examples/__tests__/structured-generation-openai.test.ts (requires OPENAI_API_KEY)

import { it } from 'vitest';
import { expectPromptFn } from '../../src/vitest/index.js';
import { generateFn } from '../structured-generation-openai.js';

it('generateFn (OpenAI) matches snapshot', async () => {
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
