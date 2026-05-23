// src/__tests__/meta.test.ts
// Tests for TIDEMARK_META metadata, non-enumerable property, and Standard Schema type surface (CORE-02, CORE-05)

import { describe, it, expect, beforeEach } from 'vitest';
import * as z from 'zod'; // test files may use root 'zod' — simulates user-side code

import { createPromptFn } from '../core/factory.js';
import { MockAdapter } from '../adapters/mock.js';
import { TIDEMARK_META } from '../core/meta.js';

describe('TIDEMARK_META metadata (CORE-02)', () => {
  let adapter: MockAdapter;

  beforeEach(() => {
    adapter = new MockAdapter();
  });

  it('fn[TIDEMARK_META] is defined and accessible via symbol key', () => {
    const fn = createPromptFn({
      name: 'meta-test',
      prompt: () => 'test',
      inputSchema: z.object({}),
      outputSchema: z.object({ value: z.string() }),
      adapter,
    });

    const meta = (fn as unknown as Record<symbol, unknown>)[TIDEMARK_META];
    expect(meta).toBeDefined();
  });

  it('fn[TIDEMARK_META] is NOT in Object.keys(fn) — non-enumerable (CORE-02)', () => {
    const fn = createPromptFn({
      name: 'non-enum-test',
      prompt: () => 'test',
      inputSchema: z.object({}),
      outputSchema: z.object({ value: z.string() }),
      adapter,
    });

    // Symbol-keyed properties are never in Object.keys(), but the symbol itself
    // should not appear even as a stringified key
    const keys = Object.keys(fn);
    expect(keys).not.toContain(TIDEMARK_META.toString());
    expect(keys).not.toContain('Symbol(tidemark.meta)');
    // Also check Object.getOwnPropertyNames doesn't include it
    expect(Object.getOwnPropertyNames(fn)).not.toContain(TIDEMARK_META.toString());
  });

  it('fn[TIDEMARK_META] carries name field matching config.name', () => {
    const fn = createPromptFn({
      name: 'my-classifier',
      prompt: () => 'classify',
      inputSchema: z.object({}),
      outputSchema: z.object({ label: z.string() }),
      adapter,
    });

    const meta = (fn as unknown as Record<symbol, unknown>)[TIDEMARK_META] as Record<string, unknown>;
    expect(meta.name).toBe('my-classifier');
  });

  it('fn[TIDEMARK_META] carries prompt function reference', () => {
    const promptFn = (input: { text: string }) => `classify: ${input.text}`;

    const fn = createPromptFn({
      name: 'prompt-ref-test',
      prompt: promptFn,
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.object({ label: z.string() }),
      adapter,
    });

    const meta = (fn as unknown as Record<symbol, unknown>)[TIDEMARK_META] as Record<string, unknown>;
    expect(meta.prompt).toBe(promptFn);
  });

  it('fn[TIDEMARK_META] carries inputSchema and outputSchema', () => {
    const inputSchema = z.object({ text: z.string() });
    const outputSchema = z.object({ label: z.string() });

    const fn = createPromptFn({
      name: 'schema-ref-test',
      prompt: () => 'test',
      inputSchema,
      outputSchema,
      adapter,
    });

    const meta = (fn as unknown as Record<symbol, unknown>)[TIDEMARK_META] as Record<string, unknown>;
    expect(meta.inputSchema).toBe(inputSchema);
    expect(meta.outputSchema).toBe(outputSchema);
  });

  it('fn[TIDEMARK_META] carries adapter reference', () => {
    const fn = createPromptFn({
      name: 'adapter-ref-test',
      prompt: () => 'test',
      inputSchema: z.object({}),
      outputSchema: z.object({ v: z.string() }),
      adapter,
    });

    const meta = (fn as unknown as Record<symbol, unknown>)[TIDEMARK_META] as Record<string, unknown>;
    expect(meta.adapter).toBe(adapter);
  });

  it('fn[TIDEMARK_META] carries temperature when set', () => {
    const fn = createPromptFn({
      name: 'temp-test',
      prompt: () => 'test',
      inputSchema: z.object({}),
      outputSchema: z.object({ v: z.string() }),
      adapter,
      temperature: 0.7,
    });

    const meta = (fn as unknown as Record<symbol, unknown>)[TIDEMARK_META] as Record<string, unknown>;
    expect(meta.temperature).toBe(0.7);
  });

  it('fn[TIDEMARK_META] carries tools when set', () => {
    const tools = { lookup: z.object({ query: z.string() }) };

    const fn = createPromptFn({
      name: 'tools-test',
      prompt: () => 'test',
      inputSchema: z.object({}),
      outputSchema: z.object({ v: z.string() }),
      adapter,
      tools,
    });

    const meta = (fn as unknown as Record<symbol, unknown>)[TIDEMARK_META] as Record<string, unknown>;
    expect(meta.tools).toBe(tools);
  });
});

describe('Standard Schema type surface (CORE-05)', () => {
  let adapter: MockAdapter;

  beforeEach(() => {
    adapter = new MockAdapter();
  });

  it('~standard is NOT a runtime property on fn (CORE-05 — zero runtime cost)', () => {
    const fn = createPromptFn({
      name: 'standard-schema-test',
      prompt: () => 'test',
      inputSchema: z.object({}),
      outputSchema: z.object({ value: z.string() }),
      adapter,
    });

    // ~standard must NOT exist at runtime — it is type-only (CORE-05)
    expect('~standard' in fn).toBe(false);
    expect((fn as unknown as Record<string, unknown>)['~standard']).toBeUndefined();
  });
});
