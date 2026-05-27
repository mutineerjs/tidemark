// src/jest/__tests__/matcher.test.ts
// Jest-syntax integration test per D-12 — uses @jest/globals explicit imports.
// This file is NOT run by `npm test` (vitest run) — it is excluded via vitest.config.ts.
// It exists so that a Jest-equipped consumer or CI lane can validate the adapter
// under the real Jest 29+ runtime, and documents the intended Jest usage in
// executable form.
//
// EXCLUDED FROM VITEST: src/jest/__tests__/matcher.test.ts in vitest.config.ts

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import * as z from 'zod';

import { createPromptFn } from '../../core/factory.js';
import { MockAdapter } from '../../adapters/mock.js';

// ---------------------------------------------------------------------------
// Module mocks — declared at module level before imports (Jest hoisting)
// ---------------------------------------------------------------------------
jest.mock('node:fs/promises');
jest.mock('node:fs');

// ---------------------------------------------------------------------------
// Import Jest adapter under test
// Static import with jest.resetModules() in beforeEach if needed
// ---------------------------------------------------------------------------
import { expectPromptFn, tidemarkMatchers } from '../index.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let adapter: MockAdapter;

beforeEach(async () => {
  adapter = new MockAdapter();
  jest.clearAllMocks();

  // Default: file does not exist (first run)
  const fs = await import('node:fs');
  jest.mocked(fs.existsSync).mockReturnValue(false);

  const fsp = await import('node:fs/promises');
  jest.mocked(fsp.mkdir).mockResolvedValue(undefined);
  jest.mocked(fsp.writeFile).mockResolvedValue(undefined);
  jest.mocked(fsp.readFile).mockRejectedValue(new Error('not found'));
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// JestMatcherState stub — mirrors JestMatcherState from src/jest/index.ts
// Uses _updateSnapshot (not snapshotUpdateState) — D-01, D-03
// ---------------------------------------------------------------------------

interface StubMatcherState {
  testPath?: string;
  snapshotState?: { _updateSnapshot: 'all' | 'new' | 'none' };
}

async function callMatcher(
  state: StubMatcherState,
  received: unknown,
  cases: Array<{ name: string; input: unknown }>,
  opts?: { threshold?: number; sample?: number; every?: number }
) {
  const matcherFn = tidemarkMatchers.toMatchTidemarkSnapshot;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return matcherFn.call(state as any, received, cases, opts);
}

// ---------------------------------------------------------------------------
// expectPromptFn basic
// ---------------------------------------------------------------------------

describe('expectPromptFn (Jest adapter — @jest/globals)', () => {
  it('returns an object with a toMatchSnapshot method', () => {
    const fn = createPromptFn({
      name: 'classify',
      prompt: () => 'Classify this.',
      inputSchema: z.object({}) as unknown as Parameters<typeof createPromptFn>[0]['inputSchema'],
      outputSchema: z.object({ category: z.string() }) as unknown as Parameters<typeof createPromptFn>[0]['outputSchema'],
      adapter,
    });
    const wrapper = expectPromptFn(fn as Parameters<typeof expectPromptFn>[0]);
    expect(typeof wrapper.toMatchSnapshot).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// First run — _updateSnapshot: 'new', existsSync false
// ---------------------------------------------------------------------------

describe('toMatchTidemarkSnapshot — first run (_updateSnapshot: "new")', () => {
  it('pass: true, writeFile called, path contains __snapshots__ and <name>.snap.json', async () => {
    adapter.enqueue({ text: '{"category":"news"}', modelVersion: 'test-model-v1' });

    const fn = createPromptFn({
      name: 'my-classifier',
      prompt: () => 'Classify.',
      inputSchema: z.object({}) as unknown as Parameters<typeof createPromptFn>[0]['inputSchema'],
      outputSchema: z.object({ category: z.string() }) as unknown as Parameters<typeof createPromptFn>[0]['outputSchema'],
      adapter,
    });

    const result = await callMatcher(
      {
        testPath: '/home/user/project/src/my.test.ts',
        snapshotState: { _updateSnapshot: 'new' },
      },
      fn,
      [{ name: 'news-case', input: {} }]
    );

    expect(result.pass).toBe(true);

    const fsp = await import('node:fs/promises');
    expect(fsp.writeFile).toHaveBeenCalled();

    const writeCall = jest.mocked(fsp.writeFile).mock.calls[0];
    const writtenPath = writeCall[0] as string;
    expect(writtenPath).toContain('__snapshots__');
    expect(writtenPath).toContain('my-classifier.snap.json');
  });

  it('written $meta has promptHash/schemaHash/modelHash', async () => {
    adapter.enqueue({ text: '{"category":"news"}', modelVersion: 'test-model-v1' });

    const fn = createPromptFn({
      name: 'hash-test',
      prompt: () => 'Classify.',
      inputSchema: z.object({}) as unknown as Parameters<typeof createPromptFn>[0]['inputSchema'],
      outputSchema: z.object({ category: z.string() }) as unknown as Parameters<typeof createPromptFn>[0]['outputSchema'],
      adapter,
    });

    await callMatcher(
      {
        testPath: '/abs/test.test.ts',
        snapshotState: { _updateSnapshot: 'new' },
      },
      fn,
      [{ name: 'case-1', input: {} }]
    );

    const fsp = await import('node:fs/promises');
    const writeCall = jest.mocked(fsp.writeFile).mock.calls[0];
    const writtenContent = writeCall[1] as string;
    const parsed = JSON.parse(writtenContent);

    expect(parsed.$meta).toBeDefined();
    expect(typeof parsed.$meta.promptHash).toBe('string');
    expect(typeof parsed.$meta.schemaHash).toBe('string');
    expect(typeof parsed.$meta.modelHash).toBe('string');
  });

  it('string fields become { match: "baseline" }, adapter.calls.length === cases.length', async () => {
    adapter
      .enqueue({ text: '{"category":"news"}', modelVersion: 'test-model-v1' })
      .enqueue({ text: '{"category":"sports"}', modelVersion: 'test-model-v1' });

    const fn = createPromptFn({
      name: 'baseline-test',
      prompt: () => 'Classify.',
      inputSchema: z.object({}) as unknown as Parameters<typeof createPromptFn>[0]['inputSchema'],
      outputSchema: z.object({ category: z.string() }) as unknown as Parameters<typeof createPromptFn>[0]['outputSchema'],
      adapter,
    });

    const cases = [
      { name: 'news-case', input: {} },
      { name: 'sports-case', input: {} },
    ];

    await callMatcher(
      {
        testPath: '/abs/test.test.ts',
        snapshotState: { _updateSnapshot: 'new' },
      },
      fn,
      cases
    );

    const fsp = await import('node:fs/promises');
    const writeCall = jest.mocked(fsp.writeFile).mock.calls[0];
    const writtenContent = writeCall[1] as string;
    const parsed = JSON.parse(writtenContent);

    expect(parsed['news-case'].category).toEqual({ match: 'baseline' });
    expect(adapter.calls).toHaveLength(cases.length);
  });
});

// ---------------------------------------------------------------------------
// CI mode — _updateSnapshot: 'none'
// ---------------------------------------------------------------------------

describe('toMatchTidemarkSnapshot — CI mode (_updateSnapshot: "none")', () => {
  it('no snapshot: pass: false, message contains "baseline", zero adapter calls', async () => {
    const fn = createPromptFn({
      name: 'ci-test',
      prompt: () => 'Classify.',
      inputSchema: z.object({}) as unknown as Parameters<typeof createPromptFn>[0]['inputSchema'],
      outputSchema: z.object({ category: z.string() }) as unknown as Parameters<typeof createPromptFn>[0]['outputSchema'],
      adapter,
    });

    const result = await callMatcher(
      {
        testPath: '/abs/test.test.ts',
        snapshotState: { _updateSnapshot: 'none' },
      },
      fn,
      [{ name: 'case-1', input: {} }]
    );

    expect(result.pass).toBe(false);
    expect(result.message()).toContain('baseline');
    expect(adapter.calls).toHaveLength(0);
  });

  it('snapshot exists: pass: true, zero adapter calls (D-11 CI shortcut)', async () => {
    const fs = await import('node:fs');
    const fsp = await import('node:fs/promises');

    const existingSnapshot = {
      $meta: {
        promptHash: 'some-prompt-hash',
        schemaHash: 'some-schema-hash',
        modelHash: 'some-model-hash',
        tidemarkVersion: '0.1.0',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      'case-1': { category: { match: 'baseline' } },
    };

    jest.mocked(fs.existsSync).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (jest.mocked(fsp.readFile) as any).mockResolvedValue(JSON.stringify(existingSnapshot));

    const fn = createPromptFn({
      name: 'ci-offline-test',
      prompt: () => 'Classify.',
      inputSchema: z.object({}) as unknown as Parameters<typeof createPromptFn>[0]['inputSchema'],
      outputSchema: z.object({ category: z.string() }) as unknown as Parameters<typeof createPromptFn>[0]['outputSchema'],
      adapter,
    });

    const result = await callMatcher(
      {
        testPath: '/abs/test.test.ts',
        snapshotState: { _updateSnapshot: 'none' },
      },
      fn,
      [{ name: 'case-1', input: {} }]
    );

    expect(result.pass).toBe(true);
    expect(adapter.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
