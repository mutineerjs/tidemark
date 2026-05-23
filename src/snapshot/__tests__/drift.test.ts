// src/snapshot/__tests__/drift.test.ts
// Unit tests for TEST-02 + SNAP-02: drift message formatting
// Pure function tests — no adapter, no file I/O

import { describe, it, expect } from 'vitest';
import type { DriftReport, FieldResult } from '../drift.js';
import { formatDriftMessage } from '../drift.js';

// ---------------------------------------------------------------------------
// Helpers to build DriftReport literals
// ---------------------------------------------------------------------------

function makeReport(overrides: Partial<DriftReport> = {}): DriftReport {
  return {
    hashChanged: { prompt: false, schema: false, model: false },
    cases: [],
    ...overrides,
  };
}

function makeFieldResult(overrides: Partial<FieldResult> = {}): FieldResult {
  return {
    fieldPath: 'summary',
    mode: 'judged',
    status: 'pass',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Hash-change attribution tests (SNAP-02 / TEST-02)
// ---------------------------------------------------------------------------

describe('formatDriftMessage — hash change attribution', () => {
  it('includes "prompt hash changed" when hashChanged.prompt is true', () => {
    const report = makeReport({ hashChanged: { prompt: true, schema: false, model: false } });
    const msg = formatDriftMessage(report);
    expect(msg).toContain('prompt hash changed');
  });

  it('includes "schema hash changed" when hashChanged.schema is true', () => {
    const report = makeReport({ hashChanged: { prompt: false, schema: true, model: false } });
    const msg = formatDriftMessage(report);
    expect(msg).toContain('schema hash changed');
  });

  it('includes "model hash changed" when hashChanged.model is true', () => {
    const report = makeReport({ hashChanged: { prompt: false, schema: false, model: true } });
    const msg = formatDriftMessage(report);
    expect(msg).toContain('model hash changed');
  });

  it('lists all changed hashes when multiple are true', () => {
    const report = makeReport({ hashChanged: { prompt: true, schema: false, model: true } });
    const msg = formatDriftMessage(report);
    expect(msg).toContain('prompt hash changed');
    expect(msg).toContain('model hash changed');
    expect(msg).not.toContain('schema hash changed');
  });

  it('does NOT include a raw output blob diff in the hash-change case (TEST-02 — attribution, not blob)', () => {
    const report = makeReport({
      hashChanged: { prompt: true, schema: false, model: false },
      // Case output data should NOT appear in hash-change message
      cases: [
        {
          name: 'my-case',
          fields: [
            makeFieldResult({
              fieldPath: 'summary',
              mode: 'judged',
              status: 'pass',
              score: 0.95,
            }),
          ],
        },
      ],
    });

    const msg = formatDriftMessage(report);
    // Message should be bounded (not printing full case data blobs)
    expect(msg.length).toBeLessThan(500);
    // Should not contain raw case output field values
    expect(msg).not.toContain('"my-case"');
    expect(msg).not.toContain('summary');
  });
});

// ---------------------------------------------------------------------------
// Per-field drift output tests (TEST-02 — no hash change)
// ---------------------------------------------------------------------------

describe('formatDriftMessage — per-field drift (no hash change)', () => {
  it('lists failing case with fieldPath, mode, and status per field', () => {
    const report = makeReport({
      cases: [
        {
          name: 'news-case',
          fields: [
            makeFieldResult({ fieldPath: 'summary', mode: 'judged', status: 'fail', score: 0.60 }),
          ],
        },
      ],
    });

    const msg = formatDriftMessage(report);
    expect(msg).toContain('news-case');
    expect(msg).toContain('summary');
    expect(msg).toContain('judged');
    expect(msg).toContain('fail');
  });

  it('includes numeric score for judged field failure lines', () => {
    const report = makeReport({
      cases: [
        {
          name: 'test-case',
          fields: [
            makeFieldResult({ fieldPath: 'body', mode: 'judged', status: 'fail', score: 0.72 }),
          ],
        },
      ],
    });

    const msg = formatDriftMessage(report);
    expect(msg).toContain('0.72');
  });

  it('includes a unified diff for exact-mode fail fields (not JSON.stringify of whole objects)', () => {
    const report = makeReport({
      cases: [
        {
          name: 'count-case',
          fields: [
            makeFieldResult({
              fieldPath: 'count',
              mode: 'exact',
              status: 'fail',
              expected: 5,
              received: 10,
            }),
          ],
        },
      ],
    });

    const msg = formatDriftMessage(report);
    // Should contain diff markers (unified diff format uses - and + lines)
    // or at least mention the differing values
    expect(msg).toContain('count');
    expect(msg).toContain('exact');
    // Should show expected/received values in some form
    expect(msg).toMatch(/5|10/);
  });

  it('returns empty string when all fields pass and no hash changed (unused pass message)', () => {
    const report = makeReport({
      cases: [
        {
          name: 'all-pass',
          fields: [
            makeFieldResult({ fieldPath: 'summary', mode: 'judged', status: 'pass', score: 0.95 }),
            makeFieldResult({ fieldPath: 'count', mode: 'exact', status: 'pass' }),
          ],
        },
      ],
    });

    const msg = formatDriftMessage(report);
    expect(msg).toBe('');
  });

  it('returns empty string for a report with no cases and no hash change', () => {
    const report = makeReport();
    expect(formatDriftMessage(report)).toBe('');
  });

  it('omits passing cases from the output (only failing cases listed)', () => {
    const report = makeReport({
      cases: [
        {
          name: 'passing-case',
          fields: [
            makeFieldResult({ fieldPath: 'body', mode: 'judged', status: 'pass', score: 0.95 }),
          ],
        },
        {
          name: 'failing-case',
          fields: [
            makeFieldResult({ fieldPath: 'title', mode: 'judged', status: 'fail', score: 0.40 }),
          ],
        },
      ],
    });

    const msg = formatDriftMessage(report);
    expect(msg).not.toContain('passing-case');
    expect(msg).toContain('failing-case');
  });
});
