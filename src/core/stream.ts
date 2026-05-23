// src/core/stream.ts
// TidemarkStream<O> — the object returned by fn.stream(input)
//
// Presents three surfaces on the same object reference (D-09):
//   1. AsyncIterable<ProviderStreamChunk> — for await yields {type:'text',delta} chunks
//   2. finalOutput(): Promise<{ output: O; meta: TidemarkCallMeta }> — memoized; resolves when streaming is done
//   3. abort(): void — safe to call after completion (A4, D-17)

import type { TidemarkStreamSource, ProviderStreamChunk } from '../adapters/interface.js';
import type { TidemarkCallMeta } from './meta.js';
import type * as z4 from 'zod/v4/core';
import { parseWithRetry } from './retry.js';
import { buildCallMeta } from './meta.js';

export class TidemarkStream<O> implements AsyncIterable<ProviderStreamChunk> {
  private readonly _source: TidemarkStreamSource;
  private readonly _outputSchema: z4.$ZodType;
  private readonly _config: { maxRetries: number };
  private readonly _startMs: number;
  private _aborted = false;
  // Memoized promise — created on first call to finalOutput(), reused on all subsequent calls
  private _finalOutputPromise: Promise<{ output: O; meta: TidemarkCallMeta }> | null = null;

  constructor(
    source: TidemarkStreamSource,
    outputSchema: z4.$ZodType,
    config: { maxRetries: number },
    startMs: number
  ) {
    this._source = source;
    this._outputSchema = outputSchema;
    this._config = config;
    this._startMs = startMs;
  }

  [Symbol.asyncIterator](): AsyncIterator<ProviderStreamChunk> {
    return this._source[Symbol.asyncIterator]();
  }

  /**
   * Resolve the final typed output after streaming completes.
   *
   * Memoized: the first call creates the promise; all subsequent calls return the same
   * promise instance (same resolved value, no re-parsing).
   *
   * Returns { output: O, meta: TidemarkCallMeta } — .output is the schema-validated value,
   * .meta holds Tidemark metadata (tokens, cost, latency, etc.).
   */
  finalOutput(): Promise<{ output: O; meta: TidemarkCallMeta }> {
    if (this._finalOutputPromise !== null) {
      return this._finalOutputPromise;
    }
    this._finalOutputPromise = this._resolveFinalOutput();
    return this._finalOutputPromise;
  }

  private async _resolveFinalOutput(): Promise<{ output: O; meta: TidemarkCallMeta }> {
    const providerResponse = await this._source.finalResponse();
    // Single-shot parse — no conversation to continue in stream path.
    // Pass no onRetry so exhaustion throws TidemarkValidationError.
    const parsed = await parseWithRetry<O>(
      providerResponse.text,
      this._outputSchema,
      this._config.maxRetries
    );
    const meta = buildCallMeta(providerResponse, this._startMs);
    return { output: parsed, meta };
  }

  /**
   * Abort the stream.
   *
   * Safe to call after the stream has completed (A4 — no-op, never throws).
   * MUST be called in a finally block in every streaming context to prevent
   * socket leaks (D-17, RESEARCH Pitfall 2).
   */
  abort(): void {
    if (this._aborted) return; // already aborted — idempotent, no-op
    this._aborted = true;
    try {
      this._source.abort(); // calls MessageStream.abort() — safe post-completion
    } catch {
      // Swallow any error from aborting a completed stream (A4 — must not throw)
    }
  }
}
