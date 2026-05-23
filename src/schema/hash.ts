// src/schema/hash.ts
// Deterministic schema and prompt hashing for Phase 2 snapshot drift detection
//
// Exported for Phase 2 snapshot drift detection (Integration Point).
//
// D-16: hashZodSchema MUST use the _zod.def tree walk (walkZodDef from describe.ts),
//   NOT JSON.stringify of the raw schema object and NOT z.toJSONSchema().
//   JSON.stringify of the raw schema silently drops transforms and refinements.
//   z.toJSONSchema() also drops transforms/refinements for the same reason.
//   Walking _zod.def gives a stable, transform-aware representation.

import type * as z4 from 'zod/v4/core';
import { createHash } from 'node:crypto';
import { walkZodDef } from './describe.js';

/**
 * Produce a deterministic SHA-256 hex hash of a Zod schema's _zod.def tree.
 *
 * Properties:
 * - Identical schema shape → identical hash (stable)
 * - Different field type → different hash (sensitive to type changes)
 * - Reordered object keys in the schema definition → identical hash (key-order deterministic)
 * - Transforms and refinements are reflected in the tree walk (not silently dropped)
 *
 * D-16: Uses walkZodDef() — NOT JSON.stringify(schema) or z.toJSONSchema(schema).
 *
 * @param schema - A Zod schema (v3 or v4, both handled by walkZodDef's runtime dispatch)
 * @returns 64-character lowercase hex SHA-256 string
 */
export function hashZodSchema(schema: z4.$ZodType): string {
  const description = walkZodDef(schema);
  // sortedKeys replacer ensures deterministic JSON output regardless of property insertion order
  const json = JSON.stringify(description, sortedKeys);
  return createHash('sha256').update(json).digest('hex');
}

/**
 * Produce a deterministic SHA-256 hex hash of a prompt template function's source code.
 *
 * Used by Phase 2 to detect prompt drift: if the prompt function body changes,
 * the hash changes, triggering a snapshot update requirement.
 *
 * @param prompt - The prompt template function (its .toString() is hashed)
 * @returns 64-character lowercase hex SHA-256 string
 */
export function hashPromptFn(prompt: (input: unknown) => string): string {
  return createHash('sha256').update(prompt.toString()).digest('hex');
}

/**
 * JSON.stringify replacer that sorts object keys alphabetically.
 *
 * Ensures deterministic JSON output regardless of the order in which properties
 * were added to objects during schema construction. Without this, two identical
 * schemas defined with different key insertion orders would produce different hashes.
 *
 * Applied recursively by JSON.stringify as it traverses the value tree.
 */
export function sortedKeys(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
        a.localeCompare(b)
      )
    );
  }
  return value;
}
