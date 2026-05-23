// src/snapshot/engine.ts
// Snapshot engine: path resolution, hash triplet, case execution, baseline write, read/write
// Implements SNAP-01/SNAP-02/SNAP-03

import type * as z4 from 'zod/v4/core';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { hashZodSchema, hashPromptFn, sortedKeys } from '../schema/hash.js';
import { walkZodDef } from '../schema/describe.js';
import type { TidemarkMeta } from '../core/meta.js';
import type { PromptFn } from '../core/factory.js';
import type { SnapshotFile, SnapshotMeta, CaseEntry } from './drift.js';
import { TidemarkSnapshotError } from './drift.js';

// ---------------------------------------------------------------------------
// Package version (for tidemarkVersion in $meta)
// ---------------------------------------------------------------------------

// Resolve package.json version at module initialization time
// Using createRequire to load JSON in an ESM/CJS-compatible way
const _require = createRequire(import.meta.url);
const _pkg = _require('../../package.json') as { version: string };
const TIDEMARK_VERSION: string = _pkg.version;

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Compute the path to the snapshot file for a given test file and function name.
 * SNAP-01: files land at <testFileDir>/__snapshots__/<fnName>.snap.json
 */
export function getSnapshotPath(testFilePath: string, fnName: string): string {
  return join(dirname(testFilePath), '__snapshots__', `${fnName}.snap.json`);
}

// ---------------------------------------------------------------------------
// Case name validation (T-02-01 — ASVS V5 path-traversal mitigation)
// ---------------------------------------------------------------------------

/**
 * Returns true only if the case name contains only [A-Za-z0-9_-].
 * Rejects empty strings, path separators, dots, and all other characters.
 */
export function isValidCaseName(name: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(name);
}

// ---------------------------------------------------------------------------
// Hash triplet computation (SNAP-02)
// ---------------------------------------------------------------------------

/**
 * Compute the (promptHash, schemaHash, modelHash, tidemarkVersion, createdAt) triplet.
 * modelVersion MUST come from a ProviderResponse — not assumed from TidemarkMeta (Pitfall 3).
 */
