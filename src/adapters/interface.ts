// src/adapters/interface.ts
// CRITICAL (D-15): This file MUST be implemented before src/adapters/anthropic.ts.
// The interface is the extension point for Phase 3 OpenAI adapter.

// ContentBlock: opaque type for provider-specific content block payloads.
// Kept as unknown so adapters can pass through their SDK content block types
// without requiring consumers to import provider-specific types.
export type ContentBlock = unknown;

export interface ProviderToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>; // JSON Schema object
}

export interface ProviderToolCall {
  id: string;
  name: string;
  input: unknown; // validated by Zod in the engine, not here
}

export interface ProviderRequest {
  messages: Array<{
    role: 'user' | 'assistant';
    content: string | ContentBlock[];
  }>;
  system?: string;
  tools?: ProviderToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  providerOptions?: Record<string, unknown>;
}

export interface ProviderResponse {
  text: string; // raw LLM text output (may be JSON string)
  modelVersion: string; // ALWAYS from response, never echoed from request
  inputTokens: number;
  outputTokens: number;
  rawRequest: unknown;
  rawResponse: unknown;
  stopReason: 'end_turn' | 'tool_use' | 'stop_sequence' | 'max_tokens';
  toolCalls?: ProviderToolCall[];
}

export interface ProviderStreamChunk {
  type: 'text';
  delta: string;
}

// The raw source that adapter.stream() returns — engine wraps this in TidemarkStream
export interface TidemarkStreamSource {
  [Symbol.asyncIterator](): AsyncIterator<ProviderStreamChunk>;
  finalResponse(): Promise<ProviderResponse>; // accumulates text + usage + model
  abort(): void;
}

export interface ProviderAdapter {
  generate(request: ProviderRequest): Promise<ProviderResponse>;
  stream(request: ProviderRequest): TidemarkStreamSource;
}
