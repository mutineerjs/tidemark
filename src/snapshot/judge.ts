// src/snapshot/judge.ts
// Field dispatch + LLM-as-judge engine for drift comparison
// Implements SNAP-04 (LLM-as-judge), D-09 (adapter reuse), D-12 (type-driven dispatch),
// D-13 (exact override via .describe('exact')), D-14 (nested recursion + arrays)

import type * as z4 from 'zod/v4/core';
import deepEqual from 'fast-deep-equal';
import { walkZodDef, getFieldDescription } from '../schema/describe.js';
import type { ProviderAdapter } from '../adapters/interface.js';
import type { FieldResult } from './drift.js';

// ---------------------------------------------------------------------------
// Judge system prompt (D-10: hardcoded, no user customization in v0.1)
// 02-RESEARCH §Pattern 6 wording
// ---------------------------------------------------------------------------

const JUDGE_SYSTEM_PROMPT = `You are an LLM output quality judge. Given a field specification and an actual output value, evaluate whether the actual output is a valid and appropriate response for that field.

The specification describes the expected TYPE of content (e.g. "article title", "ISO date or empty string"). Do NOT compare the specification text against the output word-for-word. Instead ask: "Is this output a valid value for a field described as [specification]?"

Score 0.0 to 1.0:
- 1.0: Output is exactly what the specification calls for
- 0.8-0.99: Output closely matches the specification's requirements with only minor issues
- 0.5-0.79: Output partially meets the specification but is missing important aspects or has incorrect format
- 0.0-0.49: Output does not meet the specification (wrong content type, missing required information, or invalid format)

Respond with JSON only: { "score": <number 0.0-1.0>, "reasoning": "<one sentence>" }`;

// ---------------------------------------------------------------------------
// extractJudgeJson — strip markdown code fences before parsing
// ---------------------------------------------------------------------------

/**
 * Parse a JSON value from `text`, handling markdown code-fenced responses.
 *
 * Strategy (in order):
 * 1. Raw `JSON.parse(text)` — succeeds for bare-JSON responses (no regression).
 * 2. Strip an optional markdown code fence (``` or ```json) and retry.
 * 3. Extract the first `{`…last `}` substring and retry.
 * 4. If all attempts fail, rethrow so the caller's A1 fallback handles it.
 *
 * Pure and synchronous; no console output.
 */
export function extractJudgeJson(text: string): unknown {
  // Attempt 1: raw parse (handles bare JSON, no change from before)
  try {
    return JSON.parse(text);
  } catch {
    // fall through to fence-stripping attempts
  }

  // Attempt 2: strip markdown code fence (```[lang]\n...\n```)
  // Matches an optional opening fence with optional language token, then content, then closing fence.
  const fenceRegex = /^```(?:[a-zA-Z]*)\n([\s\S]*?)\n```$/m;
  const fenceMatch = fenceRegex.exec(text.trim());
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // fall through to brace extraction
    }
  }

  // Attempt 3: extract first { ... last } substring (handles fences with surrounding prose)
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {
      // fall through to rethrow
    }
  }

  // All attempts failed — rethrow for caller's A1 fallback
  throw new SyntaxError(`[extractJudgeJson] Unable to parse judge response as JSON: ${text.slice(0, 100)}`);
}

// ---------------------------------------------------------------------------
// getFieldMatchMode — D-12 type-driven dispatch; D-13 exact override
// ---------------------------------------------------------------------------

/**
 * Determine whether a field should be LLM-judged or exact-matched.
 *
 * D-13: if the field's .describe() annotation is exactly 'exact', return 'exact'.
 * D-12: type-driven default — string → 'judge', everything else → 'exact'.
 */
export function getFieldMatchMode(fieldSchema: z4.$ZodType): 'judge' | 'exact' {
  // D-13: check for user override annotation first
  const desc = getFieldDescription(fieldSchema);
  if (desc === 'exact') return 'exact';

  // D-12: type-driven default via walkZodDef
  const node = walkZodDef(fieldSchema);
  return node.type === 'string' ? 'judge' : 'exact';
}

// ---------------------------------------------------------------------------
// judgeStringField — single field LLM judge call
// ---------------------------------------------------------------------------

/**
 * Call the LLM adapter to score the semantic equivalence of a new string output
 * against the field's expected specification.
 *
 * Per D-07: snapshots store verdict only (no raw baseline string). The judge
 * therefore compares the new output against the field's .describe() spec text (D-18).
 * If no spec text is available, scores for non-emptiness (D-18 resolution).
 *
 * T-02-06: judge output parsed for numeric score only; reasoning string never executed.
 * A1 fallback: parse failure → score 0.0 + console.warn (fail-closed).
 */
