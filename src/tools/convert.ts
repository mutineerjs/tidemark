// src/tools/convert.ts
// Tool schema conversion: Zod v4 schemas → Anthropic and OpenAI Tool formats
//
// A2 (confirmed in 01-01-SUMMARY): Use z4.toJSONSchema(schema) for tool input schemas.
// This is the Zod v4 built-in JSON Schema converter — produces a valid JSON Schema
// object with a 'properties' key for object schemas (confirmed adequate for Anthropic API).
//
// NOTE: z4.toJSONSchema() is NOT used for hashing — schema hashing uses the _zod.def
// tree walk (src/schema/describe.ts) per D-16, which is stable across refinements/transforms.

import * as z4 from 'zod/v4/core';
import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import type { ProviderToolDefinition } from '../adapters/interface.js';
import { getFieldDescription } from '../schema/describe.js';

/**
 * Convert Tidemark ProviderToolDefinition[] to Anthropic Tool[] for API calls.
 * The inputSchema is passed through directly as the Anthropic input_schema field.
 * Falls back to tool.name as description when no description is provided.
 */
export function buildAnthropicTools(
  tools: ProviderToolDefinition[]
): Anthropic.Tool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? tool.name,
    input_schema: tool.inputSchema as Anthropic.Tool['input_schema'],
  }));
}

/**
 * Convert Tidemark ProviderToolDefinition[] to OpenAI ChatCompletionFunctionTool[] for API calls.
 * Wraps each tool in the OpenAI function-tool format: { type: 'function', function: { ... } }.
 * Returns ChatCompletionFunctionTool[] (the concrete function-tool type, not the union)
 * so callers can access .function without type-narrowing.
 * Falls back to tool.name as description when no description is provided.
 * Uses inputSchema as the parameters field (JSON Schema passthrough — same as buildAnthropicTools).
 */
export function buildOpenAITools(
  tools: ProviderToolDefinition[]
): OpenAI.Chat.ChatCompletionFunctionTool[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description ?? tool.name,
      parameters: tool.inputSchema as Record<string, unknown>,
    },
  }));
}

/**
 * Convert user-facing Zod tool schemas to ProviderToolDefinition[].
 * Called in factory.ts before passing tools to the adapter.
 *
 * Uses z4.toJSONSchema(schema) (Zod v4 built-in) per A2 confirmation in 01-01-SUMMARY.
 * Falls back to empty object if schema doesn't support toJSONSchema (e.g. Zod v3 schemas
 * without the built-in — those users can call buildAnthropicTools directly with a
 * pre-built JSON Schema, or use zod-to-json-schema externally).
 */
export function convertToolSchemas(
  tools: Record<string, z4.$ZodType>
): ProviderToolDefinition[] {
  return Object.entries(tools).map(([name, schema]) => {
    // z4.toJSONSchema is the Zod v4 built-in (confirmed A2 in 01-01-SUMMARY)
    // For Zod v3 schemas without this, fall back to empty object
    const inputSchema = (z4 as unknown as { toJSONSchema?: (s: z4.$ZodType) => Record<string, unknown> }).toJSONSchema?.(schema) ?? {};
    return {
      name,
      description: getFieldDescription(schema),
      inputSchema,
    };
  });
}
