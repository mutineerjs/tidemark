// src/vitest/__tests__/matcher.test.ts
// End-to-end integration tests for expectPromptFn builder and toMatchTidemarkSnapshot matcher
// Covers TEST-01: first-run, update mode, CI no-baseline, duplicate case names

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
// Import matcher under test (deferred so mocks are applied first)
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
// Helper: invoke toMatchTidemarkSnapshot with a stubbed MatcherState
// ---------------------------------------------------------------------------

interface StubMatcherState {
  testPath: string;
  snapshotState: {
    snapshotUpdateState: 'all' | 'new' | 'none';
  };
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
// Core matcher tests
// ---------------------------------------------------------------------------

describe('expectPromptFn', () => {
  it('returns an object with a toMatchSnapshot method', () => {
    const fn = createPromptFn({
      name: 'classify',
      prompt: () => 'Classify this.',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ category: z.string() }) as unknown as z4.$ZodType,
      adapter,
    });
    const wrapper = expectPromptFn(fn as Parameters<typeof expectPromptFn>[0]);
    expect(typeof wrapper.toMatchSnapshot).toBe('function');
  });
});

describe('toMatchTidemarkSnapshot — first run (no snapshot file)', () => {
  it('calls adapter.generate once per case on first run (no judge calls — D-11)', async () => {
    adapter
      .enqueue({ text: '{"category":"news"}', modelVersion: 'test-model-v1' })
      .enqueue({ text: '{"category":"sports"}', modelVersion: 'test-model-v1' });

    const fn = createPromptFn({
      name: 'classify',
      prompt: () => 'Classify this.',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ category: z.string() }) as unknown as z4.$ZodType,
      adapter,
    });

    const cases = [
      { name: 'news-case', input: {} },
      { name: 'sports-case', input: {} },
    ];

    const result = await callMatcher(
      {
        testPath: '/abs/test/my.test.ts',
        snapshotState: { snapshotUpdateState: 'new' },
      },
      fn,
      cases
    );

    // Should pass on first run
    expect(result.pass).toBe(true);

    // adapter.calls.length === cases.length (no judge calls — D-11)
    expect(adapter.calls).toHaveLength(cases.length);
  });

  it('writes __snapshots__/<name>.snap.json on first run', async () => {
    adapter.enqueue({ text: '{"category":"news"}', modelVersion: 'test-model-v1' });

    const fn = createPromptFn({
      name: 'my-classifier',
      prompt: () => 'Classify.',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ category: z.string() }) as unknown as z4.$ZodType,
      adapter,
    });

    await callMatcher(
      {
        testPath: '/home/user/project/src/my.test.ts',
        snapshotState: { snapshotUpdateState: 'new' },
      },
      fn,
      [{ name: 'news-case', input: {} }]
    );

    const fsp = await import('node:fs/promises');
    expect(fsp.writeFile).toHaveBeenCalled();

    const writeCall = vi.mocked(fsp.writeFile).mock.calls[0];
    const writtenPath = writeCall[0] as string;
    expect(writtenPath).toContain('__snapshots__');
    expect(writtenPath).toContain('my-classifier.snap.json');
  });

  it('written snapshot has $meta with promptHash/schemaHash/modelHash/tidemarkVersion/createdAt', async () => {
    adapter.enqueue({ text: '{"category":"news"}', modelVersion: 'test-model-v1' });

    const fn = createPromptFn({
      name: 'hash-test',
      prompt: () => 'Classify.',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ category: z.string() }) as unknown as z4.$ZodType,
      adapter,
    });

    await callMatcher(
      {
        testPath: '/abs/test.test.ts',
        snapshotState: { snapshotUpdateState: 'new' },
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
    expect(typeof parsed.$meta.tidemarkVersion).toBe('string');
    expect(typeof parsed.$meta.createdAt).toBe('string');
  });

  it('string fields in written snapshot are { match: "baseline" } (D-07)', async () => {
    adapter.enqueue({ text: '{"category":"news","score":0.9}', modelVersion: 'test-model-v1' });

    const fn = createPromptFn({
      name: 'baseline-test',
      prompt: () => 'Classify.',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({
        category: z.string(),
        score: z.number(),
      }) as unknown as z4.$ZodType,
      adapter,
    });

    await callMatcher(
      {
        testPath: '/abs/test.test.ts',
        snapshotState: { snapshotUpdateState: 'new' },
      },
      fn,
      [{ name: 'case-1', input: {} }]
    );

    const fsp = await import('node:fs/promises');
    const writeCall = vi.mocked(fsp.writeFile).mock.calls[0];
    const writtenContent = writeCall[1] as string;
    const parsed = JSON.parse(writtenContent);

    const caseEntry = parsed['case-1'];
    expect(caseEntry.category).toEqual({ match: 'baseline' }); // string → baseline verdict
    expect(caseEntry.score).toBe(0.9); // number → raw value
  });
});

