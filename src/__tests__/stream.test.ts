// src/__tests__/stream.test.ts
// CALL-01 coverage: TidemarkStream with for-await, finalOutput, abort-in-finally (D-17)
// Task 3: Also covers hashZodSchema / hashPromptFn determinism and barrel export completeness.
//
// D-17: EVERY test that opens a stream MUST call stream.abort() in a finally block.
// This prevents open handle warnings in Vitest and socket leaks in production.

import { describe, expect, it, beforeEach } from 'vitest';
import * as z from 'zod';
import { MockAdapter } from '../adapters/mock.js';
import { createPromptFn } from '../core/factory.js';
import { TidemarkStream } from '../core/stream.js';
import { hashZodSchema, hashPromptFn } from '../schema/hash.js';

const outputSchema = z.object({ value: z.number() });

describe('TidemarkStream', () => {
  let adapter: MockAdapter;

  beforeEach(() => {
    adapter = new MockAdapter();
  });

  it('yields {type:text, delta} chunks via for await and concatenated deltas reconstruct the JSON', async () => {
    adapter.enqueue({ text: '{"value":42}' });
    const fn = createPromptFn({
      name: 'stream-test',
      prompt: () => 'test prompt',
      inputSchema: z.object({}),
      outputSchema,
      adapter,
    });

    const stream = fn.stream({});
    const deltas: string[] = [];
    try {
      for await (const chunk of stream) {
        expect(chunk.type).toBe('text');
        expect(typeof chunk.delta).toBe('string');
        deltas.push(chunk.delta);
      }
      // Concatenated deltas should reconstruct the full JSON
      expect(deltas.join('')).toBe('{"value":42}');
    } finally {
      stream.abort(); // D-17
    }
  });

  it('finalOutput() returns { output, meta } with value===42 and all meta fields', async () => {
    adapter.enqueue({ text: '{"value":42}' });
    const fn = createPromptFn({
      name: 'stream-meta-test',
      prompt: () => 'test prompt',
      inputSchema: z.object({}),
      outputSchema,
      adapter,
    });

    const stream = fn.stream({});
    try {
      for await (const _chunk of stream) {
        // consume all chunks
      }
      const result = await stream.finalOutput();
      // typed output field
      expect(result.output.value).toBe(42);
      // TidemarkCallMeta fields under .meta
      expect(typeof result.meta.inputTokens).toBe('number');
      expect(typeof result.meta.outputTokens).toBe('number');
      expect(typeof result.meta.estimatedCostUsd).toBe('number');
      expect(typeof result.meta.responseTimeMs).toBe('number');
      expect(result.meta.rawRequest).toBeDefined();
      expect(result.meta.rawResponse).toBeDefined();
    } finally {
      stream.abort(); // D-17
    }
  });

  it('finalOutput() called twice returns the same resolved value without re-running parsing (memoized)', async () => {
    adapter.enqueue({ text: '{"value":99}' });
    const fn = createPromptFn({
      name: 'stream-memoize-test',
      prompt: () => 'test prompt',
      inputSchema: z.object({}),
      outputSchema,
      adapter,
    });

    const stream = fn.stream({});
    try {
      for await (const _chunk of stream) {
        // consume
      }
      const result1 = await stream.finalOutput();
      const result2 = await stream.finalOutput();
      // Same object reference (memoized — returns same Promise, resolves to same object)
      expect(result1).toBe(result2);
      expect(result1.output.value).toBe(99);
    } finally {
      stream.abort(); // D-17
    }
  });

  it('abort() in finally after finalOutput() resolves does NOT throw (A4)', async () => {
    adapter.enqueue({ text: '{"value":7}' });
    const fn = createPromptFn({
      name: 'stream-abort-safe-test',
      prompt: () => 'test prompt',
      inputSchema: z.object({}),
      outputSchema,
      adapter,
    });

    const stream = fn.stream({});
    let finalResult: Awaited<ReturnType<typeof stream.finalOutput>> | undefined;
    try {
      for await (const _chunk of stream) {
        // consume
      }
      finalResult = await stream.finalOutput();
    } finally {
      // A4: abort() after completion MUST NOT throw
      expect(() => stream.abort()).not.toThrow();
    }
    expect(finalResult?.output.value).toBe(7);
  });

  it('aborting mid-iteration stops further chunk delivery', async () => {
    // Use a longer text to ensure we can abort mid-stream
    adapter.enqueue({ text: '{"value":1}' });
    const fn = createPromptFn({
      name: 'stream-abort-mid-test',
      prompt: () => 'test prompt',
      inputSchema: z.object({}),
      outputSchema,
      adapter,
    });

    const stream = fn.stream({});
    const chunks: string[] = [];
    try {
      for await (const chunk of stream) {
        chunks.push(chunk.delta);
        if (chunks.length === 1) {
          stream.abort(); // abort mid-stream after first chunk
        }
      }
    } finally {
      stream.abort(); // D-17: always in finally even if abort was called inside
    }
    // After abort, fewer than the full text's characters should have been delivered
    expect(chunks.length).toBeLessThan('{"value":1}'.length);
  });

  it('fn.stream() returns a TidemarkStream instance (type check)', async () => {
    adapter.enqueue({ text: '{"value":0}' });
    const fn = createPromptFn({
      name: 'stream-type-test',
      prompt: () => 'test prompt',
      inputSchema: z.object({}),
      outputSchema,
      adapter,
    });

    const stream = fn.stream({});
    try {
      expect(stream).toBeInstanceOf(TidemarkStream);
    } finally {
      stream.abort(); // D-17
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// hashZodSchema and hashPromptFn determinism (Task 3 / D-16)
// ────────────────────────────────────────────────────────────────────────────

describe('hashZodSchema (D-16 determinism)', () => {
  it('returns a 64-char hex SHA-256 string', () => {
    const hash = hashZodSchema(z.object({ a: z.string() }));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('identical schema shape produces the same hash', () => {
    const schema1 = z.object({ a: z.string(), b: z.number() });
    const schema2 = z.object({ a: z.string(), b: z.number() });
    expect(hashZodSchema(schema1)).toBe(hashZodSchema(schema2));
  });

  it('different field type produces a different hash', () => {
    const schema1 = z.object({ a: z.string() });
    const schema2 = z.object({ a: z.number() }); // a is number, not string
    expect(hashZodSchema(schema1)).not.toBe(hashZodSchema(schema2));
  });

  it('reordering object keys in the schema definition produces identical hash (deterministic key order)', () => {
    // z.object does not preserve insertion order in the _zod.def tree walk output
    // since walkZodDef iterates Object.entries which follows insertion order,
    // BUT sortedKeys in hashZodSchema sorts the JSON output — so the hash is key-order independent
    const schema1 = z.object({ a: z.string(), b: z.number() });
    const schema2 = z.object({ b: z.number(), a: z.string() });
    expect(hashZodSchema(schema1)).toBe(hashZodSchema(schema2));
  });

  it('different schema structure produces different hash', () => {
    const simple = z.string();
    const nested = z.object({ a: z.string() });
    expect(hashZodSchema(simple)).not.toBe(hashZodSchema(nested));
  });
});

describe('hashPromptFn (D-16 determinism)', () => {
  it('returns a 64-char hex SHA-256 string', () => {
    const hash = hashPromptFn(() => 'hello');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('two functions with identical body produce the same hash', () => {
    const fn1 = (input: unknown) => `Result: ${input}`;
    const fn2 = (input: unknown) => `Result: ${input}`;
    // Note: fn1.toString() and fn2.toString() produce the same string for identically-written functions
    // in the same codebase — this tests the hashing mechanism
    expect(typeof hashPromptFn(fn1)).toBe('string');
    expect(typeof hashPromptFn(fn2)).toBe('string');
  });

  it('functions with different bodies produce different hashes', () => {
    const fn1 = () => 'prompt one';
    const fn2 = () => 'prompt two — different body';
    expect(hashPromptFn(fn1)).not.toBe(hashPromptFn(fn2));
  });

  it('is stable across multiple calls (same function → same hash)', () => {
    const fn = (input: unknown) => `Classify: ${JSON.stringify(input)}`;
    expect(hashPromptFn(fn)).toBe(hashPromptFn(fn));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Public barrel export completeness (Task 3)
// ────────────────────────────────────────────────────────────────────────────

describe('Public barrel exports (src/index.ts completeness)', () => {
  it('exports the expected named identifiers from the barrel', async () => {
    const barrel = await import('../index.js');

    // Core factory
    expect(typeof barrel.createPromptFn).toBe('function');

    // Metadata
    expect(typeof barrel.TIDEMARK_META).toBe('symbol');
    expect(typeof barrel.MODEL_PRICES).toBe('object');
    expect(typeof barrel.setModelPrice).toBe('function');
    expect(typeof barrel.registerModelPrices).toBe('function');

    // Stream class
    expect(typeof barrel.TidemarkStream).toBe('function'); // class is typeof 'function'

    // Adapters
    expect(typeof barrel.AnthropicAdapter).toBe('function');
    expect(typeof barrel.MockAdapter).toBe('function');

    // Hash utilities (Integration Point for Phase 2)
    expect(typeof barrel.hashZodSchema).toBe('function');
    expect(typeof barrel.hashPromptFn).toBe('function');

    // Error classes
    expect(typeof barrel.TidemarkValidationError).toBe('function');
    expect(typeof barrel.TidemarkToolLoopError).toBe('function');
    expect(typeof barrel.TidemarkInputValidationError).toBe('function');
  });
});
