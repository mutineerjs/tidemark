// Excluded from CI — vitest.config.ts include: ['src/**/*.test.ts'] only picks up src/ files.
// Run manually: npx vitest run examples/__tests__/text-extraction-openai.test.ts (requires OPENAI_API_KEY)

import { it } from 'vitest';
import { expectPromptFn } from '../../src/vitest/index.js';
import { extractFn } from '../text-extraction-openai.js';

it('extractFn (OpenAI) matches snapshot', async () => {
  await expectPromptFn(extractFn).toMatchSnapshot([
    {
      name: 'short-article',
      input: {
        url: 'https://example.com/article',
        text: 'Researchers at Stanford announced a breakthrough in quantum computing today. The new approach uses topological qubits to achieve error rates below 0.1%. Lead researcher Dr. Jane Smith called it a milestone for the field.',
      },
    },
    {
      name: 'news-brief',
      input: {
        url: 'https://example.com/news',
        text: 'The city council voted 7-2 to approve the new transit expansion plan on Tuesday. Construction is expected to begin in 2027.',
      },
    },
  ]);
});