export async function judgeStringField(
  adapter: ProviderAdapter,
  fieldName: string,
  fieldSpec: string | undefined,
  newValue: string,
  threshold: number
): Promise<FieldResult> {
  // D-18: if no fieldSpec available, score non-emptiness of the new value
  const specText = fieldSpec ?? '(none)';

  const userMessage = `Field specification: ${specText}\nActual output: ${newValue}\n\nDoes this output correctly fulfill the specification for the "${fieldName}" field?`;

  const response = await adapter.generate({
    system: JUDGE_SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: userMessage },
      { role: 'assistant', content: '{' },
    ],
  });

  // Prepend the prefill character so extractJudgeJson receives a complete JSON object.
  const responseText = '{' + response.text;

  // T-02-06: parse only score (numeric); reasoning is informational, never trusted
  let score = 0.0;
  let scoreExtracted = false;

  try {
    const parsed = extractJudgeJson(responseText) as unknown;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'score' in (parsed as object) &&
      typeof (parsed as Record<string, unknown>).score === 'number'
    ) {
      score = (parsed as { score: number }).score;
      scoreExtracted = true;
    }
  } catch {
    // fall through to regex fallback
  }

  if (!scoreExtracted) {
    // Regex fallback: model may produce malformed JSON (e.g. unescaped quotes in reasoning)
    // but the score number is still reliably present.
    const scoreMatch = /"score"\s*:\s*([0-9]+(?:\.[0-9]*)?)/.exec(responseText);
    if (scoreMatch) {
      const n = parseFloat(scoreMatch[1]);
      if (!isNaN(n)) {
        score = n;
        scoreExtracted = true;
      }
    }
  }

  if (!scoreExtracted) {
    // A1 fallback: neither JSON nor regex could extract a score
    console.warn(
      `[tidemark] Judge response for field "${fieldName}" did not contain a parseable score; defaulting to 0.0. Raw response: ${responseText.slice(0, 200)}`
    );
    score = 0.0;
  }

  return {
    fieldPath: fieldName,
    mode: 'judged',
    status: score >= threshold ? 'pass' : 'fail',
    score,
  };
}

// ---------------------------------------------------------------------------
// evaluateFields — walk outputSchema + dispatch + Promise.all parallelism
// ---------------------------------------------------------------------------

/**
 * Walk the outputSchema and evaluate each leaf field:
 * - mode 'judge': call judgeStringField (LLM eval against field spec)
 * - mode 'exact': compare via fast-deep-equal
 *
 * Judge calls run sequentially to avoid API rate limits.
 * Nested objects resolved with dotted fieldPath (D-14).
 * Arrays: string-element arrays judge each element; non-string arrays use deep equality.
 */
