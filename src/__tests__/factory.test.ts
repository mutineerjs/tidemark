// src/__tests__/factory.test.ts
// Tests for createPromptFn with describe injection + retry wiring (CORE-01, CORE-02, CORE-03, CORE-04)

import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod'; // test files may use root 'zod' — simulates user-side code

import { createPromptFn } from '../core/factory.js';
import { MockAdapter } from '../adapters/mock.js';
import { TIDEMARK_META } from '../core/meta.js';
import { TidemarkValidationError, TidemarkInputValidationError } from '../core/errors.js';

describe('createPromptFn — describe injection + retry wiring', () => {
  let adapter: MockAdapter;

  beforeEach(() => {
    adapter = new MockAdapter();
  });

  // CORE-03: system message includes .describe() text from outputSchema
  it('system message sent to adapter contains .describe() annotation from outputSchema', async () => {
    adapter.enqueue({ text: '{"category":"news"}' });

    const fn = createPromptFn({
      name: 'classify',
      prompt: () => 'Classify the input.',
      inputSchema: z.object({}),
      outputSchema: z.object({
        category: z.string().describe('the primary classification label'),
      }),
      adapter,
    });

    await fn({});

    // The first adapter call system message must contain the .describe() text
    const firstCall = adapter.calls[0];
    expect(firstCall.system).toBeDefined();
    expect(firstCall.system).toContain('the primary classification label');
  });

  it('system message contains "Output schema:" section (D-06 ordering)', async () => {
    adapter.enqueue({ text: '{"value":1}' });

    const fn = createPromptFn({
      name: 'test',
      prompt: () => 'Test prompt.',
      inputSchema: z.object({}),
      outputSchema: z.object({ value: z.number() }),
      adapter,
    });

    await fn({});
    expect(adapter.calls[0].system).toContain('Output schema:');
  });

  it('system message ends with JSON instruction sentence (D-06)', async () => {
    adapter.enqueue({ text: '{"value":1}' });

    const fn = createPromptFn({
      name: 'test',
      prompt: () => 'Test prompt.',
      inputSchema: z.object({}),
      outputSchema: z.object({ value: z.number() }),
      adapter,
    });

    await fn({});
    expect(adapter.calls[0].system).toContain('Respond with valid JSON matching this schema.');
  });

  // CORE-04: retry on validation failure — adapter called twice
  it('retries with bad-then-good response: adapter.calls.length === 2', async () => {
    adapter
      .enqueue({ text: '{"category":"wrong-type-123"}' }) // JSON but schema expects no field like this
      .enqueue({ text: '{"category":"news"}' });

    const fn = createPromptFn({
      name: 'retry-test',
      prompt: () => 'Classify the text.',
      inputSchema: z.object({}),
      outputSchema: z.object({ category: z.string() }),
      adapter,
      maxRetries: 2,
    });

    // First adapter response passes schema (category is a string), so let's use a real schema mismatch
    // Reset adapter and use a type mismatch
    adapter.reset();
    adapter
      .enqueue({ text: '{"score": "not-a-number"}' }) // score should be number
      .enqueue({ text: '{"score": 42}' });

    const fn2 = createPromptFn({
      name: 'retry-test-2',
      prompt: () => 'Score the content.',
      inputSchema: z.object({}),
      outputSchema: z.object({ score: z.number() }),
      adapter,
      maxRetries: 2,
    });

    const result = await fn2({});
    expect(result.output.score).toBe(42);
    expect(adapter.calls).toHaveLength(2);
  });

  // CORE-04: D-07 — second adapter call messages contain validation error feedback
  it('D-07: retry call messages contain assistant turn (bad output) + user turn with "Validation failed"', async () => {
    adapter
      .enqueue({ text: '{"score": "bad"}' }) // fails: score must be number
      .enqueue({ text: '{"score": 10}' });   // succeeds

    const fn = createPromptFn({
      name: 'feedback-test',
      prompt: () => 'Give a score.',
      inputSchema: z.object({}),
      outputSchema: z.object({ score: z.number() }),
      adapter,
      maxRetries: 2,
    });

    await fn({});

    // The retry call (second call) must include D-07 validation error feedback turns
    expect(adapter.calls).toHaveLength(2);
    const retryCallMessages = adapter.calls[1].messages;

    // Should have at least: original user message + assistant bad output + user validation error
    expect(retryCallMessages.length).toBeGreaterThanOrEqual(3);

    // Find the user turn containing 'Validation failed'
    const validationErrorTurn = retryCallMessages.find(
      (m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('Validation failed')
    );
    expect(validationErrorTurn).toBeDefined();
  });

  it('D-07: retry messages contain an assistant turn with the bad output text', async () => {
    const badOutput = '{"score": "not-a-number"}';
    adapter
      .enqueue({ text: badOutput })
      .enqueue({ text: '{"score": 5}' });

    const fn = createPromptFn({
      name: 'assistant-turn-test',
      prompt: () => 'Give a score.',
      inputSchema: z.object({}),
      outputSchema: z.object({ score: z.number() }),
      adapter,
      maxRetries: 2,
    });

    await fn({});

    const retryCallMessages = adapter.calls[1].messages;
    // Find the assistant turn — content may be a content-block array or string
    const assistantTurn = retryCallMessages.find((m) => m.role === 'assistant');
    expect(assistantTurn).toBeDefined();
    // The bad output text should appear in the assistant turn content
    const contentStr = JSON.stringify(assistantTurn!.content);
    expect(contentStr).toContain('not-a-number');
  });

  // After maxRetries exhausted, throws TidemarkValidationError
  it('throws TidemarkValidationError after maxRetries exhausted', async () => {
    // 3 bad responses, maxRetries=2 (attempt 0, 1, 2 = 3 total = maxRetries+1)
    adapter
      .enqueue({ text: '{"score": "bad"}' })
      .enqueue({ text: '{"score": "also bad"}' })
      .enqueue({ text: '{"score": "still bad"}' });

    const fn = createPromptFn({
      name: 'exhausted-retries',
      prompt: () => 'Give a score.',
      inputSchema: z.object({}),
      outputSchema: z.object({ score: z.number() }),
      adapter,
      maxRetries: 2,
    });

    await expect(fn({})).rejects.toBeInstanceOf(TidemarkValidationError);
  });

  // CORE-01: result is typed output
  it('result carries typed output fields (CORE-01)', async () => {
    adapter.enqueue({ text: '{"result":"classified"}' });

    const fn = createPromptFn({
      name: 'typed-output',
      prompt: () => 'Classify.',
      inputSchema: z.object({}),
      outputSchema: z.object({ result: z.string() }),
      adapter,
    });

    const out = await fn({});
    expect(out.output.result).toBe('classified');
  });

  // PROV-04: all TidemarkCallMeta fields present
  it('result still carries all TidemarkCallMeta fields (PROV-04 regression)', async () => {
    adapter.enqueue({
      text: '{"status":"ok"}',
      inputTokens: 42,
      outputTokens: 15,
      modelVersion: 'mock-model-v1',
    });

    const fn = createPromptFn({
      name: 'meta-regression',
      prompt: () => 'Check.',
      inputSchema: z.object({}),
      outputSchema: z.object({ status: z.string() }),
      adapter,
    });

    const result = await fn({});
    expect(result.meta.inputTokens).toBe(42);
    expect(result.meta.outputTokens).toBe(15);
    expect(typeof result.meta.estimatedCostUsd).toBe('number');
    expect(typeof result.meta.responseTimeMs).toBe('number');
    expect(result.meta.rawRequest).toBeDefined();
    expect(result.meta.rawResponse).toBeDefined();
  });
});

describe('createPromptFn — inspect()', () => {
  let adapter: MockAdapter;

  beforeEach(() => {
    adapter = new MockAdapter();
  });

  it('returns system containing schema description without calling the adapter', () => {
    const fn = createPromptFn({
      name: 'inspect-system',
      prompt: () => 'Classify this.',
      inputSchema: z.object({}),
      outputSchema: z.object({ label: z.string().describe('the category label') }),
      adapter,
    });

    const result = fn.inspect({});

    expect(result.system).toContain('the category label');
    expect(adapter.calls).toHaveLength(0);
  });

  it('returns userMessage matching what the prompt function produces', () => {
    const fn = createPromptFn({
      name: 'inspect-user-message',
      prompt: (input: { topic: string }) => `Summarise: ${input.topic}`,
      inputSchema: z.object({ topic: z.string() }),
      outputSchema: z.object({ summary: z.string() }),
      adapter,
    });

    const result = fn.inspect({ topic: 'TypeScript' });

    expect(result.userMessage).toBe('Summarise: TypeScript');
  });

  it('messages has exactly 1 item (the user turn) when no prior messages are passed', () => {
    const fn = createPromptFn({
      name: 'inspect-no-prior',
      prompt: () => 'Ask.',
      inputSchema: z.object({}),
      outputSchema: z.object({ value: z.number() }),
      adapter,
    });

    const result = fn.inspect({});

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
  });

  it('messages includes prior messages before the current user turn', () => {
    const fn = createPromptFn({
      name: 'inspect-with-prior',
      prompt: () => 'Follow up.',
      inputSchema: z.object({}),
      outputSchema: z.object({ value: z.number() }),
      adapter,
    });

    const result = fn.inspect({}, {
      messages: [
        { role: 'user', content: 'previous question' },
        { role: 'assistant', content: 'previous answer' },
      ],
    });

    expect(result.messages).toHaveLength(3);
    expect(result.messages[0].content).toBe('previous question');
    expect(result.messages[2].role).toBe('user');
  });

  it('throws TidemarkInputValidationError on invalid input', () => {
    const fn = createPromptFn({
      name: 'inspect-bad-input',
      prompt: (input: { count: number }) => `Count: ${input.count}`,
      inputSchema: z.object({ count: z.number() }),
      outputSchema: z.object({ value: z.number() }),
      adapter,
    });

    expect(() => fn.inspect({ count: 'not-a-number' } as unknown as { count: number }))
      .toThrow(TidemarkInputValidationError);
  });
});

describe('createPromptFn — multi-turn conversation (CALL-03)', () => {
  let adapter: MockAdapter;

  beforeEach(() => {
    adapter = new MockAdapter();
  });

  // Test 1: prior messages are prepended before the current user turn in the adapter request
  it('prepends prior messages before the current user turn in adapter request', async () => {
    adapter.enqueue({ text: '{"value":1}' });

    const fn = createPromptFn({
      name: 'multi-turn-prepend',
      prompt: () => 'Current question.',
      inputSchema: z.object({}),
      outputSchema: z.object({ value: z.number() }),
      adapter,
    });

    await fn({}, { messages: [{ role: 'user', content: 'prev-q' }] });

    // Adapter call messages: [prior-user, current-user] = 2 messages total
    expect(adapter.calls[0].messages).toHaveLength(2);
    expect(adapter.calls[0].messages[0].content).toBe('prev-q');
  });

  // Test 2: result.messages is defined on the return value
  it('result.messages is defined and is an array', async () => {
    adapter.enqueue({ text: '{"value":1}' });

    const fn = createPromptFn({
      name: 'messages-defined',
      prompt: () => 'Ask.',
      inputSchema: z.object({}),
      outputSchema: z.object({ value: z.number() }),
      adapter,
    });

    const result = await fn({});
    expect(result.messages).toBeDefined();
    expect(Array.isArray(result.messages)).toBe(true);
  });

  // Test 3: result.messages without prior messages has length 2 (user + assistant)
  it('result.messages has length 2 when no prior messages are passed (user + assistant)', async () => {
    adapter.enqueue({ text: '{"value":1}' });

    const fn = createPromptFn({
      name: 'messages-no-prior',
      prompt: () => 'Ask.',
      inputSchema: z.object({}),
      outputSchema: z.object({ value: z.number() }),
      adapter,
    });

    const result = await fn({});
    expect(result.messages).toHaveLength(2);
  });

  // Test 4: the last message in result.messages has role 'assistant'
  it('result.messages last item has role "assistant"', async () => {
    adapter.enqueue({ text: '{"value":1}' });

    const fn = createPromptFn({
      name: 'messages-last-assistant',
      prompt: () => 'Ask.',
      inputSchema: z.object({}),
      outputSchema: z.object({ value: z.number() }),
      adapter,
    });

    const result = await fn({});
    const lastMessage = result.messages[result.messages.length - 1];
    expect(lastMessage.role).toBe('assistant');
  });

  // Test 5: chained turns — second call with result1.messages produces 3-message adapter call
  it('chained turns: second call with result1.messages has 3 messages in adapter call', async () => {
    adapter
      .enqueue({ text: '{"value":1}' })
      .enqueue({ text: '{"value":2}' });

    const fn = createPromptFn({
      name: 'chained-turns',
      prompt: () => 'Next question.',
      inputSchema: z.object({}),
      outputSchema: z.object({ value: z.number() }),
      adapter,
    });

    // First turn — result1.messages will be [user, assistant] (2 messages)
    const result1 = await fn({});
    expect(result1.messages).toHaveLength(2);

    // Second turn — pass result1.messages as prior context
    // adapter should receive: [prior-user, prior-assistant, current-user] = 3 messages
    await fn({}, { messages: result1.messages });
    expect(adapter.calls[1].messages).toHaveLength(3);
  });

  // Test 6: with 1 prior message, result.messages has length 3 (prior + user + assistant)
  it('result.messages has length 3 when 1 prior message is passed', async () => {
    adapter.enqueue({ text: '{"value":1}' });

    const fn = createPromptFn({
      name: 'messages-with-prior',
      prompt: () => 'Follow-up.',
      inputSchema: z.object({}),
      outputSchema: z.object({ value: z.number() }),
      adapter,
    });

    const result = await fn({}, { messages: [{ role: 'user', content: 'prev question' }] });
    // [prior-user, current-user, assistant] = 3 messages
    expect(result.messages).toHaveLength(3);
  });
});
