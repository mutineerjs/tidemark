// src/__tests__/anthropic-adapter.test.ts
// PROV-02 coverage: AnthropicAdapter implements ProviderAdapter with mocked SDK client.
// D-18: No real API key, no network calls — SDK client is replaced via object substitution.

import { describe, expect, it, vi } from 'vitest';
import * as z from 'zod';
import { AnthropicAdapter } from '../adapters/anthropic.js';
import { buildAnthropicTools, convertToolSchemas } from '../tools/convert.js';

// ────────────────────────────────────────────────────────────────────────────
// Fixture: mocked Anthropic message response (non-streaming)
// ────────────────────────────────────────────────────────────────────────────
const MOCK_TEXT_MESSAGE = {
  id: 'msg_01abc',
  type: 'message' as const,
  role: 'assistant' as const,
  model: 'claude-sonnet-4-5-20250929', // ← the RESPONSE model — may differ from request
  content: [{ type: 'text' as const, text: '{"x":1}' }],
  usage: { input_tokens: 12, output_tokens: 7 },
  stop_reason: 'end_turn' as const,
  stop_sequence: null,
};

const MOCK_TOOL_USE_MESSAGE = {
  id: 'msg_02def',
  type: 'message' as const,
  role: 'assistant' as const,
  model: 'claude-sonnet-4-5-20250929',
  content: [
    { type: 'tool_use' as const, id: 'tool_01', name: 'lookup', input: { q: 'hello' } },
  ],
  usage: { input_tokens: 20, output_tokens: 15 },
  stop_reason: 'tool_use' as const,
  stop_sequence: null,
};

// ────────────────────────────────────────────────────────────────────────────
// Helper: create an AnthropicAdapter and replace its private client with a mock
// ────────────────────────────────────────────────────────────────────────────
function createMockedAdapter(fixtureMessage: typeof MOCK_TEXT_MESSAGE | typeof MOCK_TOOL_USE_MESSAGE) {
  const adapter = new AnthropicAdapter('claude-sonnet-4-6');
  // Replace the private client using object substitution (no real Anthropic() call occurs
  // because we replace after construction — the mock never touches the network)
  const mockCreate = vi.fn().mockResolvedValue(fixtureMessage);
  const mockStream = vi.fn().mockReturnValue({
    on: vi.fn().mockReturnThis(),
    finalMessage: vi.fn().mockResolvedValue(fixtureMessage),
    abort: vi.fn(),
    [Symbol.asyncIterator]: async function* () { yield { type: 'text', delta: '{"x":1}' }; },
  });
  (adapter as unknown as { client: unknown }).client = {
    messages: {
      create: mockCreate,
      stream: mockStream,
    },
  };
  return { adapter, mockCreate, mockStream };
}

