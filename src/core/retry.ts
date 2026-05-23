// src/core/retry.ts
// Zod validation retry loop with structured error feedback (CORE-04)
// + agentic tool loop (CALL-02, runAgenticLoop)
//
// D-07: When validation fails and retries remain, onRetry is called with
//   (attempt, zodErrorString) — the caller is responsible for appending the
//   D-07 conversation turns (assistant badOutput + user 'Validation failed:\n'+error)
//   and re-calling the adapter, then returning the new response text.

import type * as z4 from 'zod/v4/core';
import { TidemarkValidationError, TidemarkToolLoopError } from './errors.js';
import type { ProviderAdapter, ProviderRequest, ProviderResponse } from '../adapters/interface.js';

// Strip markdown code fences (```json...``` or ```...```) that models sometimes wrap JSON in.
// Returns the original string if no fence is detected.
function extractJson(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:\w+)?\s*\n?([\s\S]*?)\n?```\s*$/);
  return match ? match[1].trim() : trimmed;
}

/**
 * Parse rawText as JSON, validate against schema, and retry up to maxRetries times.
 *
 * @param rawText     - Raw LLM output text (expected to be a JSON string)
 * @param schema      - Zod schema to validate parsed JSON against
 * @param maxRetries  - Maximum number of retries (0 = no retry, attempt once only)
 * @param onRetry     - Optional callback invoked on each failed attempt with
 *                      (attemptNumber, zodErrorString). Must return the new raw text
 *                      to try next. Not called on JSON parse failures (non-retryable).
 * @returns           - Parsed and validated output of type O
 * @throws TidemarkValidationError on JSON parse failure or after all retries exhausted
 */
export async function parseWithRetry<O>(
  rawText: string,
  schema: z4.$ZodType,
  maxRetries: number,
  onRetry?: (attempt: number, error: string) => Promise<string>
): Promise<O> {
  let lastError: z4.$ZodError | null = null;
  let text = rawText;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Step 1: Try JSON.parse — non-retryable, throw immediately.
    // extractJson strips markdown code fences that models sometimes add around JSON output.
    const jsonText = extractJson(text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      throw new TidemarkValidationError('LLM output is not valid JSON', {
        attempts: attempt + 1,
        lastOutput: text,
        zodError: null,
      });
    }

    // Step 2: Zod safeParse — dispatch for v3/v4 compat
    // Both Zod v3 and v4 expose .safeParse() on schema objects
    const result = (schema as unknown as {
      safeParse(v: unknown): { success: true; data: O } | { success: false; error: z4.$ZodError };
    }).safeParse(parsed);

    if (result.success) {
      return result.data;
    }

    // Validation failed — record error
    lastError = result.error;

    // Step 3: If retries remain and onRetry provided, get next text to try
    if (attempt < maxRetries && onRetry) {
      // D-07: pass the attempt number (1-indexed) and the Zod error string
      // The caller's onRetry callback appends conversation turns and re-calls adapter
      text = await onRetry(attempt + 1, result.error.toString());
    }
  }

  // All attempts exhausted — throw with full diagnostics
  throw new TidemarkValidationError('Zod validation failed after retries', {
    attempts: maxRetries + 1,
    lastOutput: rawText,
    zodError: lastError,
  });
}

/**
 * Agentic tool-use loop (CALL-02, D-12/D-13).
 *
 * Drives a multi-turn conversation with the adapter, handling tool_use stop reasons
 * by calling the provided handlers and appending tool_result blocks back to the
 * conversation. Terminates when the adapter returns end_turn (or other non-tool reason)
 * or when maxRounds is exceeded (throws TidemarkToolLoopError, T-04-04).
 *
 * D-07/Pitfall 4: The assistant turn appended on each tool round carries the raw
 * response content from rawResponse.content. This is critical for Anthropic's API —
 * the assistant turn must preserve the original content block structure.
 *
 * A5: tool_result content is plain string form: content: String(result).
 * If the API requires the array form, use: content: [{ type: 'text', text: String(result) }]
 *
 * @param adapter   - ProviderAdapter to call for each round
 * @param request   - Base request (messages, system, tools, etc.) — messages is replaced each round
 * @param handlers  - Map of tool name → async handler function
 *                    Handlers receive Zod-parsed args (validated in factory.ts before this call)
 * @param maxRounds - Maximum number of tool rounds before throwing TidemarkToolLoopError (default 10)
 * @returns         - Final ProviderResponse with stopReason !== 'tool_use'
 * @throws          - Error if a handler is missing for a tool name
 * @throws          - TidemarkToolLoopError if maxRounds is exceeded
 */
export async function runAgenticLoop(
  adapter: ProviderAdapter,
  request: ProviderRequest,
  handlers: Record<string, (args: unknown) => Promise<unknown>>,
  maxRounds = 10
): Promise<ProviderResponse> {
  // Work with a mutable copy of the messages array
  let messages = [...request.messages];

  for (let round = 0; round < maxRounds; round++) {
    const response = await adapter.generate({ ...request, messages });

    // If not a tool_use stop reason, we're done
    if (response.stopReason !== 'tool_use' || !response.toolCalls?.length) {
      return response;
    }

    // Append assistant turn with raw content blocks from the response.
    // D-07/Pitfall 4: must use the original content block form (not a plain text string)
    // because the response may contain tool_use content blocks alongside text blocks.
    const rawContent = (response.rawResponse as { content?: unknown[] })?.content;
    messages = [
      ...messages,
      {
        role: 'assistant' as const,
        // If rawResponse has structured content blocks, use them.
        // Fall back to a plain text block with response.text for mock/test adapters
        // that don't populate rawResponse.content.
        content: rawContent ?? [{ type: 'text', text: response.text }],
      },
    ];

    // Execute tool handlers and collect tool_result blocks
    const toolResults = await Promise.all(
      response.toolCalls.map(async (tc) => {
        const handler = handlers[tc.name];
        if (!handler) {
          throw new Error(`No handler for tool: ${tc.name}`);
        }
        // Note: args validation (D-14) is done in factory.ts before runAgenticLoop is called.
        // The handler here receives the pre-validated parsed args from the tool call input.
        const result = await handler(tc.input);
        // A5: tool_result content as plain string (per Anthropic SDK examples)
        return {
          type: 'tool_result' as const,
          tool_use_id: tc.id,
          content: String(result),
        };
      })
    );

    // Append user turn with tool_result blocks
    messages = [
      ...messages,
      {
        role: 'user' as const,
        content: toolResults as unknown as string,
      },
    ];
  }

  throw new TidemarkToolLoopError(`Exceeded maxToolRounds (${maxRounds})`);
}
