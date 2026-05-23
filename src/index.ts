// src/index.ts
// Public API surface — everything exported here is part of the versioned contract

// Core factory and types
export { createPromptFn } from './core/factory.js';
export type { PromptFn, PromptFnConfig, CallOptions, TidemarkResult, PromptInspectResult } from './core/factory.js';

// Metadata types, symbol, and runtime price configuration
export type { TidemarkCallMeta, TidemarkMeta } from './core/meta.js';
// SECURITY (T-04-05 / ASVS V5): rawRequest and rawResponse fields on TidemarkCallMeta
// may contain sensitive prompt content — e.g. user-supplied data passed to the LLM.
// Consumers should treat these fields as sensitive and apply appropriate handling
// (redaction, access controls, audit logging) before storing or transmitting them.
export { TIDEMARK_META, MODEL_PRICES, setModelPrice, registerModelPrices } from './core/meta.js';

// Stream — TidemarkStream type for fn.stream() consumers
export { TidemarkStream } from './core/stream.js';

// Errors
export {
  TidemarkValidationError,
  TidemarkToolLoopError,
  TidemarkInputValidationError,
} from './core/errors.js';

// Adapter interface (for third-party adapter authors)
export type {
  ProviderAdapter,
  ProviderRequest,
  ProviderResponse,
  ProviderStreamChunk,
  ProviderToolDefinition,
  ProviderToolCall,
  TidemarkStreamSource,
  ContentBlock,
} from './adapters/interface.js';

// Built-in adapters
export { MockAdapter } from './adapters/mock.js';
export { AnthropicAdapter } from './adapters/anthropic.js';
export { OpenAIAdapter } from './adapters/openai.js';

// Schema hashing utilities — exported for Phase 2 snapshot drift detection (Integration Point)
// hashZodSchema uses the _zod.def tree walk (D-16) — stable across transforms and refinements
export { hashZodSchema, hashPromptFn } from './schema/hash.js';