// ────────────────────────────────────────────────────────────────────────────
// AnthropicAdapter — type and interface compliance
// ────────────────────────────────────────────────────────────────────────────
describe('AnthropicAdapter — interface compliance', () => {
  it('constructs without an API key and is assignable to ProviderAdapter', () => {
    const adapter = new AnthropicAdapter('claude-sonnet-4-6');
    expect(adapter).toBeDefined();
    expect(typeof adapter.generate).toBe('function');
    expect(typeof adapter.stream).toBe('function');
  });

  it('constructs with an explicit apiKey option', () => {
    const adapter = new AnthropicAdapter('claude-haiku-3-20240307', { apiKey: 'sk-test-key' });
    expect(adapter).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AnthropicAdapter.generate() — happy path
// ────────────────────────────────────────────────────────────────────────────
describe('AnthropicAdapter.generate() — text response', () => {
  it('resolves with correct text field', async () => {
    const { adapter } = createMockedAdapter(MOCK_TEXT_MESSAGE);
    const response = await adapter.generate({
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(response.text).toBe('{"x":1}');
  });

  it('sets modelVersion from response.model — NOT from constructor model (Pitfall 3)', async () => {
    const { adapter } = createMockedAdapter(MOCK_TEXT_MESSAGE);
    const response = await adapter.generate({
      messages: [{ role: 'user', content: 'test' }],
    });
    // adapter was constructed with 'claude-sonnet-4-6'
    // but mock response has model 'claude-sonnet-4-5-20250929'
    // modelVersion MUST be from the response
    expect(response.modelVersion).toBe('claude-sonnet-4-5-20250929');
    expect(response.modelVersion).not.toBe('claude-sonnet-4-6');
  });

  it('sets inputTokens and outputTokens from usage', async () => {
    const { adapter } = createMockedAdapter(MOCK_TEXT_MESSAGE);
    const response = await adapter.generate({
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(response.inputTokens).toBe(12);
    expect(response.outputTokens).toBe(7);
  });

  it('sets stopReason from message.stop_reason', async () => {
    const { adapter } = createMockedAdapter(MOCK_TEXT_MESSAGE);
    const response = await adapter.generate({
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(response.stopReason).toBe('end_turn');
  });

  it('rawResponse is the mocked message object', async () => {
    const { adapter } = createMockedAdapter(MOCK_TEXT_MESSAGE);
    const response = await adapter.generate({
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(response.rawResponse).toBe(MOCK_TEXT_MESSAGE);
  });

  it('rawRequest is the params object passed to messages.create — NOT the ProviderRequest', async () => {
    const { adapter, mockCreate } = createMockedAdapter(MOCK_TEXT_MESSAGE);
    const response = await adapter.generate({
      messages: [{ role: 'user', content: 'test' }],
      maxTokens: 1024,
    });
    // rawRequest should be the Anthropic API params object, not the ProviderRequest
    const capturedParams = mockCreate.mock.calls[0][0];
    expect(response.rawRequest).toBe(capturedParams);
    // rawRequest must NOT contain an apiKey field (T-03-01 security mitigation)
    expect((response.rawRequest as Record<string, unknown>)).not.toHaveProperty('apiKey');
  });

  it('toolCalls is empty or undefined for end_turn responses', async () => {
    const { adapter } = createMockedAdapter(MOCK_TEXT_MESSAGE);
    const response = await adapter.generate({
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(response.toolCalls).toBeUndefined();
  });

  it('calls messages.create with model from constructor, not from response', async () => {
    const { adapter, mockCreate } = createMockedAdapter(MOCK_TEXT_MESSAGE);
    await adapter.generate({ messages: [{ role: 'user', content: 'test' }] });
    const params = mockCreate.mock.calls[0][0];
    expect(params.model).toBe('claude-sonnet-4-6');
  });

  it('defaults max_tokens to 4096 when maxTokens not provided', async () => {
    const { adapter, mockCreate } = createMockedAdapter(MOCK_TEXT_MESSAGE);
    await adapter.generate({ messages: [{ role: 'user', content: 'test' }] });
    const params = mockCreate.mock.calls[0][0];
    expect(params.max_tokens).toBe(4096);
  });

  it('passes maxTokens override through to params', async () => {
    const { adapter, mockCreate } = createMockedAdapter(MOCK_TEXT_MESSAGE);
    await adapter.generate({ messages: [{ role: 'user', content: 'test' }], maxTokens: 2048 });
    const params = mockCreate.mock.calls[0][0];
    expect(params.max_tokens).toBe(2048);
  });

  it('passes system string through to params', async () => {
    const { adapter, mockCreate } = createMockedAdapter(MOCK_TEXT_MESSAGE);
    await adapter.generate({
      messages: [{ role: 'user', content: 'test' }],
      system: 'You are a helpful assistant',
    });
    const params = mockCreate.mock.calls[0][0];
    expect(params.system).toBe('You are a helpful assistant');
  });

  it('passes temperature through to params', async () => {
    const { adapter, mockCreate } = createMockedAdapter(MOCK_TEXT_MESSAGE);
    await adapter.generate({
      messages: [{ role: 'user', content: 'test' }],
      temperature: 0.5,
    });
    const params = mockCreate.mock.calls[0][0];
    expect(params.temperature).toBe(0.5);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AnthropicAdapter.generate() — tool_use response
// ────────────────────────────────────────────────────────────────────────────
describe('AnthropicAdapter.generate() — tool_use response', () => {
  it('sets stopReason to tool_use', async () => {
    const { adapter } = createMockedAdapter(MOCK_TOOL_USE_MESSAGE);
    const response = await adapter.generate({
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(response.stopReason).toBe('tool_use');
  });

  it('maps tool_use content blocks to toolCalls', async () => {
    const { adapter } = createMockedAdapter(MOCK_TOOL_USE_MESSAGE);
    const response = await adapter.generate({
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(response.toolCalls).toBeDefined();
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0]).toEqual({ id: 'tool_01', name: 'lookup', input: { q: 'hello' } });
  });

  it('text is empty string when only tool_use content block present', async () => {
    const { adapter } = createMockedAdapter(MOCK_TOOL_USE_MESSAGE);
    const response = await adapter.generate({
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(response.text).toBe('');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AnthropicAdapter.stream() — returns a TidemarkStreamSource
// ────────────────────────────────────────────────────────────────────────────
describe('AnthropicAdapter.stream()', () => {
  it('returns an object with Symbol.asyncIterator, finalResponse, and abort', () => {
    const { adapter } = createMockedAdapter(MOCK_TEXT_MESSAGE);
    const source = adapter.stream({ messages: [{ role: 'user', content: 'test' }] });
    expect(typeof source[Symbol.asyncIterator]).toBe('function');
    expect(typeof source.finalResponse).toBe('function');
    expect(typeof source.abort).toBe('function');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// buildAnthropicTools
// ────────────────────────────────────────────────────────────────────────────
describe('buildAnthropicTools()', () => {
  it('maps ProviderToolDefinitions to Anthropic Tool array', () => {
    const defs = [
      { name: 'lookup', description: 'd', inputSchema: { type: 'object', properties: {} } },
    ];
    const tools = buildAnthropicTools(defs);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('lookup');
    expect(tools[0].input_schema).toEqual({ type: 'object', properties: {} });
  });

  it('uses name as description when no description provided', () => {
    const defs = [
      { name: 'search', inputSchema: { type: 'object', properties: {} } },
    ];
    const tools = buildAnthropicTools(defs);
    expect(tools[0].description).toBe('search');
  });

  it('uses provided description when present', () => {
    const defs = [
      { name: 'search', description: 'Search for things', inputSchema: { type: 'object', properties: {} } },
    ];
    const tools = buildAnthropicTools(defs);
    expect(tools[0].description).toBe('Search for things');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// convertToolSchemas
// ────────────────────────────────────────────────────────────────────────────
describe('convertToolSchemas()', () => {
  it('converts a Zod object schema to ProviderToolDefinition', () => {
    const tools = convertToolSchemas({
      lookup: z.object({ q: z.string() }),
    });
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('lookup');
    expect(tools[0].inputSchema).toBeDefined();
    expect(tools[0].inputSchema).toHaveProperty('properties');
  });

  it('includes description from z.describe()', () => {
    const tools = convertToolSchemas({
      search: z.object({ q: z.string() }).describe('Search tool'),
    });
    expect(tools[0].description).toBe('Search tool');
  });

  it('returns no description when no .describe() is set', () => {
    const tools = convertToolSchemas({
      lookup: z.object({ q: z.string() }),
    });
    expect(tools[0].description).toBeUndefined();
  });

  it('returns a properties key in inputSchema (confirms z.toJSONSchema output)', () => {
    const tools = convertToolSchemas({
      lookup: z.object({ q: z.string() }),
    });
    expect(typeof (tools[0].inputSchema as Record<string, unknown>).properties).not.toBe('undefined');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Security: rawRequest must not contain apiKey (T-03-01)
// ────────────────────────────────────────────────────────────────────────────
describe('Security: T-03-01 — apiKey not in rawRequest', () => {
  it('rawRequest params do not contain an apiKey field', async () => {
    const adapter = new AnthropicAdapter('claude-sonnet-4-6', { apiKey: 'sk-secret-key' });
    const mockCreate = vi.fn().mockResolvedValue(MOCK_TEXT_MESSAGE);
    (adapter as unknown as { client: unknown }).client = {
      messages: { create: mockCreate, stream: vi.fn() },
    };
    const response = await adapter.generate({
      messages: [{ role: 'user', content: 'test' }],
    });
    const rawReq = response.rawRequest as Record<string, unknown>;
    expect(rawReq).not.toHaveProperty('apiKey');
    expect(rawReq).not.toHaveProperty('api_key');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// buildParams — nullishToOr boundary: maxTokens: 0 must not fall through to default
// ────────────────────────────────────────────────────────────────────────────
describe('AnthropicAdapter.generate() — maxTokens: 0 nullish boundary', () => {
  it('passes maxTokens: 0 as max_tokens (nullish coalescing, not falsy fallback)', async () => {
    const { adapter, mockCreate } = createMockedAdapter(MOCK_TEXT_MESSAGE);
    await adapter.generate({ messages: [{ role: 'user', content: 'test' }], maxTokens: 0 });
    const params = mockCreate.mock.calls[0][0];
    expect(params.max_tokens).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AnthropicAdapter.stream() — params inspection
// Covers escaped mutations in the stream() inline params block (lines 154-157)
// ────────────────────────────────────────────────────────────────────────────
describe('AnthropicAdapter.stream() — params passed to messages.stream()', () => {
  it('passes maxTokens: 0 as max_tokens (nullish coalescing, not falsy fallback)', () => {
    const { adapter, mockStream } = createMockedAdapter(MOCK_TEXT_MESSAGE);
    adapter.stream({ messages: [{ role: 'user', content: 'test' }], maxTokens: 0 });
    const params = mockStream.mock.calls[0][0];
    expect(params.max_tokens).toBe(0);
  });

  it('includes system in params when system string is provided', () => {
    const { adapter, mockStream } = createMockedAdapter(MOCK_TEXT_MESSAGE);
    adapter.stream({ messages: [{ role: 'user', content: 'test' }], system: 'Be concise.' });
    const params = mockStream.mock.calls[0][0];
    expect(params).toHaveProperty('system', 'Be concise.');
  });

  it('includes temperature in params when temperature is provided', () => {
    const { adapter, mockStream } = createMockedAdapter(MOCK_TEXT_MESSAGE);
    adapter.stream({ messages: [{ role: 'user', content: 'test' }], temperature: 0.7 });
    const params = mockStream.mock.calls[0][0];
    expect(params).toHaveProperty('temperature', 0.7);
  });

  it('omits system from params when system is not provided', () => {
    const { adapter, mockStream } = createMockedAdapter(MOCK_TEXT_MESSAGE);
    adapter.stream({ messages: [{ role: 'user', content: 'test' }] });
    const params = mockStream.mock.calls[0][0];
    expect(params).not.toHaveProperty('system');
  });

  it('omits temperature from params when temperature is not provided', () => {
    const { adapter, mockStream } = createMockedAdapter(MOCK_TEXT_MESSAGE);
    adapter.stream({ messages: [{ role: 'user', content: 'test' }] });
    const params = mockStream.mock.calls[0][0];
    expect(params).not.toHaveProperty('temperature');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AnthropicStreamSource — iterator event filtering
// Tests that only content_block_delta / text_delta events yield text chunks.
// Covers flipStrictEQ and andToOr mutations on lines 43-44.
// ────────────────────────────────────────────────────────────────────────────
describe('AnthropicStreamSource iterator — event type filtering', () => {
  it('yields only text_delta chunks from content_block_delta events; ignores all other event types', async () => {
    const { adapter } = createMockedAdapter(MOCK_TEXT_MESSAGE);
    const mockSDKStream = {
      finalMessage: vi.fn().mockResolvedValue(MOCK_TEXT_MESSAGE),
      abort: vi.fn(),
      [Symbol.asyncIterator]: async function* () {
        yield { type: 'message_start', message: {} };
        // content_block_delta with wrong delta type — should not yield
        yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"x"' } };
        // correct event — should yield
        yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } };
        yield { type: 'message_stop' };
      },
    };
    (adapter as unknown as { client: unknown }).client = {
      messages: { create: vi.fn(), stream: vi.fn().mockReturnValue(mockSDKStream) },
    };
    const source = adapter.stream({ messages: [{ role: 'user', content: 'test' }] });
    const chunks: string[] = [];
    for await (const chunk of source) {
      chunks.push(chunk.delta);
    }
    expect(chunks).toEqual(['hello']);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AnthropicStreamSource.finalResponse() — content block filtering
// Tests text/tool_use block separation and the toolUseBlocks.length > 0 guard.
// Covers flipStrictEQ mutations on lines 56 and 59, and tightenGT on line 70.
// ────────────────────────────────────────────────────────────────────────────
describe('AnthropicStreamSource.finalResponse() — content block filtering', () => {
  function makeStreamSource(contentBlocks: unknown[], stopReason = 'end_turn') {
    const message = {
      ...MOCK_TEXT_MESSAGE,
      content: contentBlocks,
      stop_reason: stopReason,
    };
    return {
      finalMessage: vi.fn().mockResolvedValue(message),
      abort: vi.fn(),
      [Symbol.asyncIterator]: async function* () {},
    };
  }

  it('joins only text blocks into the text field — non-text blocks are excluded', async () => {
    const { adapter } = createMockedAdapter(MOCK_TEXT_MESSAGE);
    (adapter as unknown as { client: unknown }).client = {
      messages: {
        create: vi.fn(),
        stream: vi.fn().mockReturnValue(makeStreamSource([
          { type: 'tool_use', id: 'tu1', name: 'fn', input: {} },
          { type: 'text', text: 'result text' },
        ])),
      },
    };
    const response = await adapter.stream({ messages: [{ role: 'user', content: 'test' }] }).finalResponse();
    expect(response.text).toBe('result text');
  });

  it('maps only tool_use blocks to toolCalls — text blocks are excluded from toolCalls', async () => {
    const { adapter } = createMockedAdapter(MOCK_TEXT_MESSAGE);
    (adapter as unknown as { client: unknown }).client = {
      messages: {
        create: vi.fn(),
        stream: vi.fn().mockReturnValue(makeStreamSource([
          { type: 'text', text: 'thinking...' },
          { type: 'tool_use', id: 'tu1', name: 'get_weather', input: { city: 'NYC' } },
        ], 'tool_use')),
      },
    };
    const response = await adapter.stream({ messages: [{ role: 'user', content: 'test' }] }).finalResponse();
    expect(response.toolCalls).toBeDefined();
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0]).toEqual({ id: 'tu1', name: 'get_weather', input: { city: 'NYC' } });
  });

  it('returns undefined toolCalls (not empty array) when no tool_use blocks are present', async () => {
    const { adapter } = createMockedAdapter(MOCK_TEXT_MESSAGE);
    (adapter as unknown as { client: unknown }).client = {
      messages: {
        create: vi.fn(),
        stream: vi.fn().mockReturnValue(makeStreamSource([
          { type: 'text', text: 'hello' },
        ])),
      },
    };
    const response = await adapter.stream({ messages: [{ role: 'user', content: 'test' }] }).finalResponse();
    expect(response.toolCalls).toBeUndefined();
  });
});
