// src/jest/__tests__/jest-adapter.vitest.test.ts
// Vitest-runnable behavioral verification of the Jest adapter code path.
// Uses _updateSnapshot (JestMatcherState) stub to exercise the Jest code path
// under the existing Vitest runner — no real API keys, all I/O is mocked.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as z from 'zod';
import type * as z4 from 'zod/v4/core';

import { createPromptFn } from '../../core/factory.js';
import { MockAdapter } from '../../adapters/mock.js';
import { TIDEMARK_META } from '../../core/meta.js';

// ---------------------------------------------------------------------------
// Module mocks — declared at module level before imports
// ---------------------------------------------------------------------------
vi.mock('node:fs/promises');
vi.mock('node:fs');

// ---------------------------------------------------------------------------
// Import Jest adapter under test (deferred so mocks are applied first)
// Exercises the Jest code path (reads _updateSnapshot, not snapshotUpdateState)
// ---------------------------------------------------------------------------
const { expectPromptFn, tidemarkMatchers } = await import('../index.js');

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let adapter: MockAdapter;

beforeEach(async () => {
  adapter = new MockAdapter();
  vi.clearAllMocks();

  // Default: file does not exist (first run)
  const fs = await import('node:fs');
  vi.mocked(fs.existsSync).mockReturnValue(false);

  const fsp = await import('node:fs/promises');
  vi.mocked(fsp.mkdir).mockResolvedValue(undefined);
  vi.mocked(fsp.writeFile).mockResolvedValue(undefined);
  vi.mocked(fsp.readFile).mockRejectedValue(new Error('not found'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// JestMatcherState stub — mirrors JestMatcherState from src/jest/index.ts
// Uses _updateSnapshot (not snapshotUpdateState)
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

describe('expectPromptFn (Jest adapter)', () => {
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
// First run tests — reads _updateSnapshot: 'new'
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

    const writeCall = vi.mocked(fsp.writeFile).mock.calls[0];
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
    const writeCall = vi.mocked(fsp.writeFile).mock.calls[0];
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
    const writeCall = vi.mocked(fsp.writeFile).mock.calls[0];
    const writtenContent = writeCall[1] as string;
    const parsed = JSON.parse(writtenContent);

    expect(parsed['news-case'].category).toEqual({ match: 'baseline' });
    // No judge calls on first run — adapter.calls.length === cases.length
    expect(adapter.calls).toHaveLength(cases.length);
  });
});

// ---------------------------------------------------------------------------
// CI mode tests — reads _updateSnapshot: 'none'
// ---------------------------------------------------------------------------

describe('toMatchTidemarkSnapshot — CI mode (_updateSnapshot: "none")', () => {
  it('no snapshot: pass: false, message contains "baseline", zero adapter calls', async () => {
    // Default mock: existsSync returns false (set in beforeEach)

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

    vi.mocked(fs.existsSync).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vi.mocked(fsp.readFile) as any).mockResolvedValue(JSON.stringify(existingSnapshot));

    // No responses enqueued — any LLM call would throw "no more queued responses"
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

    // CI shortcut: pass without any adapter calls
    expect(result.pass).toBe(true);
    expect(adapter.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Force-regenerate (_updateSnapshot: 'all') — toMatchTidemarkSnapshot
// ---------------------------------------------------------------------------

describe('toMatchTidemarkSnapshot — force-regenerate (_updateSnapshot: "all")', () => {
  it('overwrites existing snapshot and passes', async () => {
    const fs = await import('node:fs');
    const fsp = await import('node:fs/promises');

    const existingSnapshot = {
      $meta: {
        promptHash: 'old-hash',
        schemaHash: 'old-schema',
        modelHash: 'old-model',
        tidemarkVersion: '0.1.0',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      'old-case': { category: { match: 'baseline' } },
    };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vi.mocked(fsp.readFile) as any).mockResolvedValue(JSON.stringify(existingSnapshot));

    adapter.enqueue({ text: '{"category":"news"}', modelVersion: 'updated-model-v2' });

    const fn = createPromptFn({
      name: 'force-regen-test',
      prompt: () => 'Classify.',
      inputSchema: z.object({}) as unknown as Parameters<typeof createPromptFn>[0]['inputSchema'],
      outputSchema: z.object({ category: z.string() }) as unknown as Parameters<typeof createPromptFn>[0]['outputSchema'],
      adapter,
    });

    const result = await callMatcher(
      {
        testPath: '/abs/test.test.ts',
        snapshotState: { _updateSnapshot: 'all' },
      },
      fn,
      [{ name: 'new-case', input: {} }]
    );

    expect(result.pass).toBe(true);
    expect(vi.mocked(fsp.writeFile)).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Subsequent run tests
// ---------------------------------------------------------------------------

describe('toMatchTidemarkSnapshot — subsequent run (snapshot exists)', () => {
  it('pass=true when no hash changed and all fields pass, writeFile not called (read-only)', async () => {
    const fs = await import('node:fs');
    const fsp = await import('node:fs/promises');
    const { computeHashTriplet } = await import('../../snapshot/engine.js');

    const fn = createPromptFn({
      name: 'subsequent-pass-jest',
      prompt: () => 'Classify.',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ score: z.number() }) as unknown as z4.$ZodType,
      adapter,
    });

    const modelVersion = 'test-model-v1';
    const freshMeta = computeHashTriplet(fn[TIDEMARK_META] as Parameters<typeof computeHashTriplet>[0], modelVersion);

    const existingSnapshot = {
      $meta: freshMeta,
      'case-1': { score: 42 },
    };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vi.mocked(fsp.readFile) as any).mockResolvedValue(JSON.stringify(existingSnapshot));

    adapter.enqueue({ text: '{"score":42}', modelVersion });

    const result = await callMatcher(
      {
        testPath: '/abs/test.test.ts',
        snapshotState: { _updateSnapshot: 'new' },
      },
      fn,
      [{ name: 'case-1', input: {} }]
    );

    expect(result.pass).toBe(true);
    expect(vi.mocked(fsp.writeFile)).not.toHaveBeenCalled();
  });

  it('pass=false with "prompt hash changed" when promptHash differs', async () => {
    const fs = await import('node:fs');
    const fsp = await import('node:fs/promises');

    const existingSnapshot = {
      $meta: {
        promptHash: 'OLD-PROMPT-HASH-WILL-NOT-MATCH',
        schemaHash: 'any-schema-hash',
        modelHash: 'any-model-hash',
        tidemarkVersion: '0.1.0',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      'case-1': { category: { match: 'baseline' } },
    };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vi.mocked(fsp.readFile) as any).mockResolvedValue(JSON.stringify(existingSnapshot));

    adapter.enqueue({ text: '{"category":"news"}', modelVersion: 'test-model-v1' });

    const fn = createPromptFn({
      name: 'hash-drift-jest',
      prompt: () => 'Classify.',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ category: z.string() }) as unknown as z4.$ZodType,
      adapter,
    });

    const result = await callMatcher(
      {
        testPath: '/abs/test.test.ts',
        snapshotState: { _updateSnapshot: 'new' },
      },
      fn,
      [{ name: 'case-1', input: {} }]
    );

    expect(result.pass).toBe(false);
    expect(result.message()).toContain('prompt hash changed');
    expect(adapter.calls).toHaveLength(1);
  });

  it('pass=false with field details when string field scores below threshold', async () => {
    const fs = await import('node:fs');
    const fsp = await import('node:fs/promises');
    const { computeHashTriplet } = await import('../../snapshot/engine.js');

    const fn = createPromptFn({
      name: 'judge-fail-jest',
      prompt: () => 'Summarize.',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ summary: z.string() }) as unknown as z4.$ZodType,
      adapter,
    });

    const modelVersion = 'test-model-v1';
    const freshMeta = computeHashTriplet(fn[TIDEMARK_META] as Parameters<typeof computeHashTriplet>[0], modelVersion);

    const existingSnapshot = {
      $meta: freshMeta,
      'case-1': { summary: { match: 'baseline' } },
    };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vi.mocked(fsp.readFile) as any).mockResolvedValue(JSON.stringify(existingSnapshot));

    adapter.enqueue({ text: '{"summary":"Completely different output"}', modelVersion });
    adapter.enqueue({ text: '"score": 0.40, "reasoning": "Very different"', modelVersion });

    const result = await callMatcher(
      {
        testPath: '/abs/test.test.ts',
        snapshotState: { _updateSnapshot: 'new' },
      },
      fn,
      [{ name: 'case-1', input: {} }]
    );

    expect(result.pass).toBe(false);
    const msg = result.message();
    expect(msg).toContain('summary');
    expect(msg).toContain('judged');
  });

  it('respects opts.threshold — 0.91 passes at 0.85 but fails at 0.95', async () => {
    const fs = await import('node:fs');
    const fsp = await import('node:fs/promises');
    const { computeHashTriplet } = await import('../../snapshot/engine.js');

    const fn = createPromptFn({
      name: 'threshold-jest',
      prompt: () => 'Summarize.',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ summary: z.string() }) as unknown as z4.$ZodType,
      adapter,
    });

    const modelVersion = 'test-model-v1';
    const freshMeta = computeHashTriplet(fn[TIDEMARK_META] as Parameters<typeof computeHashTriplet>[0], modelVersion);
    const existingSnapshot = { $meta: freshMeta, 'case-1': { summary: { match: 'baseline' } } };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vi.mocked(fsp.readFile) as any).mockResolvedValue(JSON.stringify(existingSnapshot));

    adapter.enqueue({ text: '{"summary":"Slightly different"}', modelVersion });
    adapter.enqueue({ text: '"score": 0.91, "reasoning": "Close"', modelVersion });

    const result = await callMatcher(
      {
        testPath: '/abs/test.test.ts',
        snapshotState: { _updateSnapshot: 'new' },
      },
      fn,
      [{ name: 'case-1', input: {} }],
      { threshold: 0.95 }
    );

    expect(result.pass).toBe(false);
  });

  it('uses default threshold 0.85 — score at boundary passes', async () => {
    const fs = await import('node:fs');
    const fsp = await import('node:fs/promises');
    const { computeHashTriplet } = await import('../../snapshot/engine.js');

    const fn = createPromptFn({
      name: 'default-threshold-jest',
      prompt: () => 'Summarize.',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ summary: z.string() }) as unknown as z4.$ZodType,
      adapter,
    });

    const modelVersion = 'test-model-v1';
    const freshMeta = computeHashTriplet(fn[TIDEMARK_META] as Parameters<typeof computeHashTriplet>[0], modelVersion);
    const existingSnapshot = { $meta: freshMeta, 'case-1': { summary: { match: 'baseline' } } };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vi.mocked(fsp.readFile) as any).mockResolvedValue(JSON.stringify(existingSnapshot));

    adapter.enqueue({ text: '{"summary":"Good output"}', modelVersion });
    adapter.enqueue({ text: '"score": 0.85, "reasoning": "Equivalent"', modelVersion });

    const result = await callMatcher(
      {
        testPath: '/abs/test.test.ts',
        snapshotState: { _updateSnapshot: 'new' },
      },
      fn,
      [{ name: 'case-1', input: {} }]
    );

    expect(result.pass).toBe(true);
  });

  it('TidemarkSnapshotError in subsequent run → pass=false with error message', async () => {
    const fs = await import('node:fs');
    const fsp = await import('node:fs/promises');
    const { computeHashTriplet } = await import('../../snapshot/engine.js');

    const fn = createPromptFn({
      name: 'catch-block-jest',
      prompt: () => 'test',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ score: z.number() }) as unknown as z4.$ZodType,
      adapter,
    });

    const modelVersion = 'v1';
    const freshMeta = computeHashTriplet(fn[TIDEMARK_META] as Parameters<typeof computeHashTriplet>[0], modelVersion);
    const existingSnapshot = { $meta: freshMeta, 'dup': { score: 1 } };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vi.mocked(fsp.readFile) as any).mockResolvedValue(JSON.stringify(existingSnapshot));

    // Duplicate case names in subsequent run → TidemarkSnapshotError
    const result = await callMatcher(
      { testPath: '/abs/test.test.ts', snapshotState: { _updateSnapshot: 'new' } },
      fn,
      [{ name: 'dup', input: {} }, { name: 'dup', input: {} }]
    );

    expect(result.pass).toBe(false);
    expect(result.message()).toMatch(/duplicate/i);
  });

  it('re-throws non-TidemarkSnapshotError from subsequent run', async () => {
    const fs = await import('node:fs');
    const fsp = await import('node:fs/promises');
    const { computeHashTriplet } = await import('../../snapshot/engine.js');

    const fn = createPromptFn({
      name: 'rethrow-jest',
      prompt: () => 'test',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ score: z.number() }) as unknown as z4.$ZodType,
      adapter,
    });

    const modelVersion = 'v1';
    const freshMeta = computeHashTriplet(fn[TIDEMARK_META] as Parameters<typeof computeHashTriplet>[0], modelVersion);
    const existingSnapshot = { $meta: freshMeta, 'case-1': { score: 1 } };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vi.mocked(fsp.readFile) as any).mockResolvedValue(JSON.stringify(existingSnapshot));

    adapter.reset();
    vi.spyOn(adapter, 'generate').mockRejectedValue(new TypeError('network failure'));

    await expect(
      callMatcher(
        { testPath: '/abs/test.test.ts', snapshotState: { _updateSnapshot: 'new' } },
        fn,
        [{ name: 'case-1', input: {} }]
      )
    ).rejects.toThrow('network failure');
  });

  it('storedEntry absent from snapshot → evaluates against empty baseline', async () => {
    const fs = await import('node:fs');
    const fsp = await import('node:fs/promises');
    const { computeHashTriplet } = await import('../../snapshot/engine.js');

    const fn = createPromptFn({
      name: 'missing-case-jest',
      prompt: () => 'test',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ score: z.number() }) as unknown as z4.$ZodType,
      adapter,
    });

    const modelVersion = 'v1';
    const freshMeta = computeHashTriplet(fn[TIDEMARK_META] as Parameters<typeof computeHashTriplet>[0], modelVersion);
    const existingSnapshot = { $meta: freshMeta }; // no 'new-case' entry

    vi.mocked(fs.existsSync).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vi.mocked(fsp.readFile) as any).mockResolvedValue(JSON.stringify(existingSnapshot));

    adapter.enqueue({ text: '{"score":42}', modelVersion });

    const result = await callMatcher(
      { testPath: '/abs/test.test.ts', snapshotState: { _updateSnapshot: 'new' } },
      fn,
      [{ name: 'new-case', input: {} }]
    );

    expect(result.pass).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Sampling gate tests