describe('toMatchTidemarkSnapshot — update mode (snapshotUpdateState === "all")', () => {
  it('overwrites existing snapshot file in update mode', async () => {
    // Simulate: file already exists
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
      name: 'update-test',
      prompt: () => 'Classify.',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ category: z.string() }) as unknown as z4.$ZodType,
      adapter,
    });

    const result = await callMatcher(
      {
        testPath: '/abs/test.test.ts',
        snapshotState: { snapshotUpdateState: 'all' }, // --update mode
      },
      fn,
      [{ name: 'new-case', input: {} }]
    );

    // Should pass in update mode
    expect(result.pass).toBe(true);
    // Should overwrite the file
    expect(fsp.writeFile).toHaveBeenCalled();
  });
});

describe('toMatchTidemarkSnapshot — CI mode (snapshotUpdateState === "none")', () => {
  it('fails with instructive message when no snapshot exists in CI mode', async () => {
    // File does not exist (default mock)

    const fn = createPromptFn({
      name: 'ci-test',
      prompt: () => 'Classify.',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ category: z.string() }) as unknown as z4.$ZodType,
      adapter,
    });

    const result = await callMatcher(
      {
        testPath: '/abs/test.test.ts',
        snapshotState: { snapshotUpdateState: 'none' }, // --ci mode
      },
      fn,
      [{ name: 'case-1', input: {} }]
    );

    expect(result.pass).toBe(false);
    // Message should instruct user to run without --ci
    expect(result.message()).toContain('baseline');
  });

  it('does NOT call adapter.generate in CI mode when no snapshot exists', async () => {
    const fn = createPromptFn({
      name: 'ci-no-call',
      prompt: () => 'Classify.',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ category: z.string() }) as unknown as z4.$ZodType,
      adapter,
    });

    await callMatcher(
      {
        testPath: '/abs/test.test.ts',
        snapshotState: { snapshotUpdateState: 'none' },
      },
      fn,
      [{ name: 'case-1', input: {} }]
    );

    // No adapter calls should be made in CI mode with no snapshot
    expect(adapter.calls).toHaveLength(0);
  });

  it('CI mode: passes without LLM call when snapshot exists', async () => {
    const fs = await import('node:fs');
    const fsp = await import('node:fs/promises');

    // Simulate: snapshot file exists with a committed baseline
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
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ category: z.string() }) as unknown as z4.$ZodType,
      adapter,
    });

    const result = await callMatcher(
      {
        testPath: '/abs/test.test.ts',
        snapshotState: { snapshotUpdateState: 'none' }, // CI mode
      },
      fn,
      [{ name: 'case-1', input: {} }]
    );

    // Should pass without any adapter calls (no LLM credit usage)
    expect(result.pass).toBe(true);
    expect(adapter.calls).toHaveLength(0);
  });
});

