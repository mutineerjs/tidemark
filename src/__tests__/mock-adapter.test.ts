// src/__tests__/mock-adapter.test.ts
// Direct unit tests for MockAdapter — falsy-but-not-nullish value handling.
// These tests kill nullishToOr mutations that survive when tests only use truthy defaults.

import { describe, it, expect } from 'vitest';
import type { ProviderResponse } from '../adapters/interface.js';
import { MockAdapter } from '../adapters/mock.js';

describe('MockAdapter.generate() — falsy-but-not-nullish values', () => {
  it('uses empty string text when enqueued (not the default)', async () => {
    const adapter = new MockAdapter();
    adapter.enqueue({ text: '' });
    const response = await adapter.generate({ messages: [{ role: 'user', content: 'test' }] });
    expect(response.text).toBe('');
  });

  it('uses empty string modelVersion when enqueued (not the default)', async () => {
    const adapter = new MockAdapter();
    adapter.enqueue({ modelVersion: '' });
    const response = await adapter.generate({ messages: [{ role: 'user', content: 'test' }] });
    expect(response.modelVersion).toBe('');
  });

  it('uses 0 inputTokens when enqueued (not the default of 10)', async () => {
    const adapter = new MockAdapter();
    adapter.enqueue({ inputTokens: 0 });
    const response = await adapter.generate({ messages: [{ role: 'user', content: 'test' }] });
    expect(response.inputTokens).toBe(0);
  });

  it('uses 0 outputTokens when enqueued (not the default of 20)', async () => {
    const adapter = new MockAdapter();
    adapter.enqueue({ outputTokens: 0 });
    const response = await adapter.generate({ messages: [{ role: 'user', content: 'test' }] });
    expect(response.outputTokens).toBe(0);
  });

  it('uses empty string stopReason when enqueued (not the default)', async () => {
    const adapter = new MockAdapter();
    // Cast required: '' is not a valid stopReason in production, but valid for mutation testing
    adapter.enqueue({ stopReason: '' as unknown as ProviderResponse['stopReason'] });
    const response = await adapter.generate({ messages: [{ role: 'user', content: 'test' }] });
    expect(response.stopReason).toBe('');
  });
});

describe('MockAdapter.stream() — falsy-but-not-nullish values', () => {
  it('uses empty string text when enqueued (not the default)', async () => {
    const adapter = new MockAdapter();
    adapter.enqueue({ text: '' });
    const source = adapter.stream({ messages: [{ role: 'user', content: 'test' }] });
    const response = await source.finalResponse();
    expect(response.text).toBe('');
  });

  it('uses empty string modelVersion when enqueued (not the default)', async () => {
    const adapter = new MockAdapter();
    adapter.enqueue({ modelVersion: '' });
    const source = adapter.stream({ messages: [{ role: 'user', content: 'test' }] });
    const response = await source.finalResponse();
    expect(response.modelVersion).toBe('');
  });

  it('uses 0 inputTokens when enqueued (not the default of 10)', async () => {
    const adapter = new MockAdapter();
    adapter.enqueue({ inputTokens: 0 });
    const source = adapter.stream({ messages: [{ role: 'user', content: 'test' }] });
    const response = await source.finalResponse();
    expect(response.inputTokens).toBe(0);
  });

  it('uses 0 outputTokens when enqueued (not the default of 20)', async () => {
    const adapter = new MockAdapter();
    adapter.enqueue({ outputTokens: 0 });
    const source = adapter.stream({ messages: [{ role: 'user', content: 'test' }] });
    const response = await source.finalResponse();
    expect(response.outputTokens).toBe(0);
  });
});
