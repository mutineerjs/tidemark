// src/adapters/anthropic.ts
// AnthropicAdapter implements ProviderAdapter against @anthropic-ai/sdk@0.97.0
//
// SECURITY (T-03-01): API key is passed to `new Anthropic({ apiKey })` as a transport
// header only — it is NEVER placed in rawRequest params. The params object (rawRequest)
// excludes auth fields by construction.
//
// CRITICAL (Pitfall 3): modelVersion ALWAYS comes from message.model (the API response),
// NEVER from this.model or params.model. The request model string may be an alias that
// the API resolves to a different concrete version string.

import Anthropic from '@anthropic-ai/sdk';
import type {
  ProviderAdapter,
  ProviderRequest,
  ProviderResponse,
  ProviderStreamChunk,
  TidemarkStreamSource,
} from './interface.js';
import { buildAnthropicTools } from '../tools/convert.js';

// The return type of client.messages.stream() — derived from the SDK so there's no
// dual-package hazard from importing MessageStream from the lib subpath.
type AnthropicMessageStream = ReturnType<Anthropic['messages']['stream']>;

// ────────────────────────────────────────────────────────────────────────────
// AnthropicStreamSource — implements TidemarkStreamSource for streaming path
// Full streaming consumer wiring is exercised in Plan 04.
// This class must compile and expose the correct interface; generate-path
// siblings are tested in Plan 03.
// ────────────────────────────────────────────────────────────────────────────
class AnthropicStreamSource implements TidemarkStreamSource {
  constructor(
    private readonly sdkStream: AnthropicMessageStream,
    private readonly params: Anthropic.MessageStreamParams
  ) {}

  async *[Symbol.asyncIterator](): AsyncIterator<ProviderStreamChunk> {
    // Yield text deltas from the SDK stream — typed via MessageStreamEvent
    // Full wiring exercised in Plan 04
    for await (const event of this.sdkStream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield { type: 'text', delta: event.delta.text };
      }
    }
  }

  async finalResponse(): Promise<ProviderResponse> {
    const finalMessage = await this.sdkStream.finalMessage();
    // finalMessage.content is ParsedContentBlock[] — cast to ContentBlock[] for uniform filtering
    const content = finalMessage.content as Anthropic.ContentBlock[];
    const textBlocks = content.filter(
      (b): b is Anthropic.TextBlock => b.type === 'text'
    );
    const toolUseBlocks = content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );
    return {
      text: textBlocks.map((b) => b.text).join(''),
      modelVersion: finalMessage.model, // ← from response, NOT echoed from params (Pitfall 3)
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
      rawRequest: this.params,
      rawResponse: finalMessage,
      stopReason: finalMessage.stop_reason as ProviderResponse['stopReason'],
      toolCalls:
        toolUseBlocks.length > 0
          ? toolUseBlocks.map((b) => ({ id: b.id, name: b.name, input: b.input }))
          : undefined,
    };
  }

  abort(): void {
    this.sdkStream.abort();
  }
}

// ────────────────────────────────────────────────────────────────────────────
// AnthropicAdapter
// ────────────────────────────────────────────────────────────────────────────
export class AnthropicAdapter implements ProviderAdapter {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(model: string, options?: { apiKey?: string }) {
    // apiKey is passed to the Anthropic constructor as a transport header option.
    // It does NOT appear in any request params object (rawRequest) — T-03-01 security mitigation.
    this.client = new Anthropic({ apiKey: options?.apiKey });
    this.model = model;
  }

  /**
   * Build the Anthropic API MessageCreateParams from a ProviderRequest.
   * The returned params object becomes rawRequest on the ProviderResponse.
   * SECURITY: no auth fields (apiKey) in this params object.
   */
  private buildParams(request: ProviderRequest): Anthropic.MessageCreateParamsNonStreaming {
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: request.maxTokens ?? 4096, // T-03-05: always bound
      messages: request.messages as Anthropic.MessageParam[],
      ...( request.system !== undefined ? { system: request.system } : {} ),
      ...( request.tools ? { tools: buildAnthropicTools(request.tools) } : {} ),
      ...( request.temperature !== undefined ? { temperature: request.temperature } : {} ),
      ...request.providerOptions,
    };
    return params;
  }

  /**
   * Generate a non-streaming response from Anthropic.
   * modelVersion is always read from message.model (the API response) — never from params.model.
   */
  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    const params = this.buildParams(request);
    const message = await this.client.messages.create(params);

    // Extract text blocks
    const textBlocks = message.content.filter(
      (b): b is Anthropic.TextBlock => b.type === 'text'
    );

    // Extract tool_use blocks (map to ProviderToolCall)
    const toolUseBlocks = message.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );

    return {
      text: textBlocks.map((b) => b.text).join(''),
      modelVersion: message.model, // ← CRITICAL: from response, NOT echoed from params (Pitfall 3)
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      rawRequest: params, // params object — no apiKey field (T-03-01)
      rawResponse: message,
      stopReason: message.stop_reason as ProviderResponse['stopReason'],
      toolCalls:
        toolUseBlocks.length > 0
          ? toolUseBlocks.map((b) => ({ id: b.id, name: b.name, input: b.input }))
          : undefined,
    };
  }

  /**
   * Begin a streaming response from Anthropic.
   * Returns an AnthropicStreamSource implementing TidemarkStreamSource.
   * Full streaming consumer wiring (Plan 04) wraps this in TidemarkStream.
   */
  stream(request: ProviderRequest): TidemarkStreamSource {
    const params: Anthropic.MessageStreamParams = {
      model: this.model,
      max_tokens: request.maxTokens ?? 4096, // T-03-05: always bound
      messages: request.messages as Anthropic.MessageParam[],
      ...( request.system !== undefined ? { system: request.system } : {} ),
      ...( request.temperature !== undefined ? { temperature: request.temperature } : {} ),
      ...request.providerOptions,
    };
    const sdkStream = this.client.messages.stream(params);
    return new AnthropicStreamSource(sdkStream, params);
  }
}
