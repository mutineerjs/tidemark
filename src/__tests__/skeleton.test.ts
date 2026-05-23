// src/__tests__/skeleton.test.ts
// Walking skeleton end-to-end tests: CORE-01, CORE-02, CALL-04, PROV-04

import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod'; // test files may use the root 'zod' — users bring their own
import { createPromptFn } from '../core/factory.js';
import { MockAdapter } from '../adapters/mock.js';
import { TIDEMARK_META } from '../core/meta.js';

describe('createPromptFn — Walking Skeleton', () => {
  let adapter: MockAdapter;

  beforeEach(() => {
    adapter = new MockAdapter();
  });

  // CORE-01: developer can call fn(input) and get typed output
  it('resolves typed output from MockAdapter (CORE-01)', async () => {
    adapter.enqueue({ text: '{"category":"news"}' });

    const fn = createPromptFn({
      name: 'classify',
      prompt: (_input) => 'Classify the input.',
      inputSchema: z.object({}),
      outputSchema: z.object({ category: z.string() }),
      adapter,
    });

    const result = await fn({});
    expect(result.output.category).toBe('news');
  });

  // CORE-02: TIDEMARK_META is accessible but not in Object.keys
  it('TIDEMARK_META is not enumerable but accessible (CORE-02)', () => {
    const fn = createPromptFn({
      name: 'test-meta',
      prompt: () => 'test',
      inputSchema: z.object({}),
      outputSchema: z.object({ value: z.string() }),
      adapter,
    });

    // Should not appear in enumerable properties
    expect(Object.keys(fn)).not.toContain('Symbol(tidemark.meta)');
    // Should be accessible via symbol key
    expect((fn as unknown as Record<symbol, unknown>)[TIDEMARK_META]).toBeDefined();
    const meta = (fn as unknown as Record<symbol, unknown>)[TIDEMARK_META] as Record<string, unknown>;
    expect(meta.name).toBe('test-meta');
  });

  // CALL-04 + PROV-04: result carries all required metadata fields
  it('result contains TidemarkCallMeta fields (CALL-04, PROV-04)', async () => {
    adapter.enqueue({
      text: '{"status":"ok"}',
      inputTokens: 42,
      outputTokens: 15,
      modelVersion: 'mock-model-v1',
    });

    const fn = createPromptFn({
      name: 'meta-test',
      prompt: () => 'Check metadata.',
      inputSchema: z.object({}),
      outputSchema: z.object({ status: z.string() }),
      adapter,
    });

    const result = await fn({});
    expect(result.output.status).toBe('ok');

    // CALL-04 fields
    expect(typeof result.meta.inputTokens).toBe('number');
    expect(result.meta.inputTokens).toBe(42);
    expect(typeof result.meta.outputTokens).toBe('number');
    expect(result.meta.outputTokens).toBe(15);
    expect(typeof result.meta.estimatedCostUsd).toBe('number');
    expect(typeof result.meta.responseTimeMs).toBe('number');
    expect(result.meta.responseTimeMs).toBeGreaterThanOrEqual(0);

    // PROV-04 fields
    expect(result.meta.rawRequest).toBeDefined();
    expect(result.meta.rawResponse).toBeDefined();
  });

  // Invalid input causes rejection before adapter is invoked
  it('rejects invalid input before calling adapter (T-01-01)', async () => {
    const fn = createPromptFn({
      name: 'strict-input',
      prompt: (_input) => `process ${_input.id}`,
      inputSchema: z.object({ id: z.string() }),
      outputSchema: z.object({ result: z.string() }),
      adapter,
    });

    // Pass invalid input (missing required `id`)
    await expect(fn({} as unknown as { id: string })).rejects.toThrow('Input validation failed');

    // Adapter should not have been called
    expect(adapter.calls).toHaveLength(0);
  });

  // Non-JSON output from adapter throws TidemarkValidationError (T-01-03)
  it('throws TidemarkValidationError on non-JSON adapter output', async () => {
    adapter.enqueue({ text: 'not valid json' });

    const fn = createPromptFn({
      name: 'json-fail',
      prompt: () => 'return json',
      inputSchema: z.object({}),
      outputSchema: z.object({ val: z.string() }),
      adapter,
    });

    await expect(fn({})).rejects.toThrow('LLM output is not valid JSON');
  });

  // JSON output failing schema validation throws TidemarkValidationError
  // With Plan 02 retry loop wired, we use maxRetries:0 to test single-attempt failure
  it('throws TidemarkValidationError on schema mismatch (maxRetries:0)', async () => {
    adapter.enqueue({ text: '{"wrong_field": 123}' });

    const fn = createPromptFn({
      name: 'schema-fail',
      prompt: () => 'return correct schema',
      inputSchema: z.object({}),
      outputSchema: z.object({ val: z.string() }),
      adapter,
      maxRetries: 0, // disable retry so single bad response exhausts immediately
    });

    await expect(fn({})).rejects.toThrow('Zod validation failed after retries');
  });

  // fn.stream returns a TidemarkStream (Plan 04 — seam removed, real streaming implemented)
  it('fn.stream returns a TidemarkStream with abort() callable in finally', async () => {
    adapter.enqueue({ text: '{"v":1}' });
    const fn = createPromptFn({
      name: 'stream-impl',
      prompt: () => 'test',
      inputSchema: z.object({}),
      outputSchema: z.object({ v: z.number() }),
      adapter,
    });

    const stream = fn.stream({});
    try {
      for await (const _chunk of stream) {
        // consume
      }
      const result = await stream.finalOutput();
      expect(result.output.v).toBe(1);
    } finally {
      stream.abort(); // D-17
    }
  });
});
