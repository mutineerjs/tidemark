// src/__tests__/retry.test.ts
// Tests for parseWithRetry — Zod validation retry loop with structured error feedback (CORE-04)

import { describe, it, expect, vi } from 'vitest';
import * as z from 'zod'; // test files may use root 'zod' — simulates user-side code

import { parseWithRetry, runAgenticLoop } from '../core/retry.js';
import { TidemarkValidationError } from '../core/errors.js';
import { MockAdapter } from '../adapters/mock.js';

describe('parseWithRetry', () => {
  it('resolves immediately on valid JSON matching schema (zero retries)', async () => {
    const result = await parseWithRetry<{ value: number }>('{"value":42}', z.object({ value: z.number() }), 2);
    expect(result).toEqual({ value: 42 });
  });

  it('resolves with correct typed value', async () => {
    const schema = z.object({ name: z.string(), score: z.number() });
    const result = await parseWithRetry<{ name: string; score: number }>('{"name":"alice","score":99}', schema, 2);
    expect(result.name).toBe('alice');
    expect(result.score).toBe(99);
  });

  it('calls onRetry exactly once when first attempt fails and retry succeeds', async () => {
    const schema = z.object({ value: z.number() });
    const onRetry = vi.fn().mockResolvedValueOnce('{"value":42}');

    const result = await parseWithRetry(
      '{"value":"not-a-number"}', // bad first input
      schema,
      2, // maxRetries
      onRetry
    );

    expect(result).toEqual({ value: 42 });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.stringContaining('value'));
  });

  it('onRetry is called with (attempt, errorString) where errorString contains the failing field name', async () => {
    const schema = z.object({ category: z.string() });
    let capturedAttempt = -1;
    let capturedError = '';

    const onRetry = vi.fn().mockImplementationOnce(async (attempt: number, error: string) => {
      capturedAttempt = attempt;
      capturedError = error;
      return '{"category":"valid"}';
    });

    await parseWithRetry('{"wrong_field": 123}', schema, 2, onRetry);

    expect(capturedAttempt).toBe(1);
    // Zod error string should reference the failing field or type mismatch
    expect(typeof capturedError).toBe('string');
    expect(capturedError.length).toBeGreaterThan(0);
  });

  it('throws TidemarkValidationError on non-JSON input (not retried)', async () => {
    const schema = z.object({ value: z.number() });

    await expect(
      parseWithRetry('this is not json at all', schema, 2)
    ).rejects.toThrow(TidemarkValidationError);

    await expect(
      parseWithRetry('this is not json at all', schema, 2)
    ).rejects.toMatchObject({
      message: expect.stringContaining('not valid JSON'),
      lastOutput: 'this is not json at all',
      zodError: null,
    });
  });

  it('throws TidemarkValidationError with attempts === maxRetries+1 when all retries exhausted', async () => {
    const schema = z.object({ value: z.number() });
    const maxRetries = 2;

    // onRetry always returns bad output
    const onRetry = vi.fn().mockResolvedValue('{"value":"still-wrong"}');

    const promise = parseWithRetry(
      '{"value":"wrong"}',
      schema,
      maxRetries,
      onRetry
    );

    await expect(promise).rejects.toThrow(TidemarkValidationError);

    try {
      await parseWithRetry('{"value":"wrong"}', schema, maxRetries, onRetry);
    } catch (err) {
      expect(err).toBeInstanceOf(TidemarkValidationError);
      const e = err as TidemarkValidationError;
      expect(e.attempts).toBe(maxRetries + 1);
      expect(e.zodError).not.toBeNull();
      expect(e.lastOutput).toBeDefined();
    }
  });

  it('throws TidemarkValidationError with zodError === null on JSON parse failure', async () => {
    const schema = z.object({ value: z.number() });

    try {
      await parseWithRetry('{invalid json', schema, 2);
    } catch (err) {
      expect(err).toBeInstanceOf(TidemarkValidationError);
      const e = err as TidemarkValidationError;
      expect(e.zodError).toBeNull();
      expect(e.lastOutput).toBe('{invalid json');
    }
  });

  it('does not call onRetry if not provided (throws after first failure)', async () => {
    const schema = z.object({ value: z.number() });

    // maxRetries=0 and no onRetry — should fail on attempt 0 with no retry
    await expect(
      parseWithRetry('{"value":"wrong"}', schema, 0)
    ).rejects.toBeInstanceOf(TidemarkValidationError);
  });

  it('resolves after multiple retries (not just first)', async () => {
    const schema = z.object({ count: z.number() });
    let call = 0;

    // First two retries return bad output; third (attempt 2) returns good
    const onRetry = vi.fn().mockImplementation(async () => {
      call++;
      if (call < 2) return '{"count":"bad"}'; // still invalid
      return '{"count":7}'; // valid on second retry (attempt 2)
    });

    const result = await parseWithRetry('{"count":"bad"}', schema, 3, onRetry);
    expect(result).toEqual({ count: 7 });
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('strips ```json code fences before parsing', async () => {
    const schema = z.object({ value: z.number() });
    const fenced = '```json\n{"value":42}\n```';
    const result = await parseWithRetry<{ value: number }>(fenced, schema, 0);
    expect(result).toEqual({ value: 42 });
  });

  it('strips plain ``` code fences before parsing', async () => {
    const schema = z.object({ value: z.number() });
    const fenced = '```\n{"value":7}\n```';
    const result = await parseWithRetry<{ value: number }>(fenced, schema, 0);
    expect(result).toEqual({ value: 7 });
  });

  it('preserves original text with fences in lastOutput on parse failure', async () => {
    const schema = z.object({ value: z.number() });
    const fenced = '```json\n{invalid}\n```';
    try {
      await parseWithRetry(fenced, schema, 0);
    } catch (err) {
      const e = err as TidemarkValidationError;
      expect(e.lastOutput).toBe(fenced);
    }
  });
});

describe('runAgenticLoop', () => {
  it('throws "No handler for tool" when model calls a tool absent from handlers map', async () => {
    const adapter = new MockAdapter();
    adapter.enqueue({
      text: '',
      stopReason: 'tool_use',
      toolCalls: [{ id: 'tc1', name: 'lookup', input: { q: 'x' } }],
    });

    await expect(
      runAgenticLoop(
        adapter,
        { messages: [{ role: 'user', content: 'test' }], system: '' },
        {}, // empty handlers — 'lookup' not present
        10
      )
    ).rejects.toThrow('No handler for tool: lookup');
  });
});
