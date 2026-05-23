// src/core/factory.ts
// createPromptFn — non-streaming call engine with describe injection + retry loop (Plan 02)
// Plan 04: fn.stream() wired to TidemarkStream via adapter.stream()

import type * as z4 from 'zod/v4/core';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { ProviderAdapter } from '../adapters/interface.js';
import type { TidemarkCallMeta, TidemarkMeta } from './meta.js';
import { TIDEMARK_META, buildCallMeta } from './meta.js';
import { TidemarkInputValidationError } from './errors.js';
import { buildSystemMessage } from '../schema/describe.js';
import { parseWithRetry, runAgenticLoop } from './retry.js';
import { TidemarkStream } from './stream.js';
import { convertToolSchemas } from '../tools/convert.js';

export interface PromptFnConfig<I extends z4.$ZodType, O extends z4.$ZodType> {
  name: string;
  prompt: (input: z4.output<I>) => string;
  inputSchema: I;
  outputSchema: O;
  adapter: ProviderAdapter;
  temperature?: number;
  maxRetries?: number; // default 2
  maxToolRounds?: number; // default 10
  tools?: Record<string, z4.$ZodType>;
}

// TidemarkResult: the structured return value from a promptFn call.
// User schema output is under .output to guarantee zero namespace collision with
// Tidemark's own metadata fields (inputTokens, modelVersion, etc.).
export interface TidemarkResult<T> {
  output: T;
  meta: TidemarkCallMeta;
  messages: ConversationMessage[];
}

// PromptInspectResult: dry-run view of what would be sent to the LLM.
// No adapter call is made — useful for debugging, logging, and test assertions.
export interface PromptInspectResult {
  system: string;
  userMessage: string;
  messages: ConversationMessage[];
}

// ConversationMessage: a single turn in a multi-turn conversation (D-01, D-02, CALL-03).
// SECURITY NOTE (T-03-03-01): messages array content is caller-supplied; Tidemark does not
// sanitize message content. Callers are responsible for validating message content before
// passing to promptFn.
export type ConversationMessage = { role: 'user' | 'assistant'; content: string };

export interface CallOptions<O extends z4.$ZodType> {
  handlers?: Record<string, (args: unknown) => Promise<unknown>>;
  // CALL-03 (D-01): prior-turn messages for multi-turn conversation state.
  // Pass result.messages from the previous call to continue the conversation.
  messages?: ConversationMessage[];
}

// CORE-05: ~standard is a type-only property — zero runtime cost.
// It is NOT assigned any runtime value. The 'in' operator will return false at runtime.
// This satisfies @standard-schema/spec type-level compatibility without any bundle overhead.
export type PromptFn<I extends z4.$ZodType, O extends z4.$ZodType> = {
  // CALL-03 (D-02): result.messages holds the full updated conversation array.
  // Use result.messages as the messages option on the next call to continue the conversation.
  (input: z4.output<I>, options?: CallOptions<O>): Promise<TidemarkResult<z4.output<O>>>;
  stream(input: z4.output<I>, options?: CallOptions<O>): TidemarkStream<z4.output<O>>;
  inspect(input: z4.output<I>, options?: Pick<CallOptions<O>, 'messages'>): PromptInspectResult;
  readonly [TIDEMARK_META]: TidemarkMeta<I, O>;
  // CORE-05: @standard-schema/spec type-only surface — no runtime value assigned
  readonly ['~standard']?: StandardSchemaV1.Props<z4.input<I>, z4.output<O>>;
};

