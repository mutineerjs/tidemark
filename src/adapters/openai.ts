// src/adapters/openai.ts
// OpenAIAdapter implements ProviderAdapter against openai@6.38.0 (chat completions API)
//
// SECURITY (T-03-01): API key is passed to `new OpenAI({ apiKey })` as a transport
// header only — it is NEVER placed in rawRequest params. The params object (rawRequest)
// excludes auth fields by construction.
//
// CRITICAL (Pitfall 1): modelVersion ALWAYS comes from completion.model (the API response),
// NEVER from this.model or params.model. The request model string may be an alias that
// the API resolves to a different concrete version string.
//
// CRITICAL (Pitfall 3): OpenAI tool call arguments (tc.function.arguments) is a JSON
// string — must JSON.parse() before setting ProviderToolCall.input. Anthropic's
// tool_use has `input` as a pre-parsed object; OpenAI does not.
//
// CRITICAL (Pitfall 4): OpenAI has no top-level system field — embed as
// { role: 'system', content } prepended to messages array.

import OpenAI from 'openai';
import type {
  ProviderAdapter,
  ProviderRequest,
  ProviderResponse,
  ProviderStreamChunk,
  TidemarkStreamSource,
} from './interface.js';
import { buildOpenAITools } from '../tools/convert.js';

// The return type of client.chat.completions.stream() — derived from the SDK so there's
// no dual-package hazard from importing the concrete type from a lib subpath.
type OpenAIChatStream = ReturnType<OpenAI['chat']['completions']['stream']>;

// ────────────────────────────────────────────────────────────────────────────
// Helper: map OpenAI finish_reason to ProviderResponse.stopReason
// ────────────────────────────────────────────────────────────────────────────
function mapFinishReason(
  reason: string | null | undefined
): ProviderResponse['stopReason'] {
  switch (reason) {
    case 'stop':
      return 'end_turn';
    case 'tool_calls':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'stop_sequence'; // closest semantic mapping
    default:
      return 'end_turn';
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helper: extract and parse tool calls from an OpenAI ChatCompletionMessage
// Pitfall 3: tc.function.arguments is a JSON string — must JSON.parse()
// Note: ChatCompletionMessageToolCall is a union of function-type and custom-type.
// Only function-type tool calls (type === 'function') have .function.arguments.
// ────────────────────────────────────────────────────────────────────────────
function extractOpenAIToolCalls(
  message: OpenAI.Chat.ChatCompletionMessage
): ProviderResponse['toolCalls'] {
  if (!message.tool_calls?.length) return undefined;
  const functionCalls = message.tool_calls.filter(
    (tc): tc is OpenAI.Chat.ChatCompletionMessageFunctionToolCall => tc.type === 'function'
  );
  if (!functionCalls.length) return undefined;
  return functionCalls.map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    input: JSON.parse(tc.function.arguments), // arguments is a JSON string, must parse
  }));
}

// ────────────────────────────────────────────────────────────────────────────
// OpenAIStreamSource — implements TidemarkStreamSource for streaming path
// ────────────────────────────────────────────────────────────────────────────
class OpenAIStreamSource implements TidemarkStreamSource {
  constructor(
    private readonly runner: OpenAIChatStream,
    private readonly params: OpenAI.Chat.ChatCompletionCreateParamsStreaming
  ) {}

  async *[Symbol.asyncIterator](): AsyncIterator<ProviderStreamChunk> {
    for await (const chunk of this.runner) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield { type: 'text', delta };
    }
  }

  async finalResponse(): Promise<ProviderResponse> {
    // finalChatCompletion() accumulates the full ChatCompletion from the stream.
    // Requires stream_options: { include_usage: true } in params (Pitfall 2) to ensure
    // usage is populated — always included in buildStreamingParams().
    const completion = await this.runner.finalChatCompletion();
    const message = completion.choices[0].message;
    return {
      text: message.content ?? '',
      modelVersion: completion.model, // ← from response, NOT this.params.model (Pitfall 1)
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
      rawRequest: this.params, // params object — no apiKey field (T-03-01)
      rawResponse: completion,
      stopReason: mapFinishReason(completion.choices[0].finish_reason),
      toolCalls: extractOpenAIToolCalls(message),
    };
  }

  abort(): void {
    this.runner.abort();
  }
}

// ────────────────────────────────────────────────────────────────────────────
// OpenAIAdapter
// ────────────────────────────────────────────────────────────────────────────
export class OpenAIAdapter implements ProviderAdapter {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(model: string, options?: { apiKey?: string }) {
    // apiKey is passed to the OpenAI constructor as a transport header option.
    // It does NOT appear in any request params object (rawRequest) — T-03-01 security mitigation.
    // The OpenAI SDK v6 requires a key at construction time (throws otherwise).
    // When no key is provided (e.g. in tests that substitute the client), use a placeholder
    // so construction succeeds — the placeholder is never sent to the network since
    // the client is replaced via object substitution in tests before any API calls.
    this.client = new OpenAI({ apiKey: options?.apiKey ?? 'placeholder-replaced-in-tests' });
    this.model = model;
  }

  /**
   * Build the OpenAI API ChatCompletionCreateParamsNonStreaming from a ProviderRequest.
   * The returned params object becomes rawRequest on the ProviderResponse.
   * SECURITY: no auth fields (apiKey) in this params object.
   * NOTE (Pitfall 4): OpenAI has no top-level system field — system context is
   * embedded as the first message with role 'system'.
   */
  private buildParams(
    request: ProviderRequest
  ): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming {
    return {
      model: this.model,
      max_tokens: request.maxTokens ?? 4096, // T-03-05: always bound (T-03-02-03)
      messages: [
        // Pitfall 4: OpenAI embeds system context as first message, not a top-level field
        ...(request.system
          ? [{ role: 'system' as const, content: request.system }]
          : []),
        ...(request.messages as OpenAI.Chat.ChatCompletionMessageParam[]),
      ],
      ...(request.tools ? { tools: buildOpenAITools(request.tools) } : {}),
      ...(request.temperature !== undefined
        ? { temperature: request.temperature }
        : {}),
      ...request.providerOptions,
    };
  }

  /**
   * Generate a non-streaming response from OpenAI.
   * modelVersion is always read from completion.model (the API response) — never from params.model.
   */
  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    const params = this.buildParams(request);
    const completion = await this.client.chat.completions.create(params);

    const message = completion.choices[0].message;

    return {
      text: message.content ?? '',
      modelVersion: completion.model, // ← CRITICAL: from response, NOT echoed from params (Pitfall 1)
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
      rawRequest: params, // params object — no apiKey field (T-03-01)
      rawResponse: completion,
      stopReason: mapFinishReason(completion.choices[0].finish_reason),
      toolCalls: extractOpenAIToolCalls(message),
    };
  }

  /**
   * Begin a streaming response from OpenAI.
   * Returns an OpenAIStreamSource implementing TidemarkStreamSource.
   * Includes stream_options: { include_usage: true } to ensure usage tokens are
   * populated in the streaming path (T-03-02-04 / Pitfall 2).
   */
  stream(request: ProviderRequest): TidemarkStreamSource {
    const baseParams = this.buildParams(request);
    const streamingParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
      ...baseParams,
      stream: true,
      stream_options: { include_usage: true }, // Pitfall 2: ensure usage populated in streaming
    };
    const runner = this.client.chat.completions.stream(streamingParams);
    return new OpenAIStreamSource(runner, streamingParams);
  }
}
