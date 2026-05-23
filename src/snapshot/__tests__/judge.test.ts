// src/snapshot/__tests__/judge.test.ts
// Unit tests for SNAP-04: field dispatch, LLM-as-judge, parallel evaluation
// Covers D-12 (type-driven default), D-13 (exact override), D-14 (nested recursion)

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as z from 'zod';
import type * as z4 from 'zod/v4/core';
import { MockAdapter } from '../../adapters/mock.js';

// ---------------------------------------------------------------------------
// Deferred import (ensure mocks are hoisted properly)
// ---------------------------------------------------------------------------
const {
  getFieldMatchMode,
  judgeStringField,
  evaluateFields,
  extractJudgeJson,
} = await import('../judge.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let adapter: MockAdapter;

beforeEach(() => {
  adapter = new MockAdapter();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// getFieldMatchMode — D-12: type-driven defaults
// ---------------------------------------------------------------------------

describe('getFieldMatchMode', () => {
  it('returns "judge" for z.string()', () => {
    expect(getFieldMatchMode(z.string() as unknown as z4.$ZodType)).toBe('judge');
  });

  it('returns "exact" for z.number()', () => {
    expect(getFieldMatchMode(z.number() as unknown as z4.$ZodType)).toBe('exact');
  });

  it('returns "exact" for z.boolean()', () => {
    expect(getFieldMatchMode(z.boolean() as unknown as z4.$ZodType)).toBe('exact');
  });

  it('returns "exact" for z.enum([...])', () => {
    expect(getFieldMatchMode(z.enum(['a', 'b', 'c']) as unknown as z4.$ZodType)).toBe('exact');
  });

  it('returns "exact" for z.string().describe("exact") — D-13 override', () => {
    expect(
      getFieldMatchMode(z.string().describe('exact') as unknown as z4.$ZodType)
    ).toBe('exact');
  });

  it('returns "judge" for z.string().describe("the summary") — non-"exact" description does not override', () => {
    expect(
      getFieldMatchMode(z.string().describe('the summary') as unknown as z4.$ZodType)
    ).toBe('judge');
  });
});

// ---------------------------------------------------------------------------
// extractJudgeJson — parsing strategies (fence-stripping, brace extraction)
// These test extractJudgeJson in isolation; judgeStringField uses assistant
// prefill so fenced responses cannot occur in practice, but the helper should
// remain robust for defensive-programming reasons.
// ---------------------------------------------------------------------------

describe('extractJudgeJson', () => {
  it('parses bare JSON', () => {
    const result = extractJudgeJson('{"score": 0.91, "reasoning": "match"}') as { score: number };
    expect(result.score).toBe(0.91);
  });

  it('parses a fenced ```json response', () => {
    const result = extractJudgeJson(
      '```json\n{"score": 0.95, "reasoning": "Near identical"}\n```'
    ) as { score: number };
    expect(result.score).toBe(0.95);
  });

  it('parses a fenced response without language tag', () => {
    const result = extractJudgeJson(
      '```\n{"score": 0.88, "reasoning": "Equivalent"}\n```'
    ) as { score: number };
    expect(result.score).toBe(0.88);
  });

  it('parses a fenced response surrounded by leading/trailing prose', () => {
    const result = extractJudgeJson(
      'Here is my evaluation:\n```json\n{"score": 0.92, "reasoning": "Similar"}\n```\nThat is my assessment.'
    ) as { score: number };
    expect(result.score).toBe(0.92);
  });

  it('throws SyntaxError when all strategies fail', () => {
    expect(() => extractJudgeJson('NOT VALID JSON AT ALL')).toThrow(SyntaxError);
  });
});

// ---------------------------------------------------------------------------
// judgeStringField — adapter-based judge call and score parsing
// Mock adapter returns the continuation text after the prefill "{"; production
// code prepends "{" before calling extractJudgeJson.
// ---------------------------------------------------------------------------

describe('judgeStringField', () => {
  it('parses continuation text into { mode: "judged", score: 0.91 }', async () => {
    // Enqueue the continuation after the prefill "{":
    adapter.enqueue({
      text: '"score": 0.91, "reasoning": "Nearly identical meaning"}',
      modelVersion: 'judge-model-v1',
    });

    const result = await judgeStringField(
      adapter,
      'summary',
      'spec description',
      'The report is excellent',
      0.85
    );

    expect(result.fieldPath).toBe('summary');
    expect(result.mode).toBe('judged');
    expect(result.score).toBe(0.91);
    expect(result.status).toBe('pass'); // 0.91 >= 0.85
  });

  it('returns status "pass" when score >= threshold', async () => {
    adapter.enqueue({ text: '"score": 0.85, "reasoning": "Equivalent"}', modelVersion: 'v1' });
    const result = await judgeStringField(adapter, 'text', undefined, 'hello', 0.85);
    expect(result.status).toBe('pass');
  });

  it('returns status "fail" when score < threshold', async () => {
    adapter.enqueue({ text: '"score": 0.70, "reasoning": "Different"}', modelVersion: 'v1' });
    const result = await judgeStringField(adapter, 'text', undefined, 'hello', 0.85);
    expect(result.status).toBe('fail');
    expect(result.score).toBe(0.70);
  });

  it('returns score 0.0 and console.warn when adapter output has no score (A1 fallback)', async () => {
    adapter.enqueue({ text: 'NOT VALID JSON', modelVersion: 'v1' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await judgeStringField(adapter, 'summary', undefined, 'some value', 0.85);

    expect(result.score).toBe(0.0);
    expect(result.status).toBe('fail');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('uses regex fallback when reasoning contains unescaped quotes that break JSON parsing', async () => {
    // Model includes the actual value verbatim in reasoning without escaping quotes — malformed JSON.
    adapter.enqueue({
      text: '"score": 0.95, "reasoning": "The value "Researchers at Stanford..." is a valid title."}',
      modelVersion: 'v1',
    });

    const result = await judgeStringField(adapter, 'title', 'article title', 'Researchers at Stanford...', 0.85);

    expect(result.score).toBe(0.95);
    expect(result.status).toBe('pass');
    expect(result.mode).toBe('judged');
  });
});

// ---------------------------------------------------------------------------
// evaluateFields — field dispatch and parallelism
// ---------------------------------------------------------------------------

describe('evaluateFields', () => {
  it('judges string field and exact-matches number field — assert adapter.calls.length === 1', async () => {
    // Enqueue one judge response for the string field (continuation after prefill "{")
    adapter.enqueue({
      text: '"score": 0.92, "reasoning": "Equivalent"}',
      modelVersion: 'v1',
    });

    const schema = z.object({
      summary: z.string(),
      confidence: z.number(),
    }) as unknown as z4.$ZodType;

    const baselineEntry = {
      summary: { match: 'baseline' as const },
      confidence: 0.9,
    };

    const newOutput = { summary: 'Great article', confidence: 0.9 };

    const results = await evaluateFields(adapter, schema, baselineEntry, newOutput, 0.85);

    // Exactly 1 adapter call — only for the string 'summary' field (D-12: no judge on number)
    expect(adapter.calls).toHaveLength(1);

    const summaryResult = results.find((r) => r.fieldPath === 'summary');
    expect(summaryResult).toBeDefined();
    expect(summaryResult?.mode).toBe('judged');
    expect(summaryResult?.status).toBe('pass');

    const confidenceResult = results.find((r) => r.fieldPath === 'confidence');
    expect(confidenceResult).toBeDefined();
    expect(confidenceResult?.mode).toBe('exact');
    expect(confidenceResult?.status).toBe('pass');
  });

  it('runs judge calls for multiple string fields in parallel (Promise.all — all enqueued responses consumed)', async () => {
    // Two string fields → two judge calls (continuations after prefill "{")
    adapter
      .enqueue({ text: '"score": 0.91, "reasoning": "..."}', modelVersion: 'v1' })
      .enqueue({ text: '"score": 0.88, "reasoning": "..."}', modelVersion: 'v1' });

    const schema = z.object({
      title: z.string(),
      body: z.string(),
    }) as unknown as z4.$ZodType;

    const baselineEntry = {
      title: { match: 'baseline' as const },
      body: { match: 'baseline' as const },
    };

    const newOutput = { title: 'Hello world', body: 'Full article text here' };

    const results = await evaluateFields(adapter, schema, baselineEntry, newOutput, 0.85);

    // Both judge responses should have been consumed (parallelism via Promise.all)
    expect(adapter.calls).toHaveLength(2);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.mode === 'judged')).toBe(true);
    expect(results.every((r) => r.status === 'pass')).toBe(true);
  });

  it('resolves nested object fields with dotted fieldPath (e.g. "meta.note")', async () => {
    adapter.enqueue({ text: '"score": 0.95, "reasoning": "Same"}', modelVersion: 'v1' });

    const schema = z.object({
      meta: z.object({
        note: z.string(),
        n: z.number(),
      }),
    }) as unknown as z4.$ZodType;

    const baselineEntry = {
      meta: {
        note: { match: 'baseline' as const },
        n: 42,
      },
    };

    const newOutput = { meta: { note: 'An important note', n: 42 } };

    const results = await evaluateFields(adapter, schema, baselineEntry, newOutput, 0.85);

    // Only 1 adapter call (for meta.note) — meta.n is exact-matched (number)
    expect(adapter.calls).toHaveLength(1);

    const noteResult = results.find((r) => r.fieldPath === 'meta.note');
    expect(noteResult).toBeDefined();
    expect(noteResult?.mode).toBe('judged');

    const nResult = results.find((r) => r.fieldPath === 'meta.n');
    expect(nResult).toBeDefined();
    expect(nResult?.mode).toBe('exact');
  });

  it('judges each element of z.array(z.string()) — passes only if all element scores >= threshold', async () => {
    // Two array elements → two judge calls
    adapter
      .enqueue({ text: '"score": 0.90, "reasoning": "..."}', modelVersion: 'v1' })
      .enqueue({ text: '"score": 0.70, "reasoning": "..."}', modelVersion: 'v1' });

    const schema = z.object({
      tags: z.array(z.string()),
    }) as unknown as z4.$ZodType;

    const baselineEntry = {
      tags: [{ match: 'baseline' as const }, { match: 'baseline' as const }],
    };

    const newOutput = { tags: ['tech', 'different-tag'] };

    const results = await evaluateFields(adapter, schema, baselineEntry, newOutput, 0.85);

    // tags field should be 'fail' because the second element scored 0.70 < 0.85
    const tagsResult = results.find((r) => r.fieldPath === 'tags');
    expect(tagsResult).toBeDefined();
    expect(tagsResult?.mode).toBe('judged');
    expect(tagsResult?.status).toBe('fail');
  });

  it('uses deep array equality for z.array(z.number()) — no judge call', async () => {
    const schema = z.object({
      scores: z.array(z.number()),
    }) as unknown as z4.$ZodType;

    const baselineEntry = {
      scores: [1, 2, 3],
    };

    const newOutput = { scores: [1, 2, 3] };

    const results = await evaluateFields(adapter, schema, baselineEntry, newOutput, 0.85);

    // No judge calls — array of numbers uses deep equality
    expect(adapter.calls).toHaveLength(0);

    const scoresResult = results.find((r) => r.fieldPath === 'scores');
    expect(scoresResult).toBeDefined();
    expect(scoresResult?.mode).toBe('exact');
    expect(scoresResult?.status).toBe('pass');
  });

  it('returns status "fail" for judged field with score < threshold', async () => {
    adapter.enqueue({ text: '"score": 0.50, "reasoning": "Very different"}', modelVersion: 'v1' });

    const schema = z.object({
      summary: z.string(),
    }) as unknown as z4.$ZodType;

    const baselineEntry = { summary: { match: 'baseline' as const } };
    const newOutput = { summary: 'Completely different content' };

    const results = await evaluateFields(adapter, schema, baselineEntry, newOutput, 0.85);

    const summaryResult = results.find((r) => r.fieldPath === 'summary');
    expect(summaryResult?.status).toBe('fail');
  });

  it('returns status "fail" with expected/received for exact field whose value differs', async () => {
    const schema = z.object({
      count: z.number(),
    }) as unknown as z4.$ZodType;

    const baselineEntry = { count: 5 };
    const newOutput = { count: 10 };

    const results = await evaluateFields(adapter, schema, baselineEntry, newOutput, 0.85);

    const countResult = results.find((r) => r.fieldPath === 'count');
    expect(countResult?.status).toBe('fail');
    expect(countResult?.mode).toBe('exact');
    expect(countResult?.expected).toBe(5);
    expect(countResult?.received).toBe(10);
  });
});