export function computeHashTriplet(
  meta: Pick<TidemarkMeta<z4.$ZodType, z4.$ZodType>, 'prompt' | 'outputSchema'>,
  modelVersion: string
): SnapshotMeta {
  return {
    promptHash: hashPromptFn(meta.prompt as (input: unknown) => string),
    schemaHash: hashZodSchema(meta.outputSchema),
    modelHash: createHash('sha256').update(modelVersion).digest('hex'),
    tidemarkVersion: TIDEMARK_VERSION,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Case runner (SNAP-02 — parallel adapter calls, Pattern 5)
// ---------------------------------------------------------------------------


/**
 * Run all test cases through the promptFn sequentially.
 * Calls fn(input) directly so snapshots capture production behaviour:
 * prompt rendering, schema injection, and retry loop are all included.
 * Validates: no duplicate names, all names pass isValidCaseName.
 * Returns parsed outputs (keyed by case name) and modelVersion from the first result.
 */
export async function runCases(
  fn: PromptFn<z4.$ZodType, z4.$ZodType>,
  cases: Array<{ name: string; input: unknown }>
): Promise<{ outputs: Map<string, unknown>; modelVersion: string }> {
  // D-03: check for duplicate case names before any adapter calls
  const nameSet = new Set<string>();
  for (const c of cases) {
    if (!isValidCaseName(c.name)) {
      throw new TidemarkSnapshotError(
        `Invalid case name: "${c.name}". Case names must match /^[A-Za-z0-9_-]+$/ (path-traversal guard).`
      );
    }
    if (nameSet.has(c.name)) {
      throw new TidemarkSnapshotError(
        `Duplicate case name: "${c.name}". Each case name must be unique within a toMatchSnapshot call (D-03).`
      );
    }
    nameSet.add(c.name);
  }

  const results: Awaited<ReturnType<typeof fn>>[] = [];
  for (const c of cases) {
    results.push(await fn(c.input as z4.output<z4.$ZodType>));
  }

  const outputs = new Map<string, unknown>();
  for (let i = 0; i < cases.length; i++) {
    outputs.set(cases[i].name, results[i].output);
  }

  const modelVersion = results[0].meta.modelVersion;

  return { outputs, modelVersion };
}

// ---------------------------------------------------------------------------
// Baseline snapshot builder (SNAP-01 / D-07 / D-11 — no judge on first run)
// ---------------------------------------------------------------------------

/**
 * Build a SnapshotFile from the parallel case outputs.
 * String fields → { match: 'baseline' } (D-07, D-11 — NO judge call on first run).
 * Non-string fields → raw parsed value (D-06).
 * Field type determined by walkZodDef on the output schema.
 */
export function buildBaselineSnapshot(
  meta: Pick<TidemarkMeta<z4.$ZodType, z4.$ZodType>, 'outputSchema'>,
  snapMeta: SnapshotMeta,
  outputs: Map<string, unknown>
): SnapshotFile {
  const result: SnapshotFile = { $meta: snapMeta };

  for (const [caseName, output] of outputs) {
    const caseEntry = buildBaselineCaseEntry(meta.outputSchema, output as Record<string, unknown>);
    result[caseName] = caseEntry;
  }

  return result;
}

/**
 * Walk the schema and the actual output together, producing a CaseEntry
 * where string-typed fields become { match: 'baseline' } and others are kept raw.
 */
function buildBaselineCaseEntry(
  schema: z4.$ZodType,
  output: Record<string, unknown>
): CaseEntry {
  const node = walkZodDef(schema);

  if (node.type !== 'object' || !node.shape) {
    // Top-level non-object: store as raw (edge case)
    return output as CaseEntry;
  }

  const entry: CaseEntry = {};

  for (const [fieldName, fieldNode] of Object.entries(node.shape)) {
    const rawValue = output[fieldName];

    // Determine if this field is string-typed (including optional/nullable wrapping)
    if (isStringNode(fieldNode)) {
      // D-07: string fields store verdict { match: 'baseline' } on first run (D-11)
      entry[fieldName] = { match: 'baseline' };
    } else {
      // D-06: non-string fields store raw value
      entry[fieldName] = rawValue;
    }
  }

  return entry;
}

/**
 * Check if a schema node ultimately represents a string type
 * (handles optional and nullable wrappers).
 */
function isStringNode(node: ReturnType<typeof walkZodDef>): boolean {
  if (node.type === 'string') return true;
  if ((node.type === 'optional' || node.type === 'nullable') && node.inner) {
    return isStringNode(node.inner);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Hash triplet comparison (SNAP-02 — per-hash drift attribution)
// ---------------------------------------------------------------------------

/**
 * Compare stored `$meta` hashes against freshly computed triplet.
 * Returns per-hash changed booleans (true = changed).
 * Pure function — no I/O.
 */
export function compareHashTriplet(
  stored: SnapshotMeta,
  fresh: SnapshotMeta
): { prompt: boolean; schema: boolean; model: boolean } {
  return {
    prompt: stored.promptHash !== fresh.promptHash,
    schema: stored.schemaHash !== fresh.schemaHash,
    model: stored.modelHash !== fresh.modelHash,
  };
}

// ---------------------------------------------------------------------------
// File I/O (SNAP-01 / SNAP-03)
// ---------------------------------------------------------------------------

/**
 * Read an existing snapshot file. Returns null if not found.
 * Throws TidemarkSnapshotError on malformed JSON (T-02-02 — Tampering/DoS mitigation).
 */
export async function readSnapshot(snapshotPath: string): Promise<SnapshotFile | null> {
  if (!existsSync(snapshotPath)) return null;
  const raw = await readFile(snapshotPath, 'utf-8');
  try {
    return JSON.parse(raw) as SnapshotFile;
  } catch (err) {
    throw new TidemarkSnapshotError(
      `Malformed snapshot JSON at "${snapshotPath}": ${(err as Error).message}`
    );
  }
}

/**
 * Write a snapshot file with deterministic alphabetical key order and trailing newline.
 * Creates the __snapshots__ directory if it doesn't exist (recursive mkdir).
 * SNAP-01: sortedKeys replacer ensures deterministic output (Pitfall 4).
 * SNAP-03: Tidemark owns the full JSON lifecycle — never delegates to Vitest native snapshot (D-16).
 */
export async function writeSnapshot(snapshotPath: string, data: SnapshotFile): Promise<void> {
  await mkdir(dirname(snapshotPath), { recursive: true });
  const json = JSON.stringify(data, sortedKeys, 2);
  await writeFile(snapshotPath, json + '\n', 'utf-8');
}
