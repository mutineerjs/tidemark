// Excluded from CI — vitest.config.ts include: ['src/**/*.test.ts'] only picks up src/ files.
// Run manually: npx vitest run examples/__tests__/multi-turn.test.ts (requires ANTHROPIC_API_KEY)

import { it, expect } from 'vitest';
import { qaFn } from '../multi-turn.js';

it('qaFn continues conversation across turns via messages', async () => {
  // Turn 1
  const turn1 = await qaFn({ question: 'What is snapshot testing?' });
  expect(typeof turn1.output.answer).toBe('string');
  expect(turn1.output.answer.length).toBeGreaterThan(0);
  expect(turn1.messages).toHaveLength(2); // user + assistant

  // Turn 2 — passes prior messages to continue the conversation
  const turn2 = await qaFn(
    { question: 'Can you give a brief example?' },
    { messages: turn1.messages }
  );
  expect(typeof turn2.output.answer).toBe('string');
  expect(turn2.output.answer.length).toBeGreaterThan(0);
  expect(turn2.messages).toHaveLength(4); // prior 2 + user + assistant
}, 60_000);