// ---------------------------------------------------------------------------

describe('toMatchTidemarkSnapshot — sampling gate (Jest adapter)', () => {
  async function setupMatchingSnapshot(fnName: string, modelVersion = 'test-model-v1') {
    const fs = await import('node:fs');
    const fsp = await import('node:fs/promises');
    const { computeHashTriplet } = await import('../../snapshot/engine.js');

    const fn = createPromptFn({
      name: fnName,
      prompt: () => 'Classify.',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ score: z.number() }) as unknown as z4.$ZodType,
      adapter,
    });

    const freshMeta = computeHashTriplet(fn[TIDEMARK_META] as Parameters<typeof computeHashTriplet>[0], modelVersion);
    const existingSnapshot = { $meta: freshMeta, 'case-1': { score: 42 } };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vi.mocked(fsp.readFile) as any).mockResolvedValue(JSON.stringify(existingSnapshot));

    return { fn, modelVersion };
  }

  const baseState: StubMatcherState = {
    testPath: '/abs/test.test.ts',
    snapshotState: { _updateSnapshot: 'new' },
  };

  it('sample: 0.0 — always skips LLM, passes silently', async () => {
    const { fn } = await setupMatchingSnapshot('jest-sample-zero');
    const result = await callMatcher(baseState, fn, [{ name: 'case-1', input: {} }], { sample: 0.0 });
    expect(result.pass).toBe(true);
    expect(adapter.calls).toHaveLength(0);
  });

  it('sample: 1.0 — always runs LLM', async () => {
    const { fn, modelVersion } = await setupMatchingSnapshot('jest-sample-one');
    adapter.enqueue({ text: '{"score":42}', modelVersion });
    const result = await callMatcher(baseState, fn, [{ name: 'case-1', input: {} }], { sample: 1.0 });
    expect(result.pass).toBe(true);
    expect(adapter.calls.length).toBeGreaterThan(0);
  });

  it('sample: 0.5, Math.random()=0.7 — skips (0.7 >= 0.5)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.7);
    const { fn } = await setupMatchingSnapshot('jest-sample-half-skip');
    const result = await callMatcher(baseState, fn, [{ name: 'case-1', input: {} }], { sample: 0.5 });
    expect(result.pass).toBe(true);
    expect(adapter.calls).toHaveLength(0);
  });

  it('sample: 0.5, Math.random()=0.3 — runs (0.3 < 0.5)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.3);
    const { fn, modelVersion } = await setupMatchingSnapshot('jest-sample-half-run');
    adapter.enqueue({ text: '{"score":42}', modelVersion });
    const result = await callMatcher(baseState, fn, [{ name: 'case-1', input: {} }], { sample: 0.5 });
    expect(adapter.calls.length).toBeGreaterThan(0);
    expect(result.pass).toBe(true);
  });

  it('every: 5, Math.random()=0.25 — skips (0.25 >= 1/5)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    const { fn } = await setupMatchingSnapshot('jest-every-5-skip');
    const result = await callMatcher(baseState, fn, [{ name: 'case-1', input: {} }], { every: 5 });
    expect(result.pass).toBe(true);
    expect(adapter.calls).toHaveLength(0);
  });

  it('every: 5, Math.random()=0.15 — runs (0.15 < 1/5)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.15);
    const { fn, modelVersion } = await setupMatchingSnapshot('jest-every-5-run');
    adapter.enqueue({ text: '{"score":42}', modelVersion });
    const result = await callMatcher(baseState, fn, [{ name: 'case-1', input: {} }], { every: 5 });
    expect(adapter.calls.length).toBeGreaterThan(0);
    expect(result.pass).toBe(true);
  });

  it('sample wins over every when both provided (sample: 0.0 always skips)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const { fn } = await setupMatchingSnapshot('jest-sample-wins');
    const result = await callMatcher(baseState, fn, [{ name: 'case-1', input: {} }], { sample: 0.0, every: 1 });
    expect(result.pass).toBe(true);
    expect(adapter.calls).toHaveLength(0);
  });

  it('CI mode ignores sample — step 5.5 returns before sampling gate', async () => {
    const { fn } = await setupMatchingSnapshot('jest-ci-ignores-sample');
    const ciState: StubMatcherState = { ...baseState, snapshotState: { _updateSnapshot: 'none' } };
    const result = await callMatcher(ciState, fn, [{ name: 'case-1', input: {} }], { sample: 0.0 });
    expect(result.pass).toBe(true);
    expect(adapter.calls).toHaveLength(0);
  });

  it('first-run ignores sample — step 6 returns before sampling gate', async () => {
    const fs = await import('node:fs');
    const fsp = await import('node:fs/promises');
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const fn = createPromptFn({
      name: 'jest-first-run-ignores-sample',
      prompt: () => 'Classify.',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ score: z.number() }) as unknown as z4.$ZodType,
      adapter,
    });
    adapter.enqueue({ text: '{"score":1}', modelVersion: 'v1' });
    const result = await callMatcher(baseState, fn, [{ name: 'case-1', input: {} }], { sample: 0.0 });
    expect(result.pass).toBe(true);
    expect(vi.mocked(fsp.writeFile)).toHaveBeenCalled();
  });

  it('sample > 1 clamped to 1.0 — always runs', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const { fn, modelVersion } = await setupMatchingSnapshot('jest-sample-over-1');
    adapter.enqueue({ text: '{"score":42}', modelVersion });
    const result = await callMatcher(baseState, fn, [{ name: 'case-1', input: {} }], { sample: 2.0 });
    expect(adapter.calls.length).toBeGreaterThan(0);
    expect(result.pass).toBe(true);
  });

  it('every: 0 clamped to 1 — always runs', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const { fn, modelVersion } = await setupMatchingSnapshot('jest-every-zero');
    adapter.enqueue({ text: '{"score":42}', modelVersion });
    const result = await callMatcher(baseState, fn, [{ name: 'case-1', input: {} }], { every: 0 });
    expect(adapter.calls.length).toBeGreaterThan(0);
    expect(result.pass).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TIDEMARK_META missing — received is not a promptFn
// ---------------------------------------------------------------------------

describe('toMatchTidemarkSnapshot — non-promptFn received', () => {
  it('pass=false with instructive message when received has no TIDEMARK_META', async () => {
    const notAPromptFn = () => 'hello';

    const result = await callMatcher(
      { testPath: '/abs/test.test.ts', snapshotState: { _updateSnapshot: 'new' } },
      notAPromptFn,
      [{ name: 'case-1', input: {} }]
    );

    expect(result.pass).toBe(false);
    expect(result.message()).toContain('promptFn');
  });
});

// ---------------------------------------------------------------------------
// Duplicate case names — first run
// ---------------------------------------------------------------------------

describe('toMatchTidemarkSnapshot — duplicate case names (first run)', () => {
  it('throws TidemarkSnapshotError for duplicate case names', async () => {
    adapter
      .enqueue({ text: '{"category":"a"}', modelVersion: 'v1' })
      .enqueue({ text: '{"category":"b"}', modelVersion: 'v1' });

    const fn = createPromptFn({
      name: 'jest-dup-test',
      prompt: () => 'Classify.',
      inputSchema: z.object({}) as unknown as Parameters<typeof createPromptFn>[0]['inputSchema'],
      outputSchema: z.object({ category: z.string() }) as unknown as Parameters<typeof createPromptFn>[0]['outputSchema'],
      adapter,
    });

    await expect(
      callMatcher(
        { testPath: '/abs/test.test.ts', snapshotState: { _updateSnapshot: 'new' } },
        fn,
        [{ name: 'same-name', input: {} }, { name: 'same-name', input: {} }]
      )
    ).rejects.toThrow(/duplicate/i);
  });
});

// ---------------------------------------------------------------------------
// Matcher state undefined fallbacks
// ---------------------------------------------------------------------------

describe('toMatchTidemarkSnapshot — matcher state undefined fallbacks', () => {
  it('testPath undefined falls back to empty string — first run still writes snapshot', async () => {
    adapter.enqueue({ text: '{"score":1}', modelVersion: 'v1' });

    const fn = createPromptFn({
      name: 'jest-no-testpath',
      prompt: () => 'test',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ score: z.number() }) as unknown as z4.$ZodType,
      adapter,
    });

    const result = await callMatcher(
      { testPath: undefined, snapshotState: { _updateSnapshot: 'new' } },
      fn,
      [{ name: 'case-1', input: {} }]
    );

    expect(result.pass).toBe(true);
    const fsp = await import('node:fs/promises');
    expect(fsp.writeFile).toHaveBeenCalled();
  });

  it('snapshotState undefined falls back to "new" — first run proceeds normally', async () => {
    adapter.enqueue({ text: '{"score":1}', modelVersion: 'v1' });

    const fn = createPromptFn({
      name: 'jest-no-snapshot-state',
      prompt: () => 'test',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ score: z.number() }) as unknown as z4.$ZodType,
      adapter,
    });

    const result = await callMatcher(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { testPath: '/abs/test.test.ts', snapshotState: undefined } as any,
      fn,
      [{ name: 'case-1', input: {} }]
    );

    expect(result.pass).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// message() lambdas on passing results
// ---------------------------------------------------------------------------

describe('toMatchTidemarkSnapshot — message() on passing results', () => {
  it('CI mode pass: message() returns empty string', async () => {
    const fs = await import('node:fs');
    const fsp = await import('node:fs/promises');

    const existingSnapshot = {
      $meta: { promptHash: 'h', schemaHash: 'h', modelHash: 'h', tidemarkVersion: '0.1.0', createdAt: '2026-01-01T00:00:00.000Z' },
      'case-1': { score: 1 },
    };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vi.mocked(fsp.readFile) as any).mockResolvedValue(JSON.stringify(existingSnapshot));

    const fn = createPromptFn({
      name: 'jest-ci-msg',
      prompt: () => 'test',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ score: z.number() }) as unknown as z4.$ZodType,
      adapter,
    });

    const result = await callMatcher(
      { testPath: '/abs/test.test.ts', snapshotState: { _updateSnapshot: 'none' } },
      fn,
      [{ name: 'case-1', input: {} }]
    );

    expect(result.pass).toBe(true);
    expect(result.message()).toBe('');
  });

  it('first-run pass: message() returns empty string', async () => {
    adapter.enqueue({ text: '{"score":1}', modelVersion: 'v1' });

    const fn = createPromptFn({
      name: 'jest-first-run-msg',
      prompt: () => 'test',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ score: z.number() }) as unknown as z4.$ZodType,
      adapter,
    });

    const result = await callMatcher(
      { testPath: '/abs/test.test.ts', snapshotState: { _updateSnapshot: 'new' } },
      fn,
      [{ name: 'case-1', input: {} }]
    );

    expect(result.pass).toBe(true);
    expect(result.message()).toBe('');
  });

  it('sampling skip pass: message() returns empty string', async () => {
    const fs = await import('node:fs');
    const fsp = await import('node:fs/promises');
    const { computeHashTriplet } = await import('../../snapshot/engine.js');

    const fn = createPromptFn({
      name: 'jest-sampling-msg',
      prompt: () => 'test',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ score: z.number() }) as unknown as z4.$ZodType,
      adapter,
    });

    const freshMeta = computeHashTriplet(fn[TIDEMARK_META] as Parameters<typeof computeHashTriplet>[0], 'v1');
    const existingSnapshot = { $meta: freshMeta, 'case-1': { score: 1 } };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vi.mocked(fsp.readFile) as any).mockResolvedValue(JSON.stringify(existingSnapshot));

    const result = await callMatcher(
      { testPath: '/abs/test.test.ts', snapshotState: { _updateSnapshot: 'new' } },
      fn,
      [{ name: 'case-1', input: {} }],
      { sample: 0.0 }
    );

    expect(result.pass).toBe(true);
    expect(result.message()).toBe('');
  });

  it('allPass subsequent run: message() returns empty string', async () => {
    const fs = await import('node:fs');
    const fsp = await import('node:fs/promises');
    const { computeHashTriplet } = await import('../../snapshot/engine.js');

    const fn = createPromptFn({
      name: 'jest-allpass-msg',
      prompt: () => 'test',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ score: z.number() }) as unknown as z4.$ZodType,
      adapter,
    });

    const modelVersion = 'v1';
    const freshMeta = computeHashTriplet(fn[TIDEMARK_META] as Parameters<typeof computeHashTriplet>[0], modelVersion);
    const existingSnapshot = { $meta: freshMeta, 'case-1': { score: 42 } };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vi.mocked(fsp.readFile) as any).mockResolvedValue(JSON.stringify(existingSnapshot));

    adapter.enqueue({ text: '{"score":42}', modelVersion });

    const result = await callMatcher(
      { testPath: '/abs/test.test.ts', snapshotState: { _updateSnapshot: 'new' } },
      fn,
      [{ name: 'case-1', input: {} }]
    );

    expect(result.pass).toBe(true);
    expect(result.message()).toBe('');
  });
});
