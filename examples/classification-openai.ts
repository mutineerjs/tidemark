// Run: npx tsx examples/classification-openai.ts
// Requires: OPENAI_API_KEY

import { createPromptFn, OpenAIAdapter } from '../src/index.js';
import * as z from 'zod';

const adapter = new OpenAIAdapter('gpt-4o', {
  apiKey: process.env.OPENAI_API_KEY,
});

const inputSchema = z.object({
  text: z.string().describe('customer support message text'),
});

const outputSchema = z.object({
  category: z
    .enum(['billing', 'technical', 'general', 'refund'])
    .describe('support ticket category'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('classification confidence between 0 and 1'),
  priority: z
    .enum(['low', 'medium', 'high'])
    .describe('issue priority level'),
});

export const classifyFn = createPromptFn({
  name: 'classify-support-message',
  prompt: (input) =>
    `Classify this customer support message:\n\n${input.text}`,
  inputSchema,
  outputSchema,
  adapter,
  temperature: 0, // deterministic output for testing
});

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const result = await classifyFn({
    text: 'I was charged twice for my subscription this month. Please refund the duplicate charge immediately.',
  });
  console.log(JSON.stringify(result.output, null, 2));
  console.log('\n--- meta ---');
  const { rawRequest: _req, rawResponse: _res, ...displayMeta } = result.meta;
  console.log(JSON.stringify(displayMeta, null, 2));
}
