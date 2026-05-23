// src/core/meta.ts
// TidemarkCallMeta type, TIDEMARK_META symbol, and cost estimation

import type * as z4 from 'zod/v4/core';
import type { ProviderAdapter } from '../adapters/interface.js';

// Symbol exported for Phase 2 snapshot system access (CORE-02)
export const TIDEMARK_META = Symbol('tidemark.meta');

// CALL-04: exact field names from REQUIREMENTS.md
export interface TidemarkCallMeta {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  responseTimeMs: number;
  modelVersion: string;
  rawRequest: unknown;
  rawResponse: unknown;
}

// Internal config metadata stored on the fn object (Phase 2 reads this for hashing)
export interface TidemarkMeta<I extends z4.$ZodType, O extends z4.$ZodType> {
  name: string;
  prompt: (input: z4.output<I>) => string;
  inputSchema: I;
  outputSchema: O;
  adapter: ProviderAdapter;
  temperature?: number;
  tools?: Record<string, z4.$ZodType>;
}

// NOTE (RESEARCH assumption A1): These prices are APPROXIMATE and may not reflect
// current Anthropic pricing. They are intentionally kept in a runtime-configurable
// exported table so callers can correct them without a library code change.
// Verify current pricing at: https://www.anthropic.com/pricing#api-access
//
// To update prices at runtime, either:
//   A) Mutate this exported record directly: MODEL_PRICES['my-model'] = { inputPer1M, outputPer1M }
//   B) Use the setModelPrice() helper: setModelPrice('my-model', { inputPer1M, outputPer1M })
//   C) Use registerModelPrices() for bulk updates
export const MODEL_PRICES: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  'claude-sonnet-4-5-20250929': { inputPer1M: 3.0, outputPer1M: 15.0 },
  'claude-haiku-3-20240307': { inputPer1M: 0.25, outputPer1M: 1.25 },
};

/** Set or override the price for a single model at runtime (RESEARCH assumption A1). */
export function setModelPrice(
  model: string,
  prices: { inputPer1M: number; outputPer1M: number }
): void {
  MODEL_PRICES[model] = prices;
}

/** Bulk-register model prices at runtime (RESEARCH assumption A1). */
export function registerModelPrices(
  prices: Record<string, { inputPer1M: number; outputPer1M: number }>
): void {
  Object.assign(MODEL_PRICES, prices);
}

export function estimateCost(
  modelVersion: string,
  inputTokens: number,
  outputTokens: number
): number {
  const prices = MODEL_PRICES[modelVersion];
  if (!prices) return 0; // unknown model — return 0, not an error
  return (inputTokens / 1_000_000) * prices.inputPer1M
    + (outputTokens / 1_000_000) * prices.outputPer1M;
}

// Build call metadata from a provider response.
// Returns a standalone TidemarkCallMeta — callers assemble the final result struct.
export function buildCallMeta(
  providerResponse: {
    inputTokens: number;
    outputTokens: number;
    modelVersion: string;
    rawRequest: unknown;
    rawResponse: unknown;
  },
  startTimeMs: number
): TidemarkCallMeta {
  const responseTimeMs = performance.now() - startTimeMs;
  return {
    inputTokens: providerResponse.inputTokens,
    outputTokens: providerResponse.outputTokens,
    estimatedCostUsd: estimateCost(
      providerResponse.modelVersion,
      providerResponse.inputTokens,
      providerResponse.outputTokens
    ),
    responseTimeMs,
    modelVersion: providerResponse.modelVersion,
    rawRequest: providerResponse.rawRequest,
    rawResponse: providerResponse.rawResponse,
  };
}
