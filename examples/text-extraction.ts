// Run: npx tsx examples/text-extraction.ts
// Requires: ANTHROPIC_API_KEY

import { createPromptFn, AnthropicAdapter } from '../src/index.js';
import * as z from 'zod';

const adapter = new AnthropicAdapter('claude-sonnet-4-5-20250929', {
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const inputSchema = z.object({
  url: z.string().describe('article URL'),
  text: z.string().describe('raw scraped text content'),
});

const outputSchema = z.object({
  title: z.string().describe('article title'),
  summary: z
    .string()
    .describe('2-3 sentence summary of the article'),
  publishedDate: z
    .string()
    .describe(
      'publication date in ISO format if found, empty string if not'
    ),
});

export const extractFn = createPromptFn({
  name: 'text-extraction',
  prompt: (input) =>
    `Extract structured information from this article.\n\nURL: ${input.url}\n\nContent:\n${input.text}`,
  inputSchema,
  outputSchema,
  adapter,
});

if (process.argv[1] === new URL(import.meta.url).pathname) {
  console.log(extractFn.inspect({
    url: 'https://example.com/article',
    text: 'Researchers at Stanford announced a breakthrough in quantum computing today. The new approach uses topological qubits to achieve error rates below 0.1%. Lead researcher Dr. Jane Smith called it a milestone for the field.',
  }));
  console.log();
  const result = await extractFn({
    url: 'https://example.com/article',
    text: 'Researchers at Stanford announced a breakthrough in quantum computing today. The new approach uses topological qubits to achieve error rates below 0.1%. Lead researcher Dr. Jane Smith called it a milestone for the field.',
  });
  console.log(JSON.stringify(result.output, null, 2));
  console.log('\n--- meta ---');
  const { rawRequest: _req, rawResponse: _res, ...displayMeta } = result.meta;
  console.log(JSON.stringify(displayMeta, null, 2));
}
