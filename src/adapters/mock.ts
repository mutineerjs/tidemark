// src/adapters/mock.ts
// MockAdapter queue-based test double (D-18: required from Phase 1)

import type {
  ProviderAdapter,
  ProviderRequest,
  ProviderResponse,
  ProviderStreamChunk,
  TidemarkStreamSource,
} from './interface.js';

class MockStreamSource implements TidemarkStreamSource {
  private _aborted = false;

  constructor(
    private readonly text: string,
    private readonly meta: Pick<
      ProviderResponse,
      'modelVersion' | 'inputTokens' | 'outputTokens' | 'rawRequest'
    >
  ) {}

  async *[Symbol.asyncIterator](): AsyncIterator<ProviderStreamChunk> {
    for (const char of this.text) {
      if (this._aborted) return;
      yield { type: 'text', delta: char };
    }
  }

  async finalResponse(): Promise<ProviderResponse> {
    return {
      text: this.text,
      modelVersion: this.meta.modelVersion,
      inputTokens: this.meta.inputTokens,
      outputTokens: this.meta.outputTokens,
      rawRequest: this.meta.rawRequest,
      rawResponse: { mock: true },
      stopReason: 'end_turn',
    };
  }

  abort(): void {
    this._aborted = true;
  }
}

export class MockAdapter implements ProviderAdapter {
  private queue: Array<Partial<ProviderResponse>> = [];
  readonly calls: ProviderRequest[] = [];

  enqueue(response: Partial<ProviderResponse>): this {
    this.queue.push(response);
    return this; // fluent chaining for test setup
  }

  reset(): void {
    this.queue = [];
    this.calls.length = 0;
  }

  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    this.calls.push(request);
    const next = this.queue.shift();
    if (!next) throw new Error('MockAdapter: no more queued responses');
    return {
      text: next.text ?? '{"result": "mock"}',
      modelVersion: next.modelVersion ?? 'mock-model-v1',
      inputTokens: next.inputTokens ?? 10,
      outputTokens: next.outputTokens ?? 20,
      rawRequest: request,
      rawResponse: { mock: true },
      stopReason: next.stopReason ?? 'end_turn',
      toolCalls: next.toolCalls,
    };
  }

  stream(request: ProviderRequest): TidemarkStreamSource {
    this.calls.push(request);
    const queued = this.queue.shift();
    const text = queued?.text ?? '{"result": "mock"}';
    const modelVersion = queued?.modelVersion ?? 'mock-model-v1';
    const inputTokens = queued?.inputTokens ?? 10;
    const outputTokens = queued?.outputTokens ?? 20;
    return new MockStreamSource(text, { modelVersion, inputTokens, outputTokens, rawRequest: request });
  }
}
