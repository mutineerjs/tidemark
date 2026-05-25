// src/__tests__/openai-adapter.test.ts
// PROV-03 coverage: OpenAIAdapter implements ProviderAdapter with mocked SDK client.
// D-18: No real API key, no network calls — SDK client is replaced via object substitution.

import { describe, expect, it, vi } from 'vitest';
import * as z from 'zod';
import { OpenAIAdapter } from '../adapters/openai.js';
import { buildOpenAITools } from '../tools/convert.js';

// ────────────────────────────────────────────────────────────────────────────
// Fixture: mocked OpenAI chat completion response (non-streaming, text)
// ────────────────────────────────────────────────────────────────────────────
const MOCK_CHAT_COMPLETION = {
  id: 'chatcmpl-abc123',
  model: 'gpt-4o-2024-08-06', // ← the RESPONSE model — may differ from request
  choices: [
    {
      message: {
        role: 'assistant' as const,
        content: '{"x":1}',
        tool_calls: undefined as undefined,
      },
      finish_reason: 'stop' as const,
    },
  ],
  usage: {
    prompt_tokens: 12,
    completion_tokens: 7,
    total_tokens: 19,
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Fixture: mocked OpenAI chat completion response with tool_calls
// ────────────────────────────────────────────────────────────────────────────
const MOCK_TOOL_COMPLETION = {
  id: 'chatcmpl-def456',
  model: 'gpt-4o-2024-08-06',
  choices: [
    {
      message: {
        role: 'assistant' as const,
        content: null as null,
        tool_calls: [
          {
            id: 'call_abc',
            type: 'function' as const,
            function: {
              name: 'lookup',
              arguments: '{"q":"hello"}', // JSON STRING — must JSON.parse() (Pitfall 3)
            },
          },
        ],
      },
      finish_reason: 'tool_calls' as const,
    },
  ],
  usage: {
    prompt_tokens: 20,
    completion_tokens: 15,
    total_tokens: 35,
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Helper: create an OpenAIAdapter and replace its private client with a mock
// ────────────────────────────────────────────────────────────────────────────
function createMockedAdapter(fixture: typeof MOCK_CHAT_COMPLETION | typeof MOCK_TOOL_COMPLETION) {
  const adapter = new OpenAIAdapter('gpt-4o');
  // Replace the private client using object substitution (no real OpenAI() call occurs
  // because we replace after construction — the mock never touches the network)
  const mockCreate = vi.fn().mockResolvedValue(fixture);
  const mockStream = vi.fn().mockReturnValue({
    finalChatCompletion: vi.fn().mockResolvedValue(fixture),
    abort: vi.fn(),
    [Symbol.asyncIterator]: async function* () {
      yield { choices: [{ delta: { content: '{"x":1}' } }] };
    },
  });
  (adapter as unknown as { client: unknown }).client = {
    chat: {
      completions: {
        create: mockCreate,
        stream: mockStream,
      },
    },
  };
  return { adapter, mockCreate, mockStream };
}

// ────────────────────────────────────────────────────────────────────────────
// OpenAIAdapter — type and interface compliance
// ────────────────────────────────────────────────────────────────────────────
describe('OpenAIAdapter — interface compliance', () => {
  it('constructs without an API key and has generate and stream methods', () => {
    const adapter = new OpenAIAdapter('gpt-4o');
    expect(adapter).toBeDefined();
    expect(typeof adapter.generate).toBe('function');
    expect(typeof adapter.stream).toBe('function');
  });

  it('constructs with an explicit apiKey option', () => {
    const adapter = new OpenAIAdapter('gpt-4o-mini', { apiKey: 'sk-test-key' });
    expect(adapter).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// OpenAIAdapter.generate() — text response
// ────────────────────────────────────────────────────────────────────────────
describe('OpenAIAdapter.generate() — text response', () => {
  it('resolves with correct text field', async () => {
    const { adapter } = createMockedAdapter(MOCK_CHAT_COMPLETION);
    const response = await adapter.generate({
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(response.text).toBe('{"x":1}');
  });

  it('sets modelVersion from completion.model — NOT from constructor model string (Pitfall 1)', async () => {
    const { adapter } = createMockedAdapter(MOCK_CHAT_COMPLETION);
    const response = await adapter.generate({
      messages: [{ role: 'user', content: 'test' }],
    });
    // adapter was constructed with 'gpt-4o'
    // but mock response has model 'gpt-4o-2024-08-06'
    // modelVersion MUST be from the response, never from this.model
    expect(response.modelVersion).toBe('gpt-4o-2024-08-06');
    expect(response.modelVersion).not.toBe('gpt-4o');
  });

  it('sets inputTokens from usage.prompt_tokens, outputTokens from usage.completion_tokens', async () => {
    const { adapter } = createMockedAdapter(MOCK_CHAT_COMPLETION);
    const response = await adapter.generate({
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(response.inputTokens).toBe(12);
    expect(response.outputTokens).toBe(7);
  });

  it('sets stopReason to end_turn when finish_reason is stop', async () => {
    const { adapter } = createMockedAdapter(MOCK_CHAT_COMPLETION);
    const response = await adapter.generate({
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(response.stopReason).toBe('end_turn');
  });

  it('rawRequest is the params object passed to chat.completions.create (not the ProviderRequest)', async () => {
    const { adapter, mockCreate } = createMockedAdapter(MOCK_CHAT_COMPLETION);
    const response = await adapter.generate({
      messages: [{ role: 'user', content: 'test' }],
      maxTokens: 1024,
    });
    // rawRequest should be the OpenAI API params object, not the ProviderRequest
    const capturedParams = mockCreate.mock.calls[0][0];
    expect(response.rawRequest).toBe(capturedParams);
  });

  it('rawRequest does not contain apiKey field (T-03-01 security)', async () => {
    const { adapter } = createMockedAdapter(MOCK_CHAT_COMPLETION);
    const response = await adapter.generate({
      messages: [{ role: 'user', content: 'test' }],
    });
    expect((response.rawRequest as Record<string, unknown>)).not.toHaveProperty('apiKey');
    expect((response.rawRequest as Record<string, unknown>)).not.toHaveProperty('api_key');
  });

  it('defaults max_tokens to 4096 when maxTokens not provided', async () => {
    const { adapter, mockCreate } = createMockedAdapter(MOCK_CHAT_COMPLETION);
    await adapter.generate({ messages: [{ role: 'user', content: 'test' }] });
    const params = mockCreate.mock.calls[0][0];
    expect(params.max_tokens).toBe(4096);
  });

  it('embeds system context as first messages array entry with role system — not a top-level field (Pitfall 4)', async () => {
    const { adapter, mockCreate } = createMockedAdapter(MOCK_CHAT_COMPLETION);
    await adapter.generate({
      messages: [{ role: 'user', content: 'test' }],
      system: 'You are a helpful assistant',
    });
    const params = mockCreate.mock.calls[0][0];
    // OpenAI has no top-level system field — it must be the first message
    expect(params).not.toHaveProperty('system');
    const firstMsg = params.messages[0];
    expect(firstMsg.role).toBe('system');
    expect(firstMsg.content).toBe('You are a helpful assistant');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// OpenAIAdapter.generate() — tool_calls response
// ────────────────────────────────────────────────────────────────────────────
describe('OpenAIAdapter.generate() — tool_calls response', () => {
  it('sets stopReason to tool_use when finish_reason is tool_calls', async () => {
    const { adapter } = createMockedAdapter(MOCK_TOOL_COMPLETION);
    const response = await adapter.generate({
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(response.stopReason).toBe('tool_use');
  });

  it('maps tool_calls[0].function.arguments (JSON string) to toolCalls[0].input as parsed object (Pitfall 3)', async () => {
    const { adapter } = createMockedAdapter(MOCK_TOOL_COMPLETION);
    const response = await adapter.generate({
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(response.toolCalls).toBeDefined();
    expect(response.toolCalls).toHaveLength(1);
    // input must be a parsed object, NOT the raw JSON string '{"q":"hello"}'
    expect(response.toolCalls![0]).toEqual({ id: 'call_abc', name: 'lookup', input: { q: 'hello' } });
    expect(typeof response.toolCalls![0].input).toBe('object');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// OpenAIAdapter.stream() — returns a TidemarkStreamSource
// ────────────────────────────────────────────────────────────────────────────
describe('OpenAIAdapter.stream()', () => {
  it('returns an object with Symbol.asyncIterator, finalResponse, and abort', () => {
    const { adapter } = createMockedAdapter(MOCK_CHAT_COMPLETION);
    const source = adapter.stream({ messages: [{ role: 'user', content: 'test' }] });
    expect(typeof source[Symbol.asyncIterator]).toBe('function');
    expect(typeof source.finalResponse).toBe('function');
    expect(typeof source.abort).toBe('function');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// buildOpenAITools
// ────────────────────────────────────────────────────────────────────────────
describe('buildOpenAITools()', () => {
  it('wraps tool definitions in { type: function, function: { name, description, parameters } }', () => {
    const defs = [
      { name: 'lookup', description: 'Look something up', inputSchema: { type: 'object', properties: {} } },
    ];
    const tools = buildOpenAITools(defs);
    expect(tools).toHaveLength(1);
    expect(tools[0].type).toBe('function');
    expect(tools[0].function.name).toBe('lookup');
    expect(tools[0].function.description).toBe('Look something up');
    expect(tools[0].function).toHaveProperty('parameters');
  });

  it('uses name as description when no description provided', () => {
    const defs = [
      { name: 'search', inputSchema: { type: 'object', properties: {} } },
    ];
    const tools = buildOpenAITools(defs);
    expect(tools[0].function.description).toBe('search');
  });

  it('uses parameters key (not input_schema) for JSON Schema', () => {
    const schema = { type: 'object', properties: { q: { type: 'string' } } };
    const defs = [
      { name: 'lookup', inputSchema: schema },
    ];
    const tools = buildOpenAITools(defs);
    expect(tools[0].function.parameters).toEqual(schema);
    expect(tools[0].function).not.toHaveProperty('input_schema');
  });

  it('converts a Zod schema via z.toJSONSchema for use with buildOpenAITools', () => {
    // Verifies the full pipeline: Zod schema → JSON Schema → OpenAI tool format
    const schema = z.object({ q: z.string() });
    const jsonSchema = z.toJSONSchema(schema);
    const defs = [
      { name: 'lookup', description: 'Search', inputSchema: jsonSchema as Record<string, unknown> },
    ];
    const tools = buildOpenAITools(defs);
    expect(tools[0].function.parameters).toHaveProperty('properties');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Security: rawRequest must not contain apiKey (T-03-01)
// ────────────────────────────────────────────────────────────────────────────
describe('Security: T-03-01 — apiKey not in rawRequest', () => {
  it('rawRequest params do not contain an apiKey field', async () => {
    const adapter = new OpenAIAdapter('gpt-4o', { apiKey: 'sk-secret-key' });
    const mockCreate = vi.fn().mockResolvedValue(MOCK_CHAT_COMPLETION);
    (adapter as unknown as { client: unknown }).client = {
      chat: {
        completions: {
          create: mockCreate,
          stream: vi.fn(),
        },
      },
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
describe('OpenAIAdapter.generate() — maxTokens: 0 nullish boundary', () => {
  it('passes maxTokens: 0 as max_tokens (nullish coalescing, not falsy fallback)', async () => {
    const { adapter, mockCreate } = createMockedAdapter(MOCK_CHAT_COMPLETION);
    await adapter.generate({ messages: [{ role: 'user', content: 'test' }], maxTokens: 0 });
    const params = mockCreate.mock.calls[0][0];
    expect(params.max_tokens).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// buildParams — flipStrictNEQ boundary: temperature: 0 must not be omitted
// ────────────────────────────────────────────────────────────────────────────
describe('OpenAIAdapter.generate() — temperature: 0 boundary', () => {
  it('includes temperature: 0 in params when explicitly set (not undefined)', async () => {
    const { adapter, mockCreate } = createMockedAdapter(MOCK_CHAT_COMPLETION);
    await adapter.generate({ messages: [{ role: 'user', content: 'test' }], temperature: 0 });
    const params = mockCreate.mock.calls[0][0];
    expect(params).toHaveProperty('temperature', 0);
  });

  it('omits temperature from params when not provided', async () => {
    const { adapter, mockCreate } = createMockedAdapter(MOCK_CHAT_COMPLETION);
    await adapter.generate({ messages: [{ role: 'user', content: 'test' }] });
    const params = mockCreate.mock.calls[0][0];
    expect(params).not.toHaveProperty('temperature');
  });
});
