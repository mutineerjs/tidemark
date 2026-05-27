// src/jest/__tests__/jest-adapter.vitest.test.ts
// Vitest-runnable behavioral verification of the Jest adapter code path.
// Uses _updateSnapshot (JestMatcherState) stub to exercise the Jest code path
// under the existing Vitest runner — no real API keys, all I/O is mocked.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as z from 'zod';

import { createPromptFn } from '../../core/factory.js';
import { MockAdapter } from '../../adapters/mock.js';
import type { ConversationCase } from '../../types.js';

// ---------------------------------------------------------------------------
// Module mocks — declared at module level before imports
// ---------------------------------------------------------------------------
vi.mock('node:fs/promises');
vi.mock('node:fs');

// ---------------------------------------------------------------------------
// Import Jest adapter under test (deferred so mocks are applied first)
// Exercises the Jest code path (reads _updateSnapshot, not snapshotUpdateState)
// ---------------------------------------------------------------------------
const { expectPromptFn, expectConversation, tidemarkMatchers } = await import('../index.js');

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

async function callConversationMatcher(
  state: StubMatcherState,
  received: unknown,
  cases: ConversationCase[]
) {
  const matcherFn = tidemarkMatchers.toMatchConversationSnapshot;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return matcherFn.call(state as any, received, cases);
}

// ---------------------------------------------------------------------------
// Conversation fixtures (ported from conversation-matcher.test.ts)
// ---------------------------------------------------------------------------

function makeFns() {
  const extractFn = createPromptFn({
    name: 'extract-feedback-themes',
    prompt: (input: string) => `Extract themes from: ${input}`,
    inputSchema: z.string(),
    outputSchema: z.object({
      themes: z.array(z.string()),
      sentiment: z.string(),
    }),
    adapter,
  });

  const prioritizeFn = createPromptFn({
    name: 'prioritize-feedback-themes',
    prompt: (input: string) => `Prioritize: ${input}`,
    inputSchema: z.string(),
    outputSchema: z.object({
      ranked: z.array(
        z.object({
          theme: z.string(),
          priority: z.string(),
        })
      ),
    }),
    adapter,
  });

  return { extractFn, prioritizeFn };
}

function makeStandardCases(
  extractFn: ReturnType<typeof createPromptFn>,
  prioritizeFn: ReturnType<typeof createPromptFn>
): ConversationCase[] {
  return [
    {
      name: 'negative-feedback',
      steps: [
        { fn: extractFn, input: 'bad review' },
        { fn: prioritizeFn, input: 'prioritize these' },
      ],
    },
    {
      name: 'positive-feedback',
      steps: [
        { fn: extractFn, input: 'good review' },
        { fn: prioritizeFn, input: 'prioritize these' },
      ],
    },
  ];
}

function enqueue4Responses() {
  adapter
    .enqueue({ text: '{"themes":["slow service","rude staff"],"sentiment":"negative"}', modelVersion: 'test-model-v1' })
    .enqueue({ text: '{"ranked":[{"theme":"slow service","priority":"high"}]}', modelVersion: 'test-model-v1' })
    .enqueue({ text: '{"themes":["friendly staff","fast service"],"sentiment":"positive"}', modelVersion: 'test-model-v1' })
    .enqueue({ text: '{"ranked":[{"theme":"friendly staff","priority":"high"}]}', modelVersion: 'test-model-v1' });
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
// expectConversation first run (_updateSnapshot: 'new')
// ---------------------------------------------------------------------------

describe('toMatchConversationSnapshot — first run (_updateSnapshot: "new")', () => {
  it('pass: true, writeFile called once, $meta.turns length 2, fn-name keys (Format C)', async () => {
    const { extractFn, prioritizeFn } = makeFns();
    const cases = makeStandardCases(extractFn, prioritizeFn);
    enqueue4Responses();

    const newState: StubMatcherState = {
      testPath: '/project/src/__tests__/my.test.ts',
      snapshotState: { _updateSnapshot: 'new' },
    };

    const result = await callConversationMatcher(newState, expectConversation('my-conv'), cases);

    expect(result.pass).toBe(true);

    const fsp = await import('node:fs/promises');
    expect(vi.mocked(fsp.writeFile)).toHaveBeenCalledTimes(1);

    const writeCall = vi.mocked(fsp.writeFile).mock.calls[0];
    const writtenContent = writeCall[1] as string;
    const parsed = JSON.parse(writtenContent);

    // $meta.turns has one entry per step (2 steps)
    expect(parsed.$meta.turns).toHaveLength(2);

    // Case key exists, not positional
    expect(parsed['negative-feedback']).toBeDefined();

    // Keys inside the case entry are fn names, not "turn-1"
    const caseKeys = Object.keys(parsed['negative-feedback']);
    expect(caseKeys).toContain('extract-feedback-themes');
    expect(caseKeys).toContain('prioritize-feedback-themes');
    expect(caseKeys).not.toContain('turn-1');
  });
});

// ---------------------------------------------------------------------------
// expectConversation second run — hash match, read-only
// ---------------------------------------------------------------------------

describe('toMatchConversationSnapshot — second run (hash-match, read-only)', () => {
  it('pass: true, writeFile NOT called', async () => {
    const { extractFn, prioritizeFn } = makeFns();
    const cases = makeStandardCases(extractFn, prioritizeFn);

    const newState: StubMatcherState = {
      testPath: '/project/src/__tests__/my.test.ts',
      snapshotState: { _updateSnapshot: 'new' },
    };

    // First run: capture written snapshot content
    enqueue4Responses();
    await callConversationMatcher(newState, expectConversation('second-run-pass'), cases);

    const fsp = await import('node:fs/promises');
    const writeCall = vi.mocked(fsp.writeFile).mock.calls[0];
    const writtenContent = writeCall[1] as string;

    // Simulate second run: return same snapshot from readFile
    vi.clearAllMocks();
    vi.mocked(fsp.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsp.writeFile).mockResolvedValue(undefined);
    const fs = await import('node:fs');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vi.mocked(fsp.readFile) as any).mockResolvedValue(writtenContent);

    // Re-enqueue same responses for second run
    enqueue4Responses();

    const result = await callConversationMatcher(newState, expectConversation('second-run-pass'), cases);

    expect(result.pass).toBe(true);
    // Read-only: writeFile must NOT be called on second run
    expect(vi.mocked(fsp.writeFile)).not.toHaveBeenCalled();
  });
});
