// src/__tests__/testing.test.ts
// TEST-03 coverage: mockPromptFn() returns a correctly shaped PromptFn with zero-value TidemarkCallMeta

import { describe, it, expect } from 'vitest';
import { mockPromptFn } from '../testing/index.js';
import { TIDEMARK_META } from '../core/meta.js';

// Note: mockPromptFn does NOT exist yet (src/testing/index.ts will be created in Plan 04).
// This file will fail at import — that is the correct RED state.

describe('mockPromptFn()', () => {
  it('callable path returns returnValue fields merged with zero-value TidemarkCallMeta', async () => {
    const fn = mockPromptFn({ category: 'news', confidence: 0.9 });
    const result = await fn({}) as unknown as { category: string; confidence: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number; responseTimeMs: number };
    expect(result.category).toBe('news');
    expect(result.confidence).toBe(0.9);
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.estimatedCostUsd).toBe(0);
    expect(result.responseTimeMs).toBe(0);
  });

  it('result includes messages: [] array (required after CALL-03 ships)', async () => {
    const fn = mockPromptFn({ category: 'news' });
    const result = await fn({});
    // After CALL-03, PromptFn return type includes messages; mockPromptFn must include messages: []
    expect(Array.isArray(result.messages)).toBe(true);
    expect(result.messages).toHaveLength(0);
  });

  it('stream stub has Symbol.asyncIterator, finalOutput, and abort methods', () => {
    const fn = mockPromptFn({ category: 'news' });
    const s = fn.stream({});
    expect(typeof s[Symbol.asyncIterator]).toBe('function');
    expect(typeof s.finalOutput).toBe('function');
    expect(typeof s.abort).toBe('function');
  });

  it('iterating fn.stream({}) yields zero chunks', async () => {
    const fn = mockPromptFn({ category: 'news' });
    const s = fn.stream({});
    const chunks: unknown[] = [];
    for await (const chunk of s) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(0);
  });

  it('stream finalOutput() resolves to returnValue merged with zero-value TidemarkCallMeta', async () => {
    const fn = mockPromptFn({ category: 'news', confidence: 0.9 });
    const s = fn.stream({});
    const output = await s.finalOutput() as unknown as { category: string; confidence: number; inputTokens: number; estimatedCostUsd: number };
    expect(output.category).toBe('news');
    expect(output.confidence).toBe(0.9);
    expect(output.inputTokens).toBe(0);
    expect(output.estimatedCostUsd).toBe(0);
  });

  it('fn[TIDEMARK_META] is defined (non-enumerable symbol property)', () => {
    const fn = mockPromptFn({ category: 'news' });
    // Symbol property should be defined
    expect(fn[TIDEMARK_META]).toBeDefined();
    // Should not appear in Object.keys (non-enumerable)
    expect(Object.keys(fn)).not.toContain(TIDEMARK_META.toString());
  });

  it('fn[TIDEMARK_META].name === __mock__', () => {
    const fn = mockPromptFn({ category: 'news' });
    expect(fn[TIDEMARK_META].name).toBe('__mock__');
  });

  it('fn[TIDEMARK_META].adapter is defined (a MockAdapter instance)', () => {
    const fn = mockPromptFn({ category: 'news' });
    expect(fn[TIDEMARK_META].adapter).toBeDefined();
    // Adapter should have generate and stream methods (ProviderAdapter interface)
    expect(typeof fn[TIDEMARK_META].adapter.generate).toBe('function');
    expect(typeof fn[TIDEMARK_META].adapter.stream).toBe('function');
  });
});
