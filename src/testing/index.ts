// src/testing/index.ts
// tidemark/testing sub-package — TEST-03 (D-04, D-05)
// Exports mockPromptFn() for unit-testing code that calls promptFn without real API calls.

import { TIDEMARK_META } from '../core/meta.js';
import type { TidemarkCallMeta } from '../core/meta.js';
import type { PromptFn, CallOptions, ConversationMessage } from '../core/factory.js';
import { MockAdapter } from '../adapters/mock.js';
import * as z4 from 'zod/v4/core';

// SECURITY NOTE (T-03-04-03): stream and TIDEMARK_META are attached with
// writable: false, configurable: false — consumer code cannot accidentally
// overwrite the mock implementation.

const ZERO_META: TidemarkCallMeta = {
  inputTokens: 0,
  outputTokens: 0,
  estimatedCostUsd: 0,
  responseTimeMs: 0,
  modelVersion: '',
  rawRequest: null,
  rawResponse: null,
};

/**
 * Returns a correctly-shaped PromptFn backed by static values instead of real adapter calls.
 * Use in unit tests to avoid real API calls:
 *
 *   const fn = mockPromptFn({ category: 'news', confidence: 0.9 });
 *   const result = await fn({ text: 'some headline' });
 *   // result.category === 'news', result.inputTokens === 0, result.messages === []
 *
 * D-04: One-line setup. Returns a correctly-shaped PromptFn with TidemarkCallMeta defaults.
 * D-05: Stubs both the callable path and the .stream() method.
 * Pitfall 5: includes messages: [] so CALL-03 consumers can narrow on result.messages.
 */
export function mockPromptFn<O extends object>(
  returnValue: O
): PromptFn<z4.$ZodType, z4.$ZodType> {
  // Callable path — returns returnValue merged with zero-value TidemarkCallMeta and messages: []
  const fn = async (
    _input: unknown,
    _options?: CallOptions<z4.$ZodType>
  ): Promise<O & TidemarkCallMeta & { messages: ConversationMessage[] }> => {
    return {
      ...returnValue,
      ...ZERO_META,
      messages: [] as ConversationMessage[],
    };
  };

  // Stream stub — yields no text chunks; finalOutput() resolves to returnValue + zero meta.
  // Cast to unknown to avoid coupling on TidemarkStream import (avoids circular dep risk).
  const streamStub = {
    [Symbol.asyncIterator]: async function* () {
      // D-05: yields no chunks
    },
    finalOutput: async () => ({
      ...returnValue,
      ...ZERO_META,
      messages: [] as ConversationMessage[],
    }),
    abort: () => {},
  } as unknown;

  // Attach stream via Object.defineProperty — same non-enumerable pattern as factory.ts
  Object.defineProperty(fn, 'stream', {
    value: (_input: unknown, _options?: unknown) => streamStub,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  // Build minimal TidemarkMeta with MockAdapter underneath
  const meta = {
    name: '__mock__',
    prompt: () => '',
    inputSchema: {} as z4.$ZodType,
    outputSchema: {} as z4.$ZodType,
    adapter: new MockAdapter(),
    temperature: undefined,
    tools: undefined,
  };

  // Attach TIDEMARK_META via Object.defineProperty — non-enumerable, non-writable
  Object.defineProperty(fn, TIDEMARK_META, {
    value: meta,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return fn as unknown as PromptFn<z4.$ZodType, z4.$ZodType>;
}
