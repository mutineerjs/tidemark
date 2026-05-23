// src/vitest/index.ts
// Vitest matcher builder: expectPromptFn + tidemarkMatchers + module augmentation
// TEST-01: tidemark/vitest sub-package entry point

import type * as z4 from 'zod/v4/core';
import type { MatcherState } from 'vitest';
import { expect } from 'vitest';
import { TIDEMARK_META } from '../core/meta.js';
import type { PromptFn } from '../core/factory.js';
import {
  getSnapshotPath,
  computeHashTriplet,
  compareHashTriplet,
  runCases,
  buildBaselineSnapshot,
  readSnapshot,
  writeSnapshot,
} from '../snapshot/engine.js';
import { TidemarkSnapshotError } from '../snapshot/drift.js';
import type { DriftReport, CaseEntry } from '../snapshot/drift.js';
import { formatDriftMessage } from '../snapshot/drift.js';
import { evaluateFields } from '../snapshot/judge.js';

// ---------------------------------------------------------------------------
// TypeScript module augmentation — extends Vitest's Assertion interface
// Pattern 9 from 02-RESEARCH.md
// ---------------------------------------------------------------------------

declare module 'vitest' {
  interface Assertion<T> {
    toMatchTidemarkSnapshot(
      cases: Array<{ name: string; input: unknown }>,
      opts?: TidemarkMatcherOpts
    ): Promise<void>;
  }
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface TidemarkMatcherOpts {
  threshold?: number;
  sample?: number;
  every?: number;
}

// Intersection type rather than interface extension to avoid incompatibility
// with the full SnapshotState interface. We only need the properties we use.
type TidemarkMatcherState = MatcherState & {
  testPath?: string;
  snapshotState?: {
    snapshotUpdateState: 'all' | 'new' | 'none';
  };
};

// ---------------------------------------------------------------------------
// PromptFnWrapper — ergonomic builder (Pattern 2 from 02-RESEARCH.md)
// ---------------------------------------------------------------------------

class PromptFnWrapper<I extends z4.$ZodType, O extends z4.$ZodType> {
  readonly _fn: PromptFn<I, O>;

  constructor(fn: PromptFn<I, O>) {
    this._fn = fn;
  }

