// src/snapshot/drift.ts
// Snapshot types, DriftReport, TidemarkSnapshotError — locked shapes from D-05/D-07/D-08
// Also exports formatDriftMessage for per-field drift attribution (SNAP-02, TEST-02)

import { createPatch } from 'diff';

// ---------------------------------------------------------------------------
// Core snapshot file types (D-05, D-08)
// ---------------------------------------------------------------------------

export interface SnapshotMeta {
  promptHash: string;
  schemaHash: string;
  modelHash: string;
  tidemarkVersion: string;
  createdAt: string; // ISO 8601
}

// D-07: string fields store verdict only; non-string fields store raw values.
// First run: string fields → { match: 'baseline' }
// Subsequent run: string fields → { match: 'judged', score: 0.91 } | { match: 'fail', ... }
//                 non-string → raw value (compared via deep equality, not stored as verdict)
export type FieldVerdict =
  | { match: 'baseline' }
  | { match: 'judged'; score: number }
  | { match: 'exact' }
  | { match: 'fail'; expected: unknown; received: unknown };

// A case entry maps field names to raw values (non-string) or FieldVerdict objects (string)
export type CaseEntry = Record<string, unknown>;

// D-08: full snapshot file shape — $meta at root, case entries at root level alongside $meta
export interface SnapshotFile {
  $meta: SnapshotMeta;
  [caseName: string]: SnapshotMeta | CaseEntry;
}

// ---------------------------------------------------------------------------
// DriftReport types (D-05 — hash triplet; TEST-02 — per-field attribution)
// ---------------------------------------------------------------------------

export interface FieldResult {
  fieldPath: string; // e.g. "summary" or "nested.field"
  mode: 'exact' | 'judged';
  status: 'pass' | 'fail';
  score?: number; // only for judged fields
  expected?: unknown; // only for exact-fail fields
  received?: unknown; // only for exact-fail fields
}

export interface DriftReport {
  hashChanged: { prompt: boolean; schema: boolean; model: boolean };
  cases: Array<{
    name: string;
    fields: FieldResult[];
  }>;
}

// ---------------------------------------------------------------------------
// TidemarkSnapshotError — thrown for duplicate case names (D-03),
// invalid case names (path-traversal guard), and malformed snapshot JSON.
// ---------------------------------------------------------------------------

export class TidemarkSnapshotError extends Error {
  override readonly name = 'TidemarkSnapshotError';

  constructor(message: string) {
    super(message);
    // Maintains proper prototype chain in transpiled environments
    Object.setPrototypeOf(this, TidemarkSnapshotError.prototype);
  }
}

// ---------------------------------------------------------------------------
// formatDriftMessage — pure formatting function (SNAP-02 / TEST-02)
// ---------------------------------------------------------------------------

/**
 * Format a DriftReport into a human-readable test failure message.
 *
 * Hash-change case: attributes which of prompt/schema/model hashes changed.
 * Field-drift case: per-field lines with mode, status, score, and unified diff for exact-fails.
 * All-pass / no-change case: returns '' (matcher uses pass=true so message is unused).
 *
 * TEST-02: never produces a raw output blob diff — only field-level attribution.
 * T-02-09: failure messages are developer-facing test output only; not persisted to snapshot.
 */
export function formatDriftMessage(report: DriftReport): string {
  const { hashChanged, cases } = report;

  // -------------------------------------------------------------------
  // 1. Hash-change attribution (SNAP-02)
  // -------------------------------------------------------------------
  const changedHashes: string[] = [];
  if (hashChanged.prompt) changedHashes.push('prompt hash changed');
  if (hashChanged.schema) changedHashes.push('schema hash changed');
  if (hashChanged.model) changedHashes.push('model hash changed');

  if (changedHashes.length > 0) {
    const changes = changedHashes.join(', ');
    return (
      `Snapshot drift: ${changes}.\n` +
      `Re-run with --update to accept the new baseline.`
    );
  }

  // -------------------------------------------------------------------
  // 2. Per-field drift output (TEST-02)
  // -------------------------------------------------------------------
  const lines: string[] = [];

  for (const caseEntry of cases) {
    const failingFields = caseEntry.fields.filter((f) => f.status === 'fail');
    if (failingFields.length === 0) continue;

    lines.push(`Case "${caseEntry.name}":`);

    for (const field of failingFields) {
      // Base line: fieldPath [mode] status
      let line = `  ${field.fieldPath} [${field.mode}] ${field.status}`;

      if (field.mode === 'judged' && field.score !== undefined) {
        line += ` score=${field.score}`;
      }

      lines.push(line);

      // Exact-mode fails: append a unified diff of expected vs received
      if (field.mode === 'exact' && field.status === 'fail') {
        const expectedStr =
          field.expected !== undefined ? String(field.expected) : '(undefined)';
        const receivedStr =
          field.received !== undefined ? String(field.received) : '(undefined)';

        // Use createPatch from the `diff` package (Claude's Discretion: createPatch)
        const patch = createPatch(
          field.fieldPath,
          expectedStr + '\n',
          receivedStr + '\n',
          'expected',
          'received'
        );
        // Trim the patch header lines (--- / +++ / @@ ...) and show just the diff body
        const patchLines = patch.split('\n').slice(4); // skip file header + hunk header
        const diffBody = patchLines.join('\n').trimEnd();
        if (diffBody) {
          lines.push(`    diff:`);
          for (const diffLine of diffBody.split('\n')) {
            lines.push(`    ${diffLine}`);
          }
        }
      }
    }
  }

  return lines.join('\n');
}
