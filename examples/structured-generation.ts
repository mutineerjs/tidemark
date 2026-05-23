// Run: npx tsx examples/structured-generation.ts
// Requires: ANTHROPIC_API_KEY

import { createPromptFn, AnthropicAdapter } from '../src/index.js';
import * as z from 'zod';

const adapter = new AnthropicAdapter('claude-sonnet-4-5-20250929', {
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const inputSchema = z.object({
  topic: z.string().describe('topic to write about'),
});

const outputSchema = z.object({
  headline: z
    .string()
    .describe('attention-grabbing headline for the topic'),
  bullets: z
    .array(z.string())
    .describe('3-5 key points about the topic'),
  tags: z
    .array(z.string())
    .describe('relevant tags or keywords, 3-6 items'),
});

export const generateFn = createPromptFn({
  name: 'structured-generation',
  prompt: (input) =>
    `Generate structured content about this topic: ${input.topic}`,
  inputSchema,
  outputSchema,
  adapter,
});

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const result = await generateFn({
    topic: 'TypeScript snapshot testing for LLM applications',
  });
  console.log(JSON.stringify(result.output, null, 2));
  console.log('\n--- meta ---');
  const { rawRequest: _req, rawResponse: _res, ...displayMeta } = result.meta;
  console.log(JSON.stringify(displayMeta, null, 2));
}
