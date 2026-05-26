// Excluded from CI — vitest.config.ts include: ['src/**/*.test.ts'] only picks up src/ files.
// Run manually: npx vitest run examples/__tests__/classification-openai.test.ts (requires OPENAI_API_KEY)

import { it } from 'vitest';
import { expectPromptFn } from '../../src/vitest/index.js';
import { classifyFn } from '../classification-openai.js';

it('classifyFn (OpenAI) matches snapshot', async () => {
  await expectPromptFn(classifyFn).toMatchSnapshot([
    {
      name: 'billing-dispute',
      input: {
        text: 'I was charged twice for my subscription this month. Please refund the duplicate charge at your earliest convenience.',
      },
    },
    {
      name: 'tech-support',
      input: {
        text: 'My app keeps crashing every time I try to upload a photo. I am on iOS 17.4.',
      },
    },
  ]);
});
