---
phase: 02-jest-adapter
reviewed: 2026-05-27T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/jest/index.ts
  - src/jest/__tests__/jest-adapter.vitest.test.ts
  - src/jest/__tests__/matcher.test.ts
  - vitest.config.ts
  - tsup.config.ts
  - package.json
findings:
  critical: 2
  warning: 3
  info: 2
  total: 7
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-05-27T00:00:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

The Jest adapter (`src/jest/index.ts`) is a near-exact port of the Vitest adapter and shares its structural design. The core snapshot lifecycle (first-run baseline write, CI shortcut, subsequent-run hash comparison, field-level judge dispatch) appears correctly implemented. Two blockers were found: a missing null-guard on `fn[TIDEMARK_META]` that produces a raw unhandled `TypeError` instead of a descriptive error, and a typo in the auto-registration comment that will cause users to misconfigure Jest and silently prevent the adapter from being registered. Three warnings cover test coverage gaps in `jest-adapter.vitest.test.ts` (subsequent-run paths for `toMatchTidemarkSnapshot` are completely absent), an undeclared type-only peer dependency, and an unsafe type cast.

---

## Critical Issues

### CR-01: Missing null-guard on `fn[TIDEMARK_META]` produces an unhandled `TypeError`

**File:** `src/jest/index.ts:187-201`

**Issue:** At line 187, `const meta = fn[TIDEMARK_META]` reads the Tidemark metadata from the received function. If `received` is not a valid `createPromptFn` result — either because the user passed an arbitrary function or a non-PromptFnWrapper value — `meta` will be `undefined`. The first use of `meta` is at line 201: `getSnapshotPath(testFilePath, meta.name)`. This throws `TypeError: Cannot read properties of undefined (reading 'name')`, which propagates as an **unhandled async rejection** because it occurs before the `try { }` block that starts at line 259. Jest will surface this as an unhandled rejection rather than a clean test failure message, making it very hard to diagnose.

The same defect is present in `src/vitest/index.ts:168-181` (out of scope for this review, but the same fix applies).

**Fix:**
```typescript
// After line 187:
const meta = fn[TIDEMARK_META];
if (!meta) {
  return {
    pass: false,
    message: () =>
      'toMatchTidemarkSnapshot received a function without TIDEMARK_META. ' +
      'Did you pass a createPromptFn result? ' +
      'Direct functions are not supported — use createPromptFn() to build a PromptFn.',
  };
}
```

---

### CR-02: Comment says `setupFilesAfterFramework` — correct Jest config key is `setupFilesAfterEnv`

**File:** `src/jest/index.ts:451`

**Issue:** The comment that documents how to register the adapter reads:

```
// this file to setupFilesAfterFramework (D-10).
```

The Jest configuration key `setupFilesAfterFramework` does not exist. The correct key is `setupFilesAfterEnv`. If a user follows this comment and adds the path to `setupFilesAfterFramework` in their `jest.config.js`, the entry is silently ignored — the module is never imported at setup time, `expect.extend(tidemarkMatchers)` never runs, and all calls to `toMatchTidemarkSnapshot` will throw `TypeError: expect(...).toMatchTidemarkSnapshot is not a function`. This is a documentation bug with a high probability of causing hard-to-diagnose test failures in production usage.

**Fix:**
```typescript
// Auto-register matchers at module load time so users just need to add
// this file to setupFilesAfterEnv (D-10):
//
//   // jest.config.js
//   module.exports = { setupFilesAfterEnv: ['@mutineerjs/tidemark/jest'] };
```

---

## Warnings

### WR-01: `toMatchTidemarkSnapshot` subsequent-run paths are entirely untested in `jest-adapter.vitest.test.ts`

**File:** `src/jest/__tests__/jest-adapter.vitest.test.ts:166-338`

**Issue:** `jest-adapter.vitest.test.ts` covers the first-run path (step 6) and the CI shortcut (steps 5 and 5.5), but has **zero coverage** for the subsequent-run path (step 7). This means the following behaviours are not verified in any Vitest-runnable test for the Jest adapter:

- Hash mismatch short-circuit returns `pass: false` with a drift message.
- Field-level judge evaluation runs when hashes match (step 7d).
- `allPass` logic returns `pass: true` when all fields pass.
- Sampling gate (`sample` / `every` opts) skips LLM calls and returns `pass: true`.
- `TidemarkSnapshotError` catch block in step 7 wraps errors as `pass: false`.

By contrast, `src/vitest/__tests__/matcher.test.ts` has comprehensive coverage for all these paths (12+ test groups). The `src/jest/__tests__/matcher.test.ts` file is excluded from the Vitest runner and only runs under a real Jest installation. If a Jest installation is not present in CI, this coverage gap is never exercised.

**Fix:** Add a `describe('toMatchTidemarkSnapshot — subsequent run', ...)` block to `jest-adapter.vitest.test.ts` mirroring the analogous groups in `src/vitest/__tests__/matcher.test.ts` (lines 420–665 of that file) — at minimum: hash-changed fail, all-fields-pass, and sampling gate skip.

---

### WR-02: `@jest/expect` appears in the distributed `.d.ts` but is not declared as a peer dependency