export function createPromptFn<I extends z4.$ZodType, O extends z4.$ZodType>(
  config: PromptFnConfig<I, O>
): PromptFn<I, O> {
  const meta: TidemarkMeta<I, O> = {
    name: config.name,
    prompt: config.prompt,
    inputSchema: config.inputSchema,
    outputSchema: config.outputSchema,
    adapter: config.adapter,
    temperature: config.temperature,
    tools: config.tools,
  };

  const fn = async (
    input: z4.output<I>,
    _options?: CallOptions<O>
  ): Promise<TidemarkResult<z4.output<O>>> => {
    // Step 1: Validate input (T-01-01 — ASVS V5 input validation before any adapter call)
    const inputResult = (config.inputSchema as unknown as {
      safeParse(v: unknown): { success: boolean; data: z4.output<I>; error?: z4.$ZodError };
    }).safeParse(input);
    if (!inputResult.success) {
      throw new TidemarkInputValidationError(
        'Input validation failed',
        inputResult.error!
      );
    }
    const validatedInput = inputResult.data;

    // Step 2: Build system message with Zod .describe() injection (CORE-03, D-06)
    const promptText = config.prompt(validatedInput);
    const systemMessage = buildSystemMessage(promptText, config.outputSchema);

    // Step 3: Start timing and make initial adapter call
    const startMs = performance.now();

    // Build initial messages — prepend prior conversation turns then the current user turn (CALL-03, D-02)
    const priorMessages: ConversationMessage[] = _options?.messages ?? [];
    const messages: Array<{
      role: 'user' | 'assistant';
      content: string | unknown[];
    }> = [
      ...priorMessages,
      { role: 'user', content: promptText },
    ];

    // Build the base request (with tools if configured)
    const baseRequest: Parameters<typeof config.adapter.generate>[0] = {
      messages: messages as Parameters<typeof config.adapter.generate>[0]['messages'],
      system: systemMessage,
      temperature: config.temperature,
      ...(config.tools ? { tools: convertToolSchemas(config.tools) } : {}),
    };

    // Step 3b: Agentic tool loop (CALL-02) — only engaged when tools are configured (D-12/D-13)
    let providerResponse: Awaited<ReturnType<typeof config.adapter.generate>>;

    if (config.tools && Object.keys(config.tools).length > 0) {
      // Build handler wrappers that Zod-validate args before calling the user handler (D-14)
      const toolSchemas = config.tools;
      const handlers = _options?.handlers ?? {};
      const validatedHandlers: Record<string, (args: unknown) => Promise<unknown>> = {};

      for (const [toolName, toolSchema] of Object.entries(toolSchemas)) {
        validatedHandlers[toolName] = async (rawArgs: unknown) => {
          // D-14: Validate tool input against Zod schema before calling handler
          const parseResult = (toolSchema as unknown as {
            safeParse(v: unknown): { success: boolean; data: unknown; error?: z4.$ZodError };
          }).safeParse(rawArgs);

          if (!parseResult.success) {
            throw new Error(
              `Tool "${toolName}" received invalid arguments: ${parseResult.error?.toString()}`
            );
          }

          // The handler may not be provided — check and throw naming the tool
          const userHandler = handlers[toolName];
          if (!userHandler) {
            throw new Error(`No handler for tool: ${toolName}`);
          }

          // Pass Zod-parsed args (not raw) to the user handler (D-14)
          return userHandler(parseResult.data);
        };
      }

      providerResponse = await runAgenticLoop(
        config.adapter,
        baseRequest,
        validatedHandlers,
        config.maxToolRounds ?? 10
      );
    } else {
      // Non-tool path: direct adapter.generate() call (unchanged from Plan 02)
      providerResponse = await config.adapter.generate(baseRequest);
    }

    // Step 4: Parse + retry loop (CORE-04, D-07)
    // onRetry: appends assistant bad-output turn + user validation-error turn, re-calls adapter
    const maxRetries = config.maxRetries ?? 2;

    // Track the last bad output text so D-07 assistant turn is always correct.
    // parseWithRetry passes us the text that failed — we track it via closure here
    // for the D-07 content-block construction.
    let lastBadText = providerResponse.text;

    // For D-07 retry conversation, start from the initial messages state.
    // The retry path does NOT continue the agentic loop — it re-calls adapter.generate()
    // directly with the extended conversation (assistant bad output + validation error).
    const retryMessages: Array<{
      role: 'user' | 'assistant';
      content: string | unknown[];
    }> = [...messages];

    const result = await parseWithRetry<z4.output<O>>(
      providerResponse.text,
      config.outputSchema,
      maxRetries,
      async (_attempt, zodErrorString) => {
        // D-07: append {role:'assistant', content: [{type:'text', text: badOutput}]}
        // Use content-block form for the assistant turn (RESEARCH Pitfall 4 — prevents
        // conversation corruption when the bad output itself contains role/content fields)
        retryMessages.push({
          role: 'assistant',
          content: [{ type: 'text', text: lastBadText }],
        });

        // Append user turn with validation error (D-07)
        retryMessages.push({
          role: 'user',
          content: `Validation failed:\n${zodErrorString}`,
        });

        // Re-call adapter with the extended conversation (no tools on retry — target JSON output)
        const retryResponse = await config.adapter.generate({
          messages: retryMessages as Parameters<typeof config.adapter.generate>[0]['messages'],
          system: systemMessage,
          temperature: config.temperature,
        });

        // Update lastBadText to be this retry's response (for the next retry if it also fails)
        lastBadText = retryResponse.text;

        return retryResponse.text;
      }
    );

    // Step 5: Build structured result (CALL-04, PROV-04).
    // output is isolated under .output so user schema fields never collide with meta.
    const meta = buildCallMeta(providerResponse, startMs);

    // CALL-03 (D-02): build the full updated conversation array.
    // updatedMessages = priorMessages + current user turn + assistant response.
    const updatedMessages: ConversationMessage[] = [
      ...priorMessages,
      { role: 'user' as const, content: promptText },
      { role: 'assistant' as const, content: providerResponse.text },
    ];
    return { output: result as z4.output<O>, meta, messages: updatedMessages };
  };

  // fn.inspect: dry-run — returns what would be sent to the LLM without making an adapter call.
  const inspectImpl = (
    input: z4.output<I>,
    _options?: Pick<CallOptions<O>, 'messages'>
  ): PromptInspectResult => {
    const inputResult = (config.inputSchema as unknown as {
      safeParse(v: unknown): { success: boolean; data: z4.output<I>; error?: z4.$ZodError };
    }).safeParse(input);
    if (!inputResult.success) {
      throw new TidemarkInputValidationError('Input validation failed', inputResult.error!);
    }
    const validatedInput = inputResult.data;
    const userMessage = config.prompt(validatedInput);
    const system = buildSystemMessage(userMessage, config.outputSchema);
    const priorMessages: ConversationMessage[] = _options?.messages ?? [];
    const messages: ConversationMessage[] = [
      ...priorMessages,
      { role: 'user', content: userMessage },
    ];
    return { system, userMessage, messages };
  };

  // fn.stream: real streaming implementation (Plan 04)
  // Returns a TidemarkStream wrapping the adapter's stream source.
  // Input validation is performed before opening the stream to fail fast (T-04-01).
  const streamImpl = (
    input: z4.output<I>,
    _options?: CallOptions<O>
  ): TidemarkStream<z4.output<O>> => {
    // Step 1: Validate input before opening the stream (fail fast — no socket opened on bad input)
    const inputResult = (config.inputSchema as unknown as {
      safeParse(v: unknown): { success: boolean; data: z4.output<I>; error?: z4.$ZodError };
    }).safeParse(input);
    if (!inputResult.success) {
      throw new TidemarkInputValidationError(
        'Input validation failed',
        inputResult.error!
      );
    }
    const validatedInput = inputResult.data;

    // Step 2: Build system message (same as the non-streaming path)
    const promptText = config.prompt(validatedInput);
    const systemMessage = buildSystemMessage(promptText, config.outputSchema);

    // Step 3: Capture start time before opening the stream
    const startMs = performance.now();

    // Step 4: Open the stream via the adapter
    // CALL-03: prepend prior messages for API consistency (stream does not attach result.messages)
    const priorMessages: ConversationMessage[] = _options?.messages ?? [];
    const source = config.adapter.stream({
      messages: [...priorMessages, { role: 'user', content: promptText }],
      system: systemMessage,
      temperature: config.temperature,
    });

    // Step 5: Wrap in TidemarkStream and return
    return new TidemarkStream<z4.output<O>>(
      source,
      config.outputSchema,
      { maxRetries: config.maxRetries ?? 2 },
      startMs
    );
  };

  Object.defineProperty(fn, 'inspect', {
    value: inspectImpl,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  Object.defineProperty(fn, 'stream', {
    value: streamImpl,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  Object.defineProperty(fn, TIDEMARK_META, {
    value: meta,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  // CORE-05: ~standard is NOT defined at runtime — type-only surface only.
  // Do NOT add any Object.defineProperty for '~standard' here.

  return fn as unknown as PromptFn<I, O>;
}
