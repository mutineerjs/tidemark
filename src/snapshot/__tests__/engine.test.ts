// src/snapshot/__tests__/engine.test.ts
// Unit tests for SNAP-01/SNAP-02/SNAP-03 — snapshot engine path, hash, and I/O

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as z from 'zod';

import { MockAdapter } from '../../adapters/mock.js';
import { hashZodSchema, hashPromptFn } from '../../schema/hash.js';
import { createPromptFn } from '../../core/factory.js';
import type { TidemarkMeta } from '../../core/meta.js';
import type { SnapshotFile } from '../drift.js';
import { TidemarkSnapshotError } from '../drift.js';
import type * as z4 from 'zod/v4/core';

// ---------------------------------------------------------------------------
// Module mocks must be declared at module level before any imports that use them
// ---------------------------------------------------------------------------
vi.mock('node:fs/promises');
vi.mock('node:fs');

// ---------------------------------------------------------------------------
// Helper: import the engine functions under test (deferred to avoid hoisting issues)
// ---------------------------------------------------------------------------
const {
  getSnapshotPath,
  isValidCaseName,
  computeHashTriplet,
  runCases,
  buildBaselineSnapshot,
  readSnapshot,
  writeSnapshot,
} = await import('../engine.js');

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function asMeta(obj: {
  name: string;
  prompt: (input: unknown) => string;
  inputSchema: z4.$ZodType;
  outputSchema: z4.$ZodType;
  adapter: MockAdapter;
}): TidemarkMeta<z4.$ZodType, z4.$ZodType> {
  return obj as unknown as TidemarkMeta<z4.$ZodType, z4.$ZodType>;
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let adapter: MockAdapter;

beforeEach(async () => {
  adapter = new MockAdapter();
  // Reset mocks between tests
  vi.clearAllMocks();

  // Default fs mocks: file does not exist by default
  const fs = await import('node:fs');
  vi.mocked(fs.existsSync).mockReturnValue(false);

  const fsp = await import('node:fs/promises');
  vi.mocked(fsp.mkdir).mockResolvedValue(undefined);
  vi.mocked(fsp.writeFile).mockResolvedValue(undefined);
  vi.mocked(fsp.readFile).mockRejectedValue(new Error('File not found'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// getSnapshotPath
// ---------------------------------------------------------------------------

describe('getSnapshotPath', () => {
  it('constructs __snapshots__/<name>.snap.json next to the test file', () => {
    const result = getSnapshotPath('/abs/dir/foo.test.ts', 'classify');
    expect(result).toBe('/abs/dir/__snapshots__/classify.snap.json');
  });

  it('works with nested directories', () => {
    const result = getSnapshotPath('/home/user/project/src/tests/my.test.ts', 'my-fn');
    expect(result).toBe('/home/user/project/src/tests/__snapshots__/my-fn.snap.json');
  });
});

// ---------------------------------------------------------------------------
// isValidCaseName
// ---------------------------------------------------------------------------

describe('isValidCaseName', () => {
  it('returns true for alphanumeric names', () => {
    expect(isValidCaseName('classifies-news')).toBe(true);
  });

  it('returns true for names with underscores', () => {
    expect(isValidCaseName('test_case_1')).toBe(true);
  });

  it('returns true for names with hyphens', () => {
    expect(isValidCaseName('my-test-case')).toBe(true);
  });

  it('returns true for uppercase letters', () => {
    expect(isValidCaseName('MyTestCase123')).toBe(true);
  });

  it('returns false for path traversal ../etc', () => {
    expect(isValidCaseName('../etc')).toBe(false);
  });

  it('returns false for names containing forward slash', () => {
    expect(isValidCaseName('a/b')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidCaseName('')).toBe(false);
  });

  it('returns false for names with spaces', () => {
    expect(isValidCaseName('test case')).toBe(false);
  });

  it('returns false for names with dots', () => {
    expect(isValidCaseName('test.case')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeHashTriplet
// ---------------------------------------------------------------------------

describe('computeHashTriplet', () => {
  it('returns promptHash equal to hashPromptFn(meta.prompt)', () => {
    const prompt = (input: { text: string }) => `Classify: ${input.text}`;
    const outputSchema = z.object({ category: z.string() });
    const meta = asMeta({
      name: 'test-fn',
      prompt: prompt as (input: unknown) => string,
      inputSchema: z.object({ text: z.string() }) as unknown as z4.$ZodType,
      outputSchema: outputSchema as unknown as z4.$ZodType,
      adapter,
    });
    const triplet = computeHashTriplet(meta, 'mock-model-v1');
    expect(triplet.promptHash).toBe(hashPromptFn(prompt as (input: unknown) => string));
  });

  it('returns schemaHash equal to hashZodSchema(meta.outputSchema)', () => {
    const outputSchema = z.object({ score: z.number() });
    const meta = asMeta({
      name: 'test-fn',
      prompt: () => 'test',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: outputSchema as unknown as z4.$ZodType,
      adapter,
    });
    const triplet = computeHashTriplet(meta, 'mock-model-v1');
    expect(triplet.schemaHash).toBe(hashZodSchema(outputSchema as unknown as z4.$ZodType));
  });

  it('returns modelHash as SHA-256 hex of the modelVersion string', async () => {
    const { createHash } = await import('node:crypto');
    const modelVersion = 'test-model-v2';
    const expectedModelHash = createHash('sha256').update(modelVersion).digest('hex');
    const meta = asMeta({
      name: 'test-fn',
      prompt: () => 'test',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ result: z.string() }) as unknown as z4.$ZodType,
      adapter,
    });
    const triplet = computeHashTriplet(meta, modelVersion);
    expect(triplet.modelHash).toBe(expectedModelHash);
  });

  it('returns tidemarkVersion as a semver string', () => {
    const meta = asMeta({
      name: 'test-fn',
      prompt: () => 'test',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ result: z.string() }) as unknown as z4.$ZodType,
      adapter,
    });
    const triplet = computeHashTriplet(meta, 'mock-model-v1');
    expect(triplet.tidemarkVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('returns createdAt as an ISO 8601 string', () => {
    const meta = asMeta({
      name: 'test-fn',
      prompt: () => 'test',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: z.object({ result: z.string() }) as unknown as z4.$ZodType,
      adapter,
    });
    const triplet = computeHashTriplet(meta, 'mock-model-v1');
    expect(() => new Date(triplet.createdAt)).not.toThrow();
    expect(triplet.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

// ---------------------------------------------------------------------------
// runCases
// ---------------------------------------------------------------------------

describe('runCases', () => {
  it('calls fn once per case (parallel)', async () => {
    adapter
      .enqueue({ text: '{"category":"news"}', modelVersion: 'test-model-v1' })
      .enqueue({ text: '{"category":"sports"}', modelVersion: 'test-model-v1' });

    const fn = createPromptFn({
      name: 'classify',
      prompt: () => 'Classify',
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.object({ category: z.string() }),
      adapter,
    });

    const result = await runCases(fn, [
      { name: 'news-case', input: { text: 'Breaking news' } },
      { name: 'sports-case', input: { text: 'Team wins' } },
    ]);
    expect(adapter.calls).toHaveLength(2);
    expect(result.outputs.size).toBe(2);
    expect(result.modelVersion).toBe('test-model-v1');
  });

  it('returns parsed outputs keyed by case name', async () => {
    adapter
      .enqueue({ text: '{"category":"news"}', modelVersion: 'test-model-v1' })
      .enqueue({ text: '{"category":"sports"}', modelVersion: 'test-model-v1' });

    const fn = createPromptFn({
      name: 'classify',
      prompt: () => 'Classify',
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.object({ category: z.string() }),
      adapter,
    });

    const result = await runCases(fn, [
      { name: 'news-case', input: { text: 'Breaking news' } },
      { name: 'sports-case', input: { text: 'Team wins' } },
    ]);
    expect(result.outputs.get('news-case')).toEqual({ category: 'news' });
    expect(result.outputs.get('sports-case')).toEqual({ category: 'sports' });
  });

  it('throws TidemarkSnapshotError for duplicate case names (D-03)', async () => {
    const fn = createPromptFn({
      name: 'classify',
      prompt: () => 'Classify',
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.object({ category: z.string() }),
      adapter,
    });

    const cases = [
      { name: 'same-name', input: { text: 'Breaking news' } },
      { name: 'same-name', input: { text: 'Team wins' } },
    ];

    await expect(runCases(fn, cases)).rejects.toBeInstanceOf(TidemarkSnapshotError);
    await expect(runCases(fn, cases)).rejects.toThrow(/duplicate/i);
  });

  it('throws TidemarkSnapshotError for invalid case names (path-traversal guard)', async () => {
    const fn = createPromptFn({
      name: 'classify',
      prompt: () => 'Classify',
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.object({ category: z.string() }),
      adapter,
    });

    await expect(runCases(fn, [{ name: '../etc', input: { text: 'Breaking news' } }]))
      .rejects.toBeInstanceOf(TidemarkSnapshotError);
    await expect(runCases(fn, [{ name: '../etc', input: { text: 'Breaking news' } }]))
      .rejects.toThrow(/invalid/i);
  });

  it('takes modelVersion from fn result (Pitfall 3)', async () => {
    adapter
      .enqueue({ text: '{"result":"a"}', modelVersion: 'correct-model-v3' })
      .enqueue({ text: '{"result":"b"}', modelVersion: 'correct-model-v3' });

    const fn = createPromptFn({
      name: 'test-fn',
      prompt: () => 'test',
      inputSchema: z.object({}),
      outputSchema: z.object({ result: z.string() }),
      adapter,
    });

    const result = await runCases(fn, [
      { name: 'case-a', input: {} },
      { name: 'case-b', input: {} },
    ]);

    expect(result.modelVersion).toBe('correct-model-v3');
  });
});

// ---------------------------------------------------------------------------
// buildBaselineSnapshot
// ---------------------------------------------------------------------------

describe('buildBaselineSnapshot', () => {
  it('maps string fields to { match: "baseline" } (D-07)', () => {
    const outputSchema = z.object({
      category: z.string(),
      confidence: z.number(),
    });

    const meta = asMeta({
      name: 'classify',
      prompt: () => 'test',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: outputSchema as unknown as z4.$ZodType,
      adapter,
    });

    const snapMeta = {
      promptHash: 'abc',
      schemaHash: 'def',
      modelHash: 'ghi',
      tidemarkVersion: '0.1.0',
      createdAt: '2026-05-19T12:00:00.000Z',
    };

    const outputs = new Map<string, unknown>([
      ['case-1', { category: 'news', confidence: 0.92 }],
    ]);

    const result = buildBaselineSnapshot(meta, snapMeta, outputs);

    expect(result.$meta).toEqual(snapMeta);
    const caseEntry = result['case-1'] as Record<string, unknown>;
    expect(caseEntry['category']).toEqual({ match: 'baseline' }); // string → baseline
    expect(caseEntry['confidence']).toBe(0.92); // number → raw value
  });

  it('stores non-string fields as raw values (D-06)', () => {
    const outputSchema = z.object({
      score: z.number(),
      active: z.boolean(),
      tags: z.array(z.string()),
    });

    const meta = asMeta({
      name: 'test-fn',
      prompt: () => 'test',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: outputSchema as unknown as z4.$ZodType,
      adapter,
    });

    const snapMeta = {
      promptHash: 'abc',
      schemaHash: 'def',
      modelHash: 'ghi',
      tidemarkVersion: '0.1.0',
      createdAt: '2026-05-19T12:00:00.000Z',
    };

    const outputs = new Map<string, unknown>([
      ['case-1', { score: 0.85, active: true, tags: ['tech', 'news'] }],
    ]);

    const result = buildBaselineSnapshot(meta, snapMeta, outputs);
    const caseEntry = result['case-1'] as Record<string, unknown>;
    expect(caseEntry['score']).toBe(0.85);
    expect(caseEntry['active']).toBe(true);
    expect(caseEntry['tags']).toEqual(['tech', 'news']);
  });

  it('assembles SnapshotFile with $meta and all case entries', () => {
    const outputSchema = z.object({ result: z.string() });
    const meta = asMeta({
      name: 'test-fn',
      prompt: () => 'test',
      inputSchema: z.object({}) as unknown as z4.$ZodType,
      outputSchema: outputSchema as unknown as z4.$ZodType,
      adapter,
    });

    const snapMeta = {
      promptHash: 'abc',
      schemaHash: 'def',
      modelHash: 'ghi',
      tidemarkVersion: '0.1.0',
      createdAt: '2026-05-19T12:00:00.000Z',
    };

    const outputs = new Map<string, unknown>([
      ['case-a', { result: 'hello' }],
      ['case-b', { result: 'world' }],
    ]);

    const result = buildBaselineSnapshot(meta, snapMeta, outputs);
    expect(result.$meta).toEqual(snapMeta);
    expect(result['case-a']).toBeDefined();
    expect(result['case-b']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// writeSnapshot
// ---------------------------------------------------------------------------

describe('writeSnapshot', () => {
  it('creates the __snapshots__ directory recursively', async () => {
    const fsp = await import('node:fs/promises');
    const data: SnapshotFile = {
      $meta: {
        promptHash: 'abc',
        schemaHash: 'def',
        modelHash: 'ghi',
        tidemarkVersion: '0.1.0',
        createdAt: '2026-05-19T12:00:00.000Z',
      },
    };

    await writeSnapshot('/abs/dir/__snapshots__/my-fn.snap.json', data);
    expect(fsp.mkdir).toHaveBeenCalledWith('/abs/dir/__snapshots__', { recursive: true });
  });

  it('writes JSON with sorted keys (SNAP-01 alphabetical order)', async () => {
    const fsp = await import('node:fs/promises');
    const data: SnapshotFile = {
      $meta: {
        promptHash: 'abc',
        schemaHash: 'def',
        modelHash: 'ghi',
        tidemarkVersion: '0.1.0',
        createdAt: '2026-05-19T12:00:00.000Z',
      },
      'z-case': { b: 1, a: 2 },
      'a-case': { z: 'last', a: 'first' },
    };

    await writeSnapshot('/abs/dir/__snapshots__/my-fn.snap.json', data);
    expect(fsp.writeFile).toHaveBeenCalled();

    const writeCall = vi.mocked(fsp.writeFile).mock.calls[0];
    const writtenContent = writeCall[1] as string;
    const parsed = JSON.parse(writtenContent);

    // Keys at the top level should be alphabetically sorted
    const topKeys = Object.keys(parsed);
    const sortedTopKeys = [...topKeys].sort();
    expect(topKeys).toEqual(sortedTopKeys);

    // $meta sorts before a-case and z-case ($ is before letters)
    expect(topKeys[0]).toBe('$meta');
  });

  it('writes with 2-space indentation', async () => {
    const fsp = await import('node:fs/promises');
    const data: SnapshotFile = {
      $meta: {
        promptHash: 'abc',
        schemaHash: 'def',
        modelHash: 'ghi',
        tidemarkVersion: '0.1.0',
        createdAt: '2026-05-19T12:00:00.000Z',
      },
    };

    await writeSnapshot('/abs/dir/__snapshots__/test.snap.json', data);
    const writeCall = vi.mocked(fsp.writeFile).mock.calls[0];
    const writtenContent = writeCall[1] as string;
    expect(writtenContent).toContain('  '); // indented with 2 spaces
  });

  it('writes file with trailing newline', async () => {
    const fsp = await import('node:fs/promises');
    const data: SnapshotFile = {
      $meta: {
        promptHash: 'abc',
        schemaHash: 'def',
        modelHash: 'ghi',
        tidemarkVersion: '0.1.0',
        createdAt: '2026-05-19T12:00:00.000Z',
      },
    };

    await writeSnapshot('/abs/dir/__snapshots__/test.snap.json', data);
    const writeCall = vi.mocked(fsp.writeFile).mock.calls[0];
    const writtenContent = writeCall[1] as string;
    expect(writtenContent.endsWith('\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// readSnapshot
// ---------------------------------------------------------------------------

describe('readSnapshot', () => {
  it('returns null when the file does not exist', async () => {
    const fs = await import('node:fs');
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = await readSnapshot('/nonexistent/__snapshots__/fn.snap.json');
    expect(result).toBeNull();
  });

  it('returns parsed SnapshotFile when file exists', async () => {
    const fs = await import('node:fs');
    const fsp = await import('node:fs/promises');

    const expected: SnapshotFile = {
      $meta: {
        promptHash: 'abc',
        schemaHash: 'def',
        modelHash: 'ghi',
        tidemarkVersion: '0.1.0',
        createdAt: '2026-05-19T12:00:00.000Z',
      },
    };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vi.mocked(fsp.readFile) as any).mockResolvedValue(JSON.stringify(expected));

    const result = await readSnapshot('/abs/__snapshots__/fn.snap.json');
    expect(result).toEqual(expected);
  });

  it('throws TidemarkSnapshotError on malformed JSON', async () => {
    const fs = await import('node:fs');
    const fsp = await import('node:fs/promises');

    vi.mocked(fs.existsSync).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vi.mocked(fsp.readFile) as any).mockResolvedValue('{ invalid json');

    await expect(readSnapshot('/abs/__snapshots__/fn.snap.json')).rejects.toBeInstanceOf(
      TidemarkSnapshotError
    );
  });
});
