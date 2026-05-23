# Tidemark

Snapshot testing for LLM features: detect prompt/model/schema drift before production does.

Define your prompts as typed `promptFn` functions with Zod-validated output, capture behaviour across
test cases as committed JSON snapshots, and get automatic drift detection with field-level attribution
when the prompt, model, or schema changes underneath them. Ships as a Vitest matcher — no new test
runner, no SaaS, no separate prompt store.

## Install

```bash
npm install tidemark zod vitest
```

## Quick Start

```typescript
// Define the function
import { createPromptFn, AnthropicAdapter } from 'tidemark';
import * as z from 'zod';

const adapter = new AnthropicAdapter('claude-sonnet-4-5-20250929', {
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Never commit API keys — use environment variables or a secrets manager.

export const classifyFn = createPromptFn({
  name: 'classify',
  prompt: (i) => `Classify this support message: ${i.text}`,
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({
    category: z.enum(['billing', 'tech', 'general']),
    confidence: z.number(),
  }),
  adapter,
});

// Set up the matcher in vitest.setup.ts
import { expect } from 'vitest';
import { tidemarkMatchers } from 'tidemark/vitest';
expect.extend(tidemarkMatchers);

// Write your snapshot test
import { expectPromptFn } from 'tidemark/vitest';

it('classifyFn matches snapshot', async () => {
  await expectPromptFn(classifyFn).toMatchSnapshot([
    { name: 'billing', input: { text: 'charged twice' } },
    { name: 'general', input: { text: 'update my address' } },
  ]);
});
```

First run writes `__snapshots__/classify.snap.json`. Subsequent runs fail if prompt,
schema, or model changes — with attribution telling you exactly which hash changed.

## How It Works

**`promptFn` as a typed code artifact.** Define prompts once as `createPromptFn()` — Zod validates
input and output, `.describe()` annotations on schema fields auto-inject into the system message,
and the function is a plain async function callable anywhere in your codebase.

**Snapshots committed to git.** `.snap.json` files live next to your test file in `__snapshots__/`,
use deterministic key order, and are human-readable JSON. They show up in PR diffs like any other
code change — your team reviews LLM behaviour changes the same way they review code changes.

**Drift detection with field attribution.** Tidemark hashes the prompt text, the Zod schema
`_def` tree, and the resolved model version from the API response. On a snapshot mismatch, the
failure message tells you which of the three changed — not a blob diff of raw output. For string
fields, an LLM-as-judge equivalence check distinguishes "semantically the same" from "actually
regressed" before reporting a failure.

## API Reference (v0.1)

**`createPromptFn(config)`** — Define a typed prompt function.

| Config field | Type | Description |
|---|---|---|
| `name` | `string` | Stable identifier used as the snapshot filename |
| `prompt` | `(input) => string` | Function that builds the prompt string from validated input |
| `inputSchema` | `z.ZodType` | Zod schema for validating the input object |
| `outputSchema` | `z.ZodType` | Zod schema for validating and parsing LLM output |
| `adapter` | `ProviderAdapter` | Provider adapter (`AnthropicAdapter`, `OpenAIAdapter`) |
| `temperature?` | `number` | Sampling temperature (optional) |
| `maxRetries?` | `number` | Retry attempts on Zod validation failure (default: 2) |
| `tools?` | `Record<string, z.ZodType>` | Tool definitions for function calling (optional) |

**`fn(input, options?)`** — Call the function, returns `Promise<TidemarkResult<Output>>` with shape `{ output, meta, messages }`.

Options: `{ handlers?: Record<string, Handler>, messages?: ConversationMessage[] }`

**`fn.stream(input, options?)`** — Returns a `TidemarkStream` with `for await` text chunks and `.finalOutput()`.

**`expectPromptFn(fn).toMatchSnapshot(cases)`** — Snapshot matcher, from `'tidemark/vitest'`.

**`mockPromptFn(returnValue)`** — Test double, from `'tidemark/testing'`. Returns a `PromptFn` with zero-value cost/latency metadata.

**`new AnthropicAdapter(model, { apiKey? })`** / **`new OpenAIAdapter(model, { apiKey? })`** — Built-in provider adapters.

**`TidemarkCallMeta` fields:** `inputTokens`, `outputTokens`, `estimatedCostUsd`, `responseTimeMs`, `rawRequest`, `rawResponse`.

## Mocking in Unit Tests

Use `mockPromptFn` from `'tidemark/testing'` to stub a `promptFn` in unit tests — no real API calls.

```typescript
import { mockPromptFn } from 'tidemark/testing';

const classify = mockPromptFn({ category: 'billing', confidence: 0.95 });
const result = await classify({ text: 'charged twice' });

// result.category === 'billing'
// result.confidence === 0.95
// result.inputTokens === 0, result.estimatedCostUsd === 0
```

Returns your `returnValue` with zero-value cost/latency metadata. The `.stream()` method is also
stubbed — code that calls `fn.stream()` will not throw.

## Multi-Turn Conversations

Pass `result.messages` from one call to the next to maintain conversation context.

```typescript
// First turn
const r1 = await fn({ text: 'hello' });

// Second turn — r1.messages is the full first-turn conversation
const r2 = await fn({ text: 'follow up' }, { messages: r1.messages });

// Third turn — r2.messages includes all three turns
const r3 = await fn({ text: 'one more thing' }, { messages: r2.messages });
```

`messages` is an in-memory array — not persisted across sessions. Pass `result.messages` to the
next call to maintain context within a session.

## Benchmark

See [BENCHMARK.md](./BENCHMARK.md) for captured output demonstrating prompt hash drift, schema hash
drift, and model version drift detection — all running without a real API key via `MockAdapter`.

## License

MIT