export async function evaluateFields(
  adapter: ProviderAdapter,
  outputSchema: z4.$ZodType,
  baselineEntry: Record<string, unknown>,
  newOutput: Record<string, unknown>,
  threshold: number
): Promise<FieldResult[]> {
  const taskFns: Array<() => Promise<FieldResult>> = [];

  collectFieldTasks(adapter, outputSchema, baselineEntry, newOutput, threshold, '', taskFns);

  const results: FieldResult[] = [];
  for (const taskFn of taskFns) {
    results.push(await taskFn());
  }
  return results;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect field evaluation tasks by walking the schema.
 * Mutates the `tasks` array to add Promises that resolve to FieldResult.
 */
function collectFieldTasks(
  adapter: ProviderAdapter,
  schema: z4.$ZodType,
  baselineEntry: Record<string, unknown>,
  newOutput: Record<string, unknown>,
  threshold: number,
  prefix: string,
  tasks: Array<() => Promise<FieldResult>>
): void {
  const node = walkZodDef(schema);

  if (node.type !== 'object' || !node.shape) {
    // Top-level non-object — treat as a single field
    const fieldPath = prefix || 'value';
    const mode = getFieldMatchMode(schema);

    if (mode === 'judge') {
      const fieldSpec = getFieldDescription(schema);
      const newVal = String(newOutput);
      tasks.push(() => judgeStringField(adapter, fieldPath, fieldSpec, newVal, threshold));
    } else {
      tasks.push(
        () => Promise.resolve(evaluateExactField(fieldPath, baselineEntry, newOutput))
      );
    }
    return;
  }

  // Object: walk each field in shape
  for (const [fieldName, fieldNode] of Object.entries(node.shape)) {
    const fieldPath = prefix ? `${prefix}.${fieldName}` : fieldName;

    // Access field schemas from the raw schema shape
    const rawSchema = schema as unknown as {
      _zod?: { def?: { shape?: Record<string, z4.$ZodType> } };
      _def?: { shape?: Record<string, z4.$ZodType> };
    };
    const shapeRecord =
      rawSchema._zod?.def?.shape ?? rawSchema._def?.shape ?? {};
    const fieldSchema = shapeRecord[fieldName] as z4.$ZodType | undefined;

    if (!fieldSchema) {
      // Skip unmapped fields gracefully
      continue;
    }

    const baselineVal = (baselineEntry as Record<string, unknown>)[fieldName];
    const newVal = (newOutput as Record<string, unknown>)[fieldName];

    if (fieldNode.type === 'object' && fieldNode.shape) {
      // Recurse into nested object
      collectFieldTasks(
        adapter,
        fieldSchema,
        (baselineVal ?? {}) as Record<string, unknown>,
        (newVal ?? {}) as Record<string, unknown>,
        threshold,
        fieldPath,
        tasks
      );
    } else if (fieldNode.type === 'array' && fieldNode.items) {
      // Array handling: judge if items are string-typed, else deep equality
      const itemSchema = getArrayItemSchema(fieldSchema);
      const itemNode = fieldNode.items;

      if (itemNode.type === 'string') {
        // Judge each element; overall field fails if any element score < threshold
        tasks.push(
          () => evaluateStringArray(adapter, fieldPath, itemSchema, baselineVal, newVal, threshold)
        );
      } else {
        // Non-string array: deep equality
        tasks.push(() => Promise.resolve(evaluateExactValue(fieldPath, baselineVal, newVal)));
      }
    } else {
      // Leaf field: dispatch by mode
      const mode = getFieldMatchMode(fieldSchema);

      if (mode === 'judge') {
        const fieldSpec = getFieldDescription(fieldSchema);
        const newStr = newVal !== undefined && newVal !== null ? String(newVal) : '';
        tasks.push(() => judgeStringField(adapter, fieldPath, fieldSpec, newStr, threshold));
      } else {
        // Exact match: compare baseline raw value vs new value
        // For non-string fields, baselineEntry stores raw values (D-06)
        tasks.push(() => Promise.resolve(evaluateExactValue(fieldPath, baselineVal, newVal)));
      }
    }
  }
}

/**
 * Evaluate an exact field: compare baseline vs new via fast-deep-equal.
 */
function evaluateExactValue(
  fieldPath: string,
  baselineVal: unknown,
  newVal: unknown
): FieldResult {
  const pass = deepEqual(baselineVal, newVal);
  return {
    fieldPath,
    mode: 'exact',
    status: pass ? 'pass' : 'fail',
    ...(pass ? {} : { expected: baselineVal, received: newVal }),
  };
}

/**
 * Evaluate an exact match for an object field (baseline entry uses the field name).
 */
function evaluateExactField(
  fieldPath: string,
  baselineEntry: Record<string, unknown>,
  newOutput: Record<string, unknown>
): FieldResult {
  const baselineVal = baselineEntry[fieldPath];
  const newVal = newOutput[fieldPath];
  return evaluateExactValue(fieldPath, baselineVal, newVal);
}

/**
 * Evaluate an array of string fields by judging each element individually.
 * Overall field passes only if all element scores >= threshold.
 */
async function evaluateStringArray(
  adapter: ProviderAdapter,
  fieldPath: string,
  _itemSchema: z4.$ZodType | undefined,
  _baselineVal: unknown,
  newVal: unknown,
  threshold: number
): Promise<FieldResult> {
  const newArray = Array.isArray(newVal) ? (newVal as unknown[]) : [];

  if (newArray.length === 0) {
    // Empty array: pass trivially
    return { fieldPath, mode: 'judged', status: 'pass', score: 1.0 };
  }

  const elementResults: FieldResult[] = [];
  for (let idx = 0; idx < newArray.length; idx++) {
    const element = newArray[idx];
    const result = await judgeStringField(
      adapter,
      `${fieldPath}[${idx}]`,
      undefined,
      element !== undefined && element !== null ? String(element) : '',
      threshold
    );
    elementResults.push(result);
  }
  const allPass = elementResults.every((r) => r.status === 'pass');
  const minScore = elementResults.reduce(
    (min, r) => Math.min(min, r.score ?? 0),
    1.0
  );

  return {
    fieldPath,
    mode: 'judged',
    status: allPass ? 'pass' : 'fail',
    score: minScore,
  };
}

/**
 * Extract the item schema from an array schema (for type dispatch).
 */
function getArrayItemSchema(arraySchema: z4.$ZodType): z4.$ZodType | undefined {
  const raw = arraySchema as unknown as {
    _zod?: { def?: { element?: z4.$ZodType; items?: z4.$ZodType } };
    _def?: { element?: z4.$ZodType; items?: z4.$ZodType };
  };
  return (
    raw._zod?.def?.element ??
    raw._zod?.def?.items ??
    raw._def?.element ??
    raw._def?.items
  );
}
