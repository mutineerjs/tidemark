// Run: npx tsx examples/multi-turn-openai.ts
// Requires: OPENAI_API_KEY
// Demonstrates: multi-turn conversation using result.messages (CALL-03) with OpenAI

import { createPromptFn, OpenAIAdapter } from '../src/index.js';
import * as z from 'zod';

const adapter = new OpenAIAdapter('gpt-4o', {
  apiKey: process.env.OPENAI_API_KEY,
});

const inputSchema = z.object({
  question: z.string().describe('question to answer'),
});

const outputSchema = z.object({
  answer: z.string().describe('concise answer to the question'),
  followUp: z.string().describe('a natural follow-up question the user might ask next'),
});

export const qaFn = createPromptFn({
  name: 'multi-turn-qa-openai',
  prompt: (input) => `Answer this question concisely: ${input.question}`,
  inputSchema,
  outputSchema,
  adapter,
});

if (process.argv[1] === new URL(import.meta.url).pathname) {
  // Turn 1 — first question
  const turn1 = await qaFn({ question: 'What is snapshot testing?' });
  console.log('--- Turn 1 ---');
  console.log(JSON.stringify(turn1.output, null, 2));
  console.log(`conversation depth: ${turn1.messages.length} messages`);

  // Turn 2 — pass messages from turn 1 so the model has conversation context
  const turn2 = await qaFn(
    { question: 'How does it work with LLM output specifically?' },
    { messages: turn1.messages }
  );
  console.log('\n--- Turn 2 (with conversation context) ---');
  console.log(JSON.stringify(turn2.output, null, 2));
  console.log(`conversation depth: ${turn2.messages.length} messages`);
}
