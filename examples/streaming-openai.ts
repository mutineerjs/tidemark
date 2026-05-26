// Run: npx tsx examples/streaming-openai.ts
// Requires: OPENAI_API_KEY
// Demonstrates: fn.stream() with OpenAI adapter

import { createPromptFn, OpenAIAdapter } from '../src/index.js';
import * as z from 'zod';

const adapter = new OpenAIAdapter('gpt-4o', {
  apiKey: process.env.OPENAI_API_KEY,
});

const inputSchema = z.object({
  topic: z.string().describe('topic to write about'),
});

const outputSchema = z.object({
  headline: z.string().describe('attention-grabbing headline for the topic'),
  bullets: z.array(z.string()).describe('3-5 key points about the topic'),
});

export const streamingFn = createPromptFn({
  name: 'streaming-generation',
  prompt: (input) => `Generate structured content about: ${input.topic}`,
  inputSchema,
  outputSchema,
  adapter,
});

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const stream = streamingFn.stream({
    topic: 'TypeScript snapshot testing for LLM applications',
  });
  process.stdout.write('Streaming: ');
  try {
    for await (const chunk of stream) {
      if (chunk.type === 'text') process.stdout.write(chunk.delta);
    }
    process.stdout.write('\n\n');
    const { output, meta } = await stream.finalOutput();
    console.log('--- output ---');
    console.log(JSON.stringify(output, null, 2));
    console.log('\n--- meta ---');
    const { rawRequest: _req, rawResponse: _res, ...displayMeta } = meta;
    console.log(JSON.stringify(displayMeta, null, 2));
  } finally {
    stream.abort();
  }
}