  toMatchSnapshot(
    cases: Array<{ name: string; input: z4.output<I> }>,
    opts?: TidemarkMatcherOpts
  ): Promise<void> {
    // The PromptFnWrapper instance is the `received` argument that Vitest passes
    // to the custom matcher (see Pattern 2). We call expect(this) to trigger it.
    return (
      expect(this) as unknown as {
        toMatchTidemarkSnapshot(
          cases: Array<{ name: string; input: z4.output<I> }>,
          opts?: TidemarkMatcherOpts
        ): Promise<void>;
      }
    ).toMatchTidemarkSnapshot(cases, opts);
  }
}

// ---------------------------------------------------------------------------
// expectPromptFn — user-facing builder (Pattern 2 from 02-RESEARCH.md)
// ---------------------------------------------------------------------------

export function expectPromptFn<I extends z4.$ZodType, O extends z4.$ZodType>(
  fn: PromptFn<I, O>
): PromptFnWrapper<I, O> {
  return new PromptFnWrapper(fn);
}

// ---------------------------------------------------------------------------
// shouldRunDriftCheck — sampling gate for step 7
// ---------------------------------------------------------------------------

function shouldRunDriftCheck(opts?: TidemarkMatcherOpts): boolean {
  if (opts?.sample !== undefined) {
    return Math.random() < Math.max(0, Math.min(1, opts.sample));
  }
  if (opts?.every !== undefined) {
    return Math.random() < 1 / Math.max(1, Math.round(opts.every));
  }
  return true;
}

// ---------------------------------------------------------------------------
// tidemarkMatchers — Vitest custom matchers (registered via expect.extend)
// Pattern 1 from 02-RESEARCH.md
// CRITICAL: Use method shorthand (NOT arrow function) so `this` is bound by Vitest
// Pitfall 2 from 02-RESEARCH.md
// ---------------------------------------------------------------------------

export const tidemarkMatchers = {
  async toMatchTidemarkSnapshot(
    this: TidemarkMatcherState,
    received: unknown,
    cases: Array<{ name: string; input: unknown }>,
    _opts?: TidemarkMatcherOpts
  ) {
    // ---------------------------------------------------------------------------
    // 1. Extract PromptFn from the wrapper
    // ---------------------------------------------------------------------------
    let fn: PromptFn<z4.$ZodType, z4.$ZodType>;

    if (received instanceof PromptFnWrapper) {
      fn = received._fn as PromptFn<z4.$ZodType, z4.$ZodType>;
    } else {
      // Received a PromptFn directly (less common)
      fn = received as PromptFn<z4.$ZodType, z4.$ZodType>;
    }

    // Read metadata from the PromptFn via TIDEMARK_META symbol
    const meta = fn[TIDEMARK_META];

    // ---------------------------------------------------------------------------
    // 2. Read Vitest state
    // ---------------------------------------------------------------------------
    const testFilePath = this.testPath ?? '';

    // A3 guard: snapshotState may be undefined outside Vitest test context
    const updateState = this.snapshotState?.snapshotUpdateState ?? 'new';

    // ---------------------------------------------------------------------------
    // 3. Compute snapshot path
    // ---------------------------------------------------------------------------
    const snapshotPath = getSnapshotPath(testFilePath, meta.name);

    // ---------------------------------------------------------------------------
    // 4. Read existing snapshot
    // ---------------------------------------------------------------------------
    const existing = await readSnapshot(snapshotPath);

    // ---------------------------------------------------------------------------
    // 5. CI mode: fail if no snapshot exists (Open Question 2 recommendation)
    // ---------------------------------------------------------------------------
    if (existing === null && updateState === 'none') {
      return {
        pass: false,
        message: () =>
          `No snapshot found for "${meta.name}". Run tests without --ci to create the baseline.`,
      };
    }

    // ---------------------------------------------------------------------------
    // 5.5. CI offline mode: snapshot exists, skip all LLM calls
    // ---------------------------------------------------------------------------
    // In CI (updateState === 'none'), trust the committed snapshot.
    // Drift detection is deliberate, not something that runs on every CI push.
    // This mirrors how Vitest's own CI snapshot mode works: existing snapshots
    // are authoritative; writing new ones is blocked.
    if (existing !== null && updateState === 'none') {
      return { pass: true, message: () => '' };
    }

    // ---------------------------------------------------------------------------
    // 6. First-run / regenerate path: existing === null OR updateState === 'all'
    // ---------------------------------------------------------------------------
    if (existing === null || updateState === 'all') {
      // Run all cases in parallel — NO judge calls on first run (D-11)
      const { outputs, modelVersion } = await runCases(fn, cases);

      // Compute hash triplet (modelVersion now available — Pitfall 3)
      const snapMeta = computeHashTriplet(meta, modelVersion);

      // Build baseline snapshot: string fields → { match: 'baseline' } (D-07)
      const snapFile = buildBaselineSnapshot(meta, snapMeta, outputs);

      // Write the snapshot file (SNAP-01: sorted keys, trailing newline)
      await writeSnapshot(snapshotPath, snapFile);

      return { pass: true, message: () => '' };
    }

    // ---------------------------------------------------------------------------
    // 7. Subsequent-run: drift comparison (SNAP-02, SNAP-04, TEST-02)
    // ---------------------------------------------------------------------------

    // Sampling gate: skip LLM calls probabilistically. Only reachable here —
    // steps 5, 5.5, and 6 all return before this point.
    if (!shouldRunDriftCheck(_opts)) {
      return { pass: true, message: () => '' };
    }

    try {
      // 7a. Run all cases in parallel to get fresh outputs
      const { outputs, modelVersion } = await runCases(fn, cases);

      // 7b. Compute fresh hash triplet and compare against stored hashes
      const freshSnapMeta = computeHashTriplet(meta, modelVersion);
      const hashChanged = compareHashTriplet(existing.$meta, freshSnapMeta);

      const anyHashChanged =
        hashChanged.prompt || hashChanged.schema || hashChanged.model;

      // 7c. Hash mismatch short-circuits: no judge calls (per RESEARCH diagram)
      if (anyHashChanged) {
        const report: DriftReport = {
          hashChanged,
          cases: [], // no field-level data on hash change
        };
        return {
          pass: false,
          message: () => formatDriftMessage(report),
        };
      }

      // 7d. No hash change: evaluate each case's fields via LLM judge + exact match
      const threshold = _opts?.threshold ?? 0.85; // D-04 default 0.85

      const caseResults: Array<{ name: string; fields: Awaited<ReturnType<typeof evaluateFields>> }> = [];
      for (const c of cases) {
        const freshOutput = outputs.get(c.name) as Record<string, unknown>;
        const storedEntry = existing[c.name] as CaseEntry | undefined;

        const fields = await evaluateFields(
          meta.adapter,
          meta.outputSchema,
          (storedEntry ?? {}) as Record<string, unknown>,
          freshOutput,
          threshold
        );

        caseResults.push({ name: c.name, fields });
      }

      // 7e. Build DriftReport and decide pass/fail
      const report: DriftReport = {
        hashChanged: { prompt: false, schema: false, model: false },
        cases: caseResults,
      };

      const allPass = caseResults.every((c) =>
        c.fields.every((f) => f.status === 'pass')
      );

      // 7f. Subsequent runs are read-only (D-16 lifecycle: only write on first run or --update)
      // Do NOT call writeSnapshot here.

      if (allPass) {
        return { pass: true, message: () => '' };
      }

      return {
        pass: false,
        message: () => formatDriftMessage(report),
      };
    } catch (err) {
      if (err instanceof TidemarkSnapshotError) {
        return {
          pass: false,
          message: () => (err as TidemarkSnapshotError).message,
        };
      }
      throw err;
    }
  },
};

expect.extend(tidemarkMatchers);