**File:** `package.json:67-78` / `tsup.config.ts:11`

**Issue:** `src/jest/index.ts` imports `MatcherState` from `@jest/expect` as a type-only import (line 6). `tsup` correctly erases it from the JS bundle. However, it survives into the generated `dist/jest/index.d.ts`:

```typescript
import { MatcherState } from '@jest/expect';
```

Any consumer who type-checks against `tidemark/jest` must have `@jest/expect` resolvable in their `node_modules`. The `package.json` `peerDependencies` only declares `jest: >=29.0.0` — `@jest/expect` is not listed. In practice, `jest@29` depends on `@jest/expect`, so it is transitively available, but this is not guaranteed. A consumer using a future Jest version that restructures its internals, or one with a tight `shamefully-hoist: false` pnpm workspace, could encounter an unresolvable type import that breaks `tsc`.

Additionally, `@jest/expect` is absent from `tsup.config.ts`'s `external` list. This is harmless today (type-only import, nothing to bundle), but if the import ever becomes a value import, it would be silently bundled rather than treated as a peer.

**Fix:**
```json
// package.json peerDependencies
"@jest/expect": ">=29.0.0"
```
Or alternatively, replace `import type { MatcherState } from '@jest/expect'` with `import type { MatcherState } from '@jest/globals'` (which is already a declared devDependency) and add `'@jest/globals'` to `peerDependencies` in addition to `jest`. Also add `'@jest/expect'` to the `external` array in `tsup.config.ts` as a defensive measure.

---

### WR-03: Unsafe `as unknown as ConversationSnapshotFile` cast does not validate snapshot shape

**File:** `src/jest/index.ts:378`

**Issue:**

```typescript
const existingConv = existing as unknown as ConversationSnapshotFile | null;
```

`readSnapshot()` returns `SnapshotFile | null`. The cast to `ConversationSnapshotFile | null` is unchecked. If the snapshot file at this path was written by `toMatchTidemarkSnapshot` (a `SnapshotFile`, not a `ConversationSnapshotFile`), the hash comparisons at lines 418–420 would still work because both types share `promptHash`, `schemaHash`, and `modelHash` on `$meta`. However, `existingConv.$meta.turns` would be `undefined` — a silently wrong value if any future code reads it.

More importantly, if the JSON on disk is malformed or was written by a different tool version with a different `$meta` shape, `existingConv.$meta.promptHash` could be `undefined`, making all hash comparisons vacuously false (both sides `undefined`), causing a silent "no drift detected" pass on a corrupted snapshot.

**Fix:** Add a lightweight shape guard after the cast:

```typescript
const existingConv = existing as unknown as ConversationSnapshotFile | null;

// Guard: verify $meta shape is present before using it
if (existingConv !== null && (
  typeof existingConv.$meta?.promptHash !== 'string' ||
  typeof existingConv.$meta?.schemaHash !== 'string' ||
  typeof existingConv.$meta?.modelHash !== 'string'
)) {
  throw new TidemarkSnapshotError(
    `Conversation snapshot at "${snapshotPath}" has a malformed or missing $meta. ` +
    `Delete the file and re-run to regenerate.`
  );
}
```

---

## Info

### IN-01: `matcher.test.ts` is excluded from Vitest coverage tracking

**File:** `vitest.config.ts:8` / `src/jest/__tests__/matcher.test.ts`

**Issue:** `matcher.test.ts` is excluded from Vitest execution via `vitest.config.ts` (correct — it depends on `@jest/globals`). However, it is also excluded from coverage instrumentation by extension, meaning `npm run test:coverage` reports zero coverage for those test paths even though the file contains ~400 lines of test logic. The coverage report looks artificially high for `src/jest/index.ts` paths that are only exercised by `matcher.test.ts` running under Jest.

**Fix:** Document in `matcher.test.ts` header that a separate `jest:coverage` CI lane is needed for accurate coverage of `src/jest/index.ts` beyond what `jest-adapter.vitest.test.ts` provides. Alternatively, add a `test:jest` script to `package.json`:

```json
"test:jest": "jest --testPathPattern=src/jest/__tests__/matcher.test.ts"
```

---

### IN-02: `_opts` parameter shadowed as both unused and used in same matcher method

**File:** `src/jest/index.ts:172,255,283`

**Issue:** The parameter in the method signature is named `_opts` (line 172), following the TypeScript convention that a leading underscore signals "intentionally unused." But the parameter is actively used at line 255 (`shouldRunDriftCheck(_opts)`) and line 283 (`_opts?.threshold ?? 0.85`). This naming is misleading and would trigger a lint warning in strict projects that enforce `no-unused-vars` with `argsIgnorePattern: '^_'`.

**Fix:** Rename the parameter to `opts` to match its actual usage (consistent with the `TidemarkMatcherOpts` type and how the Vitest adapter names the same parameter).

```typescript
async toMatchTidemarkSnapshot(
  this: JestMatcherState,
  received: unknown,
  cases: Array<{ name: string; input: unknown }>,
  opts?: TidemarkMatcherOpts   // was _opts
)
```

---

_Reviewed: 2026-05-27T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