describe('toMatchTidemarkSnapshot — duplicate case names', () => {
  it('fails with TidemarkSnapshotError message for duplicate case names', async () => {
    adapter
      .enqueue({ text: '{"category":"a"}', modelVersion: 'v1' })
      .enqueue({ text: '{"category":"b"}', modelVersion: 'v1' });

    const fn = createPromptFn({
      name: 'dup-test',
      prompt: () => 'Classify.',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ category: z.string() }) as unknown as z4.$ZodType,
      adapter,
    });

    // Expect the matcher to throw or return fail due to duplicate case names
    await expect(
      callMatcher(
        {
          testPath: '/abs/test.test.ts',
          snapshotState: { snapshotUpdateState: 'new' },
        },
        fn,
        [
          { name: 'same-name', input: {} },
          { name: 'same-name', input: {} },
        ]
      )
    ).rejects.toThrow(/duplicate/i);
  });
});

// ---------------------------------------------------------------------------
// compareHashTriplet helper (from engine — also tested here per plan Task 3)
// ---------------------------------------------------------------------------

describe('compareHashTriplet (engine utility)', () => {
  it('returns all false when hashes match', async () => {
    const { compareHashTriplet } = await import('../../snapshot/engine.js');
    const meta = {
      promptHash: 'abc',
      schemaHash: 'def',
      modelHash: 'ghi',
      tidemarkVersion: '0.1.0',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const result = compareHashTriplet(meta, meta);
    expect(result).toEqual({ prompt: false, schema: false, model: false });
  });

  it('returns prompt: true when promptHash differs', async () => {
    const { compareHashTriplet } = await import('../../snapshot/engine.js');
    const stored = { promptHash: 'OLD', schemaHash: 'def', modelHash: 'ghi', tidemarkVersion: '0.1.0', createdAt: '2026-01-01T00:00:00.000Z' };
    const fresh = { promptHash: 'NEW', schemaHash: 'def', modelHash: 'ghi', tidemarkVersion: '0.1.0', createdAt: '2026-01-01T00:00:00.000Z' };
    const result = compareHashTriplet(stored, fresh);
    expect(result).toEqual({ prompt: true, schema: false, model: false });
  });
});

// ---------------------------------------------------------------------------
// Subsequent run tests (Plan 02 implementation)
// ---------------------------------------------------------------------------

describe('toMatchTidemarkSnapshot — subsequent run (snapshot exists)', () => {
  it('resolves pass=true when no hash changed and all fields pass', async () => {
    const fs = await import('node:fs');
    const fsp = await import('node:fs/promises');

    // We need to match the real hash triplet so no hash drift is detected.
    // Use a simpler approach: make the promptHash/schemaHash/modelHash match
    // by intercepting computeHashTriplet to return the stored meta values.
    // Instead: create a snapshot where the stored meta equals what we expect
    // by running the adapter once and capturing the result.

    // Use a mock approach: store hashes that will match the fresh computation.
    // Since computeHashTriplet hashes are deterministic for the same fn,
    // we need to pre-compute them. Easier: use a fn + mock response and
    // do a first-run to get the real hashes, then simulate subsequent run.

    // Simple approach: we build a snapshot with matching hashes by computing them ourselves.
    const { computeHashTriplet } = await import('../../snapshot/engine.js');
    const { createHash } = await import('node:crypto');

    const fn = createPromptFn({
      name: 'subsequent-pass-test',
      prompt: () => 'Classify.',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ score: z.number() }) as unknown as z4.$ZodType,
      adapter,
    });

    const modelVersion = 'test-model-v1';
    const freshMeta = computeHashTriplet(fn[TIDEMARK_META] as Parameters<typeof computeHashTriplet>[0], modelVersion);

    const existingSnapshot = {
      $meta: freshMeta,
      'case-1': { score: 42 }, // number field → exact match baseline
    };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vi.mocked(fsp.readFile) as any).mockResolvedValue(JSON.stringify(existingSnapshot));

    // Enqueue response returning the same score (exact match passes)
    adapter.enqueue({ text: '{"score":42}', modelVersion });

    const result = await callMatcher(
      {
        testPath: '/abs/test.test.ts',
        snapshotState: { snapshotUpdateState: 'new' },
      },
      fn,
      [{ name: 'case-1', input: {} }]
    );

    expect(result.pass).toBe(true);
    // Subsequent run should NOT rewrite the snapshot file (read-only)
    expect(fsp.writeFile).not.toHaveBeenCalled();
  });

  it('returns pass=false with "prompt hash changed" when promptHash differs — no judge calls', async () => {
    const fs = await import('node:fs');
    const fsp = await import('node:fs/promises');

    // Store a snapshot with a different promptHash to trigger hash mismatch
    const existingSnapshot = {
      $meta: {
        promptHash: 'OLD-PROMPT-HASH-THAT-WILL-NOT-MATCH',
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

    // Enqueue one response for the case execution
    adapter.enqueue({ text: '{"category":"news"}', modelVersion: 'test-model-v1' });

    const fn = createPromptFn({
      name: 'hash-drift-test',
      prompt: () => 'Classify.',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ category: z.string() }) as unknown as z4.$ZodType,
      adapter,
    });

    const result = await callMatcher(
      {
        testPath: '/abs/test.test.ts',
        snapshotState: { snapshotUpdateState: 'new' },
      },
      fn,
      [{ name: 'case-1', input: {} }]
    );

    expect(result.pass).toBe(false);
    expect(result.message()).toContain('prompt hash changed');

    // Hash mismatch short-circuits before judge — only 1 call (case execution), no extra judge calls
    // The matcher runs cases THEN compares hashes, so adapter.calls.length === 1 (case execution only)
    expect(adapter.calls).toHaveLength(1);
  });

  it('returns pass=false with field details when string field scores below threshold', async () => {
    const fs = await import('node:fs');
    const fsp = await import('node:fs/promises');

    const { computeHashTriplet } = await import('../../snapshot/engine.js');

    const fn = createPromptFn({
      name: 'judge-fail-test',
      prompt: () => 'Summarize.',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ summary: z.string() }) as unknown as z4.$ZodType,
      adapter,
    });

    const modelVersion = 'test-model-v1';
    const meta = fn[TIDEMARK_META] as Parameters<typeof computeHashTriplet>[0];
    const freshMeta = computeHashTriplet(meta, modelVersion);

    const existingSnapshot = {
      $meta: freshMeta,
      'case-1': { summary: { match: 'baseline' } },
    };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vi.mocked(fsp.readFile) as any).mockResolvedValue(JSON.stringify(existingSnapshot));

    // First call: case execution
    adapter.enqueue({ text: '{"summary":"Completely different output"}', modelVersion });
    // Second call: judge for the summary string field
    adapter.enqueue({ text: '"score": 0.40, "reasoning": "Very different"}', modelVersion });

    const result = await callMatcher(
      {
        testPath: '/abs/test.test.ts',
        snapshotState: { snapshotUpdateState: 'new' },
      },
      fn,
      [{ name: 'case-1', input: {} }]
    );

    expect(result.pass).toBe(false);
    const msg = result.message();
    // Failure message should contain the field path and mode
    expect(msg).toContain('summary');
    expect(msg).toContain('judged');
  });

  it('respects opts.threshold — a 0.91 score that passes at default 0.85 fails at 0.95', async () => {
    const fs = await import('node:fs');
    const fsp = await import('node:fs/promises');

    const { computeHashTriplet } = await import('../../snapshot/engine.js');

    const fn = createPromptFn({
      name: 'threshold-test',
      prompt: () => 'Summarize.',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ summary: z.string() }) as unknown as z4.$ZodType,
      adapter,
    });

    const modelVersion = 'test-model-v1';
    const meta = fn[TIDEMARK_META] as Parameters<typeof computeHashTriplet>[0];
    const freshMeta = computeHashTriplet(meta, modelVersion);

    const existingSnapshot = {
      $meta: freshMeta,
      'case-1': { summary: { match: 'baseline' } },
    };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vi.mocked(fsp.readFile) as any).mockResolvedValue(JSON.stringify(existingSnapshot));

    // Test at threshold 0.95: 0.91 should fail
    adapter.enqueue({ text: '{"summary":"Slightly different wording"}', modelVersion });
    adapter.enqueue({ text: '"score": 0.91, "reasoning": "Close"}', modelVersion });

    const result = await callMatcher(
      {
        testPath: '/abs/test.test.ts',
        snapshotState: { snapshotUpdateState: 'new' },
      },
      fn,
      [{ name: 'case-1', input: {} }],
      { threshold: 0.95 } // stricter threshold
    );

    expect(result.pass).toBe(false); // 0.91 < 0.95 → fail
  });

  it('uses default threshold 0.85 when opts omitted — 0.85 score passes', async () => {
    const fs = await import('node:fs');
    const fsp = await import('node:fs/promises');

    const { computeHashTriplet } = await import('../../snapshot/engine.js');

    const fn = createPromptFn({
      name: 'default-threshold-test',
      prompt: () => 'Summarize.',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ summary: z.string() }) as unknown as z4.$ZodType,
      adapter,
    });

    const modelVersion = 'test-model-v1';
    const meta = fn[TIDEMARK_META] as Parameters<typeof computeHashTriplet>[0];
    const freshMeta = computeHashTriplet(meta, modelVersion);

    const existingSnapshot = {
      $meta: freshMeta,
      'case-1': { summary: { match: 'baseline' } },
    };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vi.mocked(fsp.readFile) as any).mockResolvedValue(JSON.stringify(existingSnapshot));

    adapter.enqueue({ text: '{"summary":"Good output"}', modelVersion });
    // Score at default threshold boundary: 0.85 >= 0.85 → pass
    adapter.enqueue({ text: '"score": 0.85, "reasoning": "Equivalent"}', modelVersion });

    const result = await callMatcher(
      {
        testPath: '/abs/test.test.ts',
        snapshotState: { snapshotUpdateState: 'new' },
      },
      fn,
      [{ name: 'case-1', input: {} }]
      // no opts → default threshold 0.85 (D-04)
    );

    expect(result.pass).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sampling gate tests (sample / every opts)
