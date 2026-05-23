// src/__tests__/call-meta.test.ts
// CALL-04 and PROV-04 coverage: cost/latency metadata + AnthropicAdapter end-to-end with mocked client.
// Tests that all six TidemarkCallMeta fields are present with correct names/types on the result.
// Tests that rawResponse deep-equals the mocked provider message (PROV-04).

import { describe, expect, it, vi } from 'vitest';
import * as z from 'zod';
import equal from 'fast-deep-equal';
import { estimateCost, MODEL_PRICES } from '../core/meta.js';
import { AnthropicAdapter } from '../adapters/anthropic.js';
import { createPromptFn } from '../core/factory.js';

// ────────────────────────────────────────────────────────────────────────────
// estimateCost — price table behaviour
// ────────────────────────────────────────────────────────────────────────────
describe('estimateCost()', () => {
  it('returns a positive number for a known model', () => {
    const cost = estimateCost('claude-sonnet-4-5-20250929', 1_000_000, 1_000_000);
    expect(cost).toBeTypeOf('number');
    expect(cost).toBeGreaterThan(0);
  });

  it('returns inputPer1M + outputPer1M for 1M tokens each (spot check known model)', () => {
    // claude-sonnet-4-5-20250929: inputPer1M=3.0, outputPer1M=15.0
    const cost = estimateCost('claude-sonnet-4-5-20250929', 1_000_000, 1_000_000);
    // 1M input tokens at $3 + 1M output tokens at $15 = $18
    expect(cost).toBeCloseTo(18, 5);
  });

  it('returns 0 for an unknown model (not an error)', () => {
    const cost = estimateCost('totally-unknown-model', 5, 5);
    expect(cost).toBe(0);
  });

  it('returns 0 for any unknown model regardless of token count', () => {
    expect(estimateCost('gpt-5-turbo-preview', 1_000_000, 1_000_000)).toBe(0);
    expect(estimateCost('', 100, 100)).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// MODEL_PRICES configurability (RESEARCH A1 — prices must be runtime-configurable)
// ────────────────────────────────────────────────────────────────────────────
describe('MODEL_PRICES runtime configurability', () => {
  it('estimateCost returns 0 for a model not yet in the table', () => {
    expect(estimateCost('my-custom-model-v1', 100, 100)).toBe(0);
  });

  it('estimateCost returns computed value after adding a new model to the exported MODEL_PRICES table', () => {
    // MODEL_PRICES is an exported mutable record (RESEARCH A1 — runtime-configurable)
    expect(typeof MODEL_PRICES).toBe('object');

    // Add a new model to the price table at runtime
    MODEL_PRICES['my-custom-model-v1'] = { inputPer1M: 2.0, outputPer1M: 8.0 };

    // 1M input at $2 + 1M output at $8 = $10
    const cost = estimateCost('my-custom-model-v1', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(10, 5);

    // Clean up to avoid test pollution
    delete MODEL_PRICES['my-custom-model-v1'];
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AnthropicAdapter end-to-end with mocked client — all six CALL-04 fields
// ────────────────────────────────────────────────────────────────────────────

const MOCK_PROVIDER_MESSAGE = {
  id: 'msg_callmeta_01',
  type: 'message' as const,
  role: 'assistant' as const,
  model: 'claude-sonnet-4-5-20250929',
  content: [{ type: 'text' as const, text: '{"value":42}' }],
  usage: { input_tokens: 100, output_tokens: 50 },
  stop_reason: 'end_turn' as const,
  stop_sequence: null,
};

function createMockedAnthropicAdapter(): AnthropicAdapter {
  const adapter = new AnthropicAdapter('claude-sonnet-4-6');
  const mockCreate = vi.fn().mockResolvedValue(MOCK_PROVIDER_MESSAGE);
  (adapter as unknown as { client: unknown }).client = {
    messages: {
      create: mockCreate,
      stream: vi.fn(),
    },
  };
  return adapter;
}

describe('createPromptFn with mocked AnthropicAdapter — CALL-04 + PROV-04', () => {
  it('result has all six CALL-04 field names with correct types', async () => {
    const adapter = createMockedAnthropicAdapter();
    const fn = createPromptFn({
      name: 'call-meta-test',
      prompt: () => 'return a number',
      inputSchema: z.object({}),
      outputSchema: z.object({ value: z.number() }),
      adapter,
      maxRetries: 0,
    });

    const result = await fn({});

    // CALL-04: exact field names required
    expect('inputTokens' in result.meta).toBe(true);
    expect('outputTokens' in result.meta).toBe(true);
    expect('estimatedCostUsd' in result.meta).toBe(true);
    expect('responseTimeMs' in result.meta).toBe(true);
    expect('rawRequest' in result.meta).toBe(true);
    expect('rawResponse' in result.meta).toBe(true);
  });

  it('inputTokens and outputTokens are numbers from the mock response', async () => {
    const adapter = createMockedAnthropicAdapter();
    const fn = createPromptFn({
      name: 'call-meta-test',
      prompt: () => 'return a number',
      inputSchema: z.object({}),
      outputSchema: z.object({ value: z.number() }),
      adapter,
      maxRetries: 0,
    });

    const result = await fn({});
    expect(result.meta.inputTokens).toBe(100);
    expect(result.meta.outputTokens).toBe(50);
  });

  it('estimatedCostUsd is a finite number >= 0', async () => {
    const adapter = createMockedAnthropicAdapter();
    const fn = createPromptFn({
      name: 'call-meta-test',
      prompt: () => 'return a number',
      inputSchema: z.object({}),
      outputSchema: z.object({ value: z.number() }),
      adapter,
      maxRetries: 0,
    });

    const result = await fn({});
    expect(result.meta.estimatedCostUsd).toBeTypeOf('number');
    expect(Number.isFinite(result.meta.estimatedCostUsd)).toBe(true);
    expect(result.meta.estimatedCostUsd).toBeGreaterThanOrEqual(0);
  });

  it('responseTimeMs is a finite number >= 0', async () => {
    const adapter = createMockedAnthropicAdapter();
    const fn = createPromptFn({
      name: 'call-meta-test',
      prompt: () => 'return a number',
      inputSchema: z.object({}),
      outputSchema: z.object({ value: z.number() }),
      adapter,
      maxRetries: 0,
    });

    const result = await fn({});
    expect(result.meta.responseTimeMs).toBeTypeOf('number');
    expect(Number.isFinite(result.meta.responseTimeMs)).toBe(true);
    expect(result.meta.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('rawResponse deep-equals the mocked provider message (PROV-04)', async () => {
    const adapter = createMockedAnthropicAdapter();
    const fn = createPromptFn({
      name: 'call-meta-test',
      prompt: () => 'return a number',
      inputSchema: z.object({}),
      outputSchema: z.object({ value: z.number() }),
      adapter,
      maxRetries: 0,
    });

    const result = await fn({});
    // rawResponse must deep-equal the full mocked provider message (PROV-04)
    expect(equal(result.meta.rawResponse, MOCK_PROVIDER_MESSAGE)).toBe(true);
    // Verify identity equality (same object reference) since the mock returns the exact object
    expect(result.meta.rawResponse).toBe(MOCK_PROVIDER_MESSAGE);
  });

  it('rawRequest is the Anthropic API params object (not the promptFn input)', async () => {
    const adapter = createMockedAnthropicAdapter();
    const fn = createPromptFn({
      name: 'call-meta-test',
      prompt: () => 'return a number',
      inputSchema: z.object({}),
      outputSchema: z.object({ value: z.number() }),
      adapter,
      maxRetries: 0,
    });

    const result = await fn({});
    // rawRequest should be an object with 'model', 'messages', 'max_tokens' — the Anthropic API params
    const rawReq = result.meta.rawRequest as Record<string, unknown>;
    expect(rawReq).toBeDefined();
    expect(rawReq).toHaveProperty('model');
    expect(rawReq).toHaveProperty('messages');
    expect(rawReq).toHaveProperty('max_tokens');
    // Must NOT contain apiKey (T-03-01)
    expect(rawReq).not.toHaveProperty('apiKey');
  });

  it('estimatedCostUsd is computed from the resolved modelVersion in the response', async () => {
    const adapter = createMockedAnthropicAdapter();
    const fn = createPromptFn({
      name: 'call-meta-test',
      prompt: () => 'return a number',
      inputSchema: z.object({}),
      outputSchema: z.object({ value: z.number() }),
      adapter,
      maxRetries: 0,
    });

    const result = await fn({});
    // The mock response has model 'claude-sonnet-4-5-20250929' with 100 input + 50 output tokens
    // inputPer1M=3.0, outputPer1M=15.0
    // cost = (100/1_000_000)*3 + (50/1_000_000)*15 = 0.0003 + 0.00075 = 0.00105
    const expectedCost = (100 / 1_000_000) * 3.0 + (50 / 1_000_000) * 15.0;
    expect(result.meta.estimatedCostUsd).toBeCloseTo(expectedCost, 8);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Public AnthropicAdapter export from index.ts (PROV-02 contract)
// ────────────────────────────────────────────────────────────────────────────
describe('AnthropicAdapter public export', () => {
  it('is exported from the package index', async () => {
    const indexModule = await import('../index.js');
    expect('AnthropicAdapter' in indexModule).toBe(true);
    expect(typeof (indexModule as Record<string, unknown>).AnthropicAdapter).toBe('function');
  });
});
