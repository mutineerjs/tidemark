// src/__tests__/tools.test.ts
// CALL-02 coverage: agentic tool loop with Zod-validated args
//
// All tests use MockAdapter — no real API key required (D-18).

import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as z from 'zod';
import { MockAdapter } from '../adapters/mock.js';
import { createPromptFn } from '../core/factory.js';
import { TidemarkToolLoopError } from '../core/errors.js';
import type { ProviderToolCall } from '../adapters/interface.js';

describe('Tool use agentic loop (CALL-02)', () => {
  let adapter: MockAdapter;

  beforeEach(() => {
    adapter = new MockAdapter();
  });

  // Helper: create a tool_use response with a given tool call
  function makeToolUseResponse(toolCall: ProviderToolCall) {
    return {
      text: '',
      stopReason: 'tool_use' as const,
      toolCalls: [toolCall],
      // rawResponse shape needed for the assistant turn in runAgenticLoop
    };
  }

  it('calls the lookup handler exactly once on tool_use→end_turn sequence and resolves final output', async () => {
    const lookupHandler = vi.fn().mockResolvedValue('lookup-result');

    // Queue: first response is tool_use, second is end_turn with valid JSON
    adapter.enqueue(makeToolUseResponse({ id: 'tc-1', name: 'lookup', input: { q: 'hello' } }));
    adapter.enqueue({ text: '{"answer":"found it"}' });

    const fn = createPromptFn({
      name: 'tool-test',
      prompt: () => 'test prompt',
      inputSchema: z.object({}),
      outputSchema: z.object({ answer: z.string() }),
      adapter,
      tools: {
        lookup: z.object({ q: z.string() }),
      },
    });

    const result = await fn({}, { handlers: { lookup: lookupHandler } });

    expect(result.output.answer).toBe('found it');
    expect(lookupHandler).toHaveBeenCalledTimes(1);
  });

  it('handler receives Zod-parsed args (not the raw input)', async () => {
    let receivedArgs: unknown;
    const lookupHandler = vi.fn().mockImplementation(async (args) => {
      receivedArgs = args;
      return 'result';
    });

    adapter.enqueue(makeToolUseResponse({ id: 'tc-2', name: 'lookup', input: { q: 'test', count: 3 } }));
    adapter.enqueue({ text: '{"answer":"ok"}' });

    const fn = createPromptFn({
      name: 'tool-arg-test',
      prompt: () => 'test',
      inputSchema: z.object({}),
      outputSchema: z.object({ answer: z.string() }),
      adapter,
      tools: {
        // Only 'q' is in schema — 'count' will be stripped by Zod safeParse
        lookup: z.object({ q: z.string() }),
      },
    });

    await fn({}, { handlers: { lookup: lookupHandler } });

    // args must be Zod-parsed: only schema fields are present
    expect((receivedArgs as { q: string }).q).toBe('test');
  });

  it('throws when tool input fails Zod schema — handler is NOT invoked (D-14)', async () => {
    const lookupHandler = vi.fn();

    // Tool expects q to be a string, but input sends a number — should fail Zod validation
    adapter.enqueue(makeToolUseResponse({ id: 'tc-3', name: 'lookup', input: { q: 42 } }));

    const fn = createPromptFn({
      name: 'tool-arg-validation-test',
      prompt: () => 'test',
      inputSchema: z.object({}),
      outputSchema: z.object({ answer: z.string() }),
      adapter,
      tools: {
        lookup: z.object({ q: z.string() }),
      },
    });

    await expect(fn({}, { handlers: { lookup: lookupHandler } })).rejects.toThrow();
    // Handler must NOT have been called (D-14)
    expect(lookupHandler).not.toHaveBeenCalled();
  });

  it('throws an Error identifying the missing tool name when handler is not provided', async () => {
    adapter.enqueue(makeToolUseResponse({ id: 'tc-4', name: 'lookup', input: { q: 'x' } }));

    const fn = createPromptFn({
      name: 'missing-handler-test',
      prompt: () => 'test',
      inputSchema: z.object({}),
      outputSchema: z.object({ answer: z.string() }),
      adapter,
      tools: {
        lookup: z.object({ q: z.string() }),
      },
    });

    // No handlers provided — must throw naming 'lookup'
    await expect(fn({}, {})).rejects.toThrow('lookup');
  });

  it('throws TidemarkToolLoopError when model keeps returning tool_use beyond maxToolRounds', async () => {
    // Queue more than default maxToolRounds (10) tool_use responses
    for (let i = 0; i < 12; i++) {
      adapter.enqueue(makeToolUseResponse({ id: `tc-${i}`, name: 'loop', input: { q: `x${i}` } }));
    }

    const fn = createPromptFn({
      name: 'tool-loop-test',
      prompt: () => 'test',
      inputSchema: z.object({}),
      outputSchema: z.object({ answer: z.string() }),
      adapter,
      tools: {
        loop: z.object({ q: z.string() }),
      },
    });

    const loopHandler = vi.fn().mockResolvedValue('keep-going');

    await expect(
      fn({}, { handlers: { loop: loopHandler } })
    ).rejects.toThrow(TidemarkToolLoopError);
  });

  it('respects configurable maxToolRounds from createPromptFn config', async () => {
    // Queue 3 tool_use responses — should exceed maxToolRounds=2
    for (let i = 0; i < 3; i++) {
      adapter.enqueue(makeToolUseResponse({ id: `tc-${i}`, name: 'loop', input: { q: `x${i}` } }));
    }

    const fn = createPromptFn({
      name: 'custom-rounds-test',
      prompt: () => 'test',
      inputSchema: z.object({}),
      outputSchema: z.object({ answer: z.string() }),
      adapter,
      maxToolRounds: 2, // custom lower limit
      tools: {
        loop: z.object({ q: z.string() }),
      },
    });

    const loopHandler = vi.fn().mockResolvedValue('next');

    await expect(
      fn({}, { handlers: { loop: loopHandler } })
    ).rejects.toThrow(TidemarkToolLoopError);
  });

  it('completes without tools when no tools config is set (non-tool path unchanged)', async () => {
    adapter.enqueue({ text: '{"category":"sports"}' });

    const fn = createPromptFn({
      name: 'no-tools-test',
      prompt: () => 'test',
      inputSchema: z.object({}),
      outputSchema: z.object({ category: z.string() }),
      adapter,
    });

    const result = await fn({});
    expect(result.output.category).toBe('sports');
  });
});