// ---------------------------------------------------------------------------

describe('toMatchTidemarkSnapshot — sampling gate (step 7)', () => {
  // Shared snapshot fixture: matching hashes so step 7 is reached (no hash drift)
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

    return { fn, modelVersion, fsp };
  }

  const state: StubMatcherState = {
    testPath: '/abs/test.test.ts',
    snapshotState: { snapshotUpdateState: 'new' },
  };

  it('sample: 0.0 — always skips LLM, passes silently', async () => {
    const { fn } = await setupMatchingSnapshot('sample-zero');
    // No responses enqueued — any LLM call would throw
    const result = await callMatcher(state, fn, [{ name: 'case-1', input: {} }], { sample: 0.0 });
    expect(result.pass).toBe(true);
    expect(adapter.calls).toHaveLength(0);
  });

  it('sample: 1.0 — always runs LLM', async () => {
    const { fn, modelVersion } = await setupMatchingSnapshot('sample-one');
    adapter.enqueue({ text: '{"score":42}', modelVersion }); // case execution
    const result = await callMatcher(state, fn, [{ name: 'case-1', input: {} }], { sample: 1.0 });
    expect(result.pass).toBe(true);
    expect(adapter.calls.length).toBeGreaterThan(0);
  });

  it('sample: 0.5, Math.random()=0.7 — skips (0.7 >= 0.5)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.7);
    const { fn } = await setupMatchingSnapshot('sample-half-skip');
    const result = await callMatcher(state, fn, [{ name: 'case-1', input: {} }], { sample: 0.5 });
    expect(result.pass).toBe(true);
    expect(adapter.calls).toHaveLength(0);
  });

  it('sample: 0.5, Math.random()=0.3 — runs (0.3 < 0.5)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.3);
    const { fn, modelVersion } = await setupMatchingSnapshot('sample-half-run');
    adapter.enqueue({ text: '{"score":42}', modelVersion });
    const result = await callMatcher(state, fn, [{ name: 'case-1', input: {} }], { sample: 0.5 });
    expect(adapter.calls.length).toBeGreaterThan(0);
    expect(result.pass).toBe(true);
  });

  it('every: 5, Math.random()=0.25 — skips (0.25 >= 1/5=0.2)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    const { fn } = await setupMatchingSnapshot('every-5-skip');
    const result = await callMatcher(state, fn, [{ name: 'case-1', input: {} }], { every: 5 });
    expect(result.pass).toBe(true);
    expect(adapter.calls).toHaveLength(0);
  });

  it('every: 5, Math.random()=0.15 — runs (0.15 < 1/5=0.2)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.15);
    const { fn, modelVersion } = await setupMatchingSnapshot('every-5-run');
    adapter.enqueue({ text: '{"score":42}', modelVersion });
    const result = await callMatcher(state, fn, [{ name: 'case-1', input: {} }], { every: 5 });
    expect(adapter.calls.length).toBeGreaterThan(0);
    expect(result.pass).toBe(true);
  });

  it('sample wins over every when both provided', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const { fn } = await setupMatchingSnapshot('sample-wins');
    // sample: 0.0 → always skip; every: 1 would always run if sample weren't checked first
    const result = await callMatcher(state, fn, [{ name: 'case-1', input: {} }], { sample: 0.0, every: 1 });
    expect(result.pass).toBe(true);
    expect(adapter.calls).toHaveLength(0);
  });

  it('CI mode ignores sample — step 5.5 returns before gate', async () => {
    const { fn } = await setupMatchingSnapshot('ci-ignores-sample');
    const ciState: StubMatcherState = { ...state, snapshotState: { snapshotUpdateState: 'none' } };
    const result = await callMatcher(ciState, fn, [{ name: 'case-1', input: {} }], { sample: 0.0 });
    expect(result.pass).toBe(true);
    expect(adapter.calls).toHaveLength(0);
  });

  it('first-run ignores sample — step 6 returns before gate', async () => {
    const fs = await import('node:fs');
    const fsp = await import('node:fs/promises');
    vi.mocked(fs.existsSync).mockReturnValue(false); // no snapshot
    const fn = createPromptFn({
      name: 'first-run-ignores-sample',
      prompt: () => 'Classify.',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ score: z.number() }) as unknown as z4.$ZodType,
      adapter,
    });
    adapter.enqueue({ text: '{"score":1}', modelVersion: 'v1' });
    const result = await callMatcher(state, fn, [{ name: 'case-1', input: {} }], { sample: 0.0 });
    expect(result.pass).toBe(true);
    expect(fsp.writeFile).toHaveBeenCalled(); // snapshot was written (step 6 ran)
  });

  it('sample > 1 clamped to 1.0 — always runs (Math.random=0.99 still < 1.0)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const { fn, modelVersion } = await setupMatchingSnapshot('sample-over-1');
    adapter.enqueue({ text: '{"score":42}', modelVersion });
    const result = await callMatcher(state, fn, [{ name: 'case-1', input: {} }], { sample: 2.0 });
    expect(adapter.calls.length).toBeGreaterThan(0);
    expect(result.pass).toBe(true);
  });

  it('every: 0 clamped to 1 — always runs (1/1=1.0, Math.random always < 1.0)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const { fn, modelVersion } = await setupMatchingSnapshot('every-zero');
    adapter.enqueue({ text: '{"score":42}', modelVersion });
    const result = await callMatcher(state, fn, [{ name: 'case-1', input: {} }], { every: 0 });
    expect(adapter.calls.length).toBeGreaterThan(0);
    expect(result.pass).toBe(true);
  });
});
