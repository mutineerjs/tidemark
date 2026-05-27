---
phase: 02-jest-adapter
verified: 2026-05-27T09:50:00Z
status: gaps_found
score: 11/13 must-haves verified
overrides_applied: 0
gaps:
  - truth: "The Jest adapter reads Jest's this.snapshotState._updateSnapshot (not Vitest's snapshotUpdateState)"
    status: partial
    reason: "The code correctly reads _updateSnapshot at lines 196 and 367. However, the open code-review critical CR-01 (missing null-guard on fn[TIDEMARK_META]) means that if meta is undefined the matcher throws an unhandled TypeError before any _updateSnapshot logic runs — leaving one code path uncovered and untested."
    artifacts:
      - path: "src/jest/index.ts"
        issue: "Line 187: const meta = fn[TIDEMARK_META] — no null-guard. Line 201 uses meta.name unconditionally outside any try block. CR-01 from 02-REVIEW.md is unaddressed."
    missing:
      - "Add null-guard: if (!meta) return { pass: false, message: () => '...' } immediately after line 187"
  - truth: "@jest/globals is installed so src/jest/index.ts type-checks under tsc --noEmit"
    status: partial
    reason: "The code uses 'import type { MatcherState } from '@jest/expect'' (not '@jest/globals' as the plan stated). @jest/globals IS installed as a devDependency (^29.7.0), and @jest/expect is available transitively from it. tsc --noEmit exits 0, so type-checking passes. However, the comment at line 451 still says 'setupFilesAfterFramework' (a non-existent Jest config key) instead of 'setupFilesAfterEnv' — CR-02 from 02-REVIEW.md is unaddressed. This is a documentation bug that will cause silent misconfigurations for users."
    artifacts:
      - path: "src/jest/index.ts"
        issue: "Line 451 comment says 'setupFilesAfterFramework' — the correct Jest configuration key is 'setupFilesAfterEnv'. A user following this comment will misconfigure Jest and adapter auto-registration will silently fail."
    missing:
      - "Fix comment at line 451: 'setupFilesAfterFramework' -> 'setupFilesAfterEnv'"
---

# Phase 02: Jest Adapter Verification Report

**Phase Goal:** Developers on Jest can use `expectPromptFn` and `expectConversation` matchers via an opt-in `tidemark/jest` sub-package without affecting the primary Vitest entry point
**Verified:** 2026-05-27T09:50:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## ROADMAP Discrepancy Note

The current ROADMAP.md Phase 2 section describes "Drift Detection & Failure UX" (DRIFT-01/02/03), not the Jest adapter. However:

- `02-CONTEXT.md` explicitly references JEST-01, JEST-02 as Phase 2 content
- `REQUIREMENTS.md` maps JEST-01 and JEST-02 to Phase 2 with status "Complete"
- STATE.md records "Phase: 02 (jest-adapter) — EXECUTING"
- The ROADMAP.md overview notes decimal phases can be inserted between integers (2.1, 2.2)

**Conclusion:** The ROADMAP.md was updated after this phase and its Phase 2 details section no longer reflects the jest-adapter work. Must-haves are taken from PLAN frontmatter and REQUIREMENTS.md, which are consistent with each other. The ROADMAP inconsistency is a documentation issue, not a verification blocker.

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | `expectPromptFn` and `expectConversation` are importable from `src/jest/index.ts` | VERIFIED | Lines 116, 142: both exported functions present; 457-line file |
| 2 | The Jest adapter reads `this.snapshotState._updateSnapshot` (not Vitest's `snapshotUpdateState`) | PARTIAL | Lines 77, 196, 367: JestSnapshotState type and reads correct. CR-01: missing null-guard on `fn[TIDEMARK_META]` means unhandled TypeError on invalid input before `_updateSnapshot` logic |
| 3 | `expectPromptFn(fn).toMatchSnapshot(cases)` writes a baseline snapshot on first run using mocked fs | VERIFIED | 8 behavioral tests pass under Vitest; first-run write verified with mocked fs/node:fs/promises |
| 4 | `expectConversation(name).toMatchSnapshot(cases)` writes a Format C conversation snapshot on first run | VERIFIED | Behavioral test group "toMatchConversationSnapshot — first run": pass:true, writeFile called once, $meta.turns length 2, fn-name keys present |
| 5 | `@jest/globals` is installed so `src/jest/index.ts` type-checks under `tsc --noEmit` | PARTIAL | `@jest/globals@^29.7.0` in devDependencies; `tsc --noEmit` exits 0. Deviation: MatcherState imported from `@jest/expect` (not `@jest/globals`) — functional but differs from plan. Critical: comment at line 451 says `setupFilesAfterFramework` (non-existent key), not `setupFilesAfterEnv` — will cause silent user misconfiguration (CR-02) |
| 6 | `npm test` (vitest run) passes — the Jest-syntax test file does NOT break the Vitest suite | VERIFIED | 21 test files, 367 tests pass; `src/jest/__tests__/matcher.test.ts` excluded via vitest.config.ts |
| 7 | tsup builds a separate `dist/jest/index.{js,cjs,d.ts}` bundle without bundling jest or @jest/globals | VERIFIED | All three artifacts present; no `@jest/expect`/`jest` references bundled in dist/jest output |
| 8 | `package.json` exposes `./jest` as an opt-in sub-package export with types/import/require fields | VERIFIED | `exports['./jest']` has types/import/require all pointing to dist/jest/ |
| 9 | The main `tidemark` entry does not import or bundle the Jest adapter | VERIFIED | `grep -c "jest/index" dist/index.js` returns 0; vitest bundle also clean |
| 10 | `jest` is declared as an optional peer dependency (`>=29.0.0`) | VERIFIED | `peerDependencies.jest: ">=29.0.0"`, `peerDependenciesMeta.jest.optional: true` |
| 11 | `@jest/globals` is present as a devDependency so `src/jest/index.ts` type-checks and dts emit succeeds | VERIFIED | `devDependencies['@jest/globals']: "^29.7.0"`; `node_modules/@jest/globals` present |
| 12 | `package.json` `sideEffects` is an array listing adapter dist entries | VERIFIED | `sideEffects: ["./dist/jest/index.js", "./dist/jest/index.cjs", "./dist/vitest/index.js", "./dist/vitest/index.cjs"]` |
| 13 | `npm test` exits 0 after tsup config changes — no regression in Vitest suite | VERIFIED | 367/367 tests pass |

**Score:** 11/13 truths verified (2 partial = gaps)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/jest/index.ts` | Jest adapter — 380+ lines, exports expectPromptFn/expectConversation/tidemarkMatchers, reads _updateSnapshot, both module augmentations | VERIFIED (457 lines) | All exports present; JestSnapshotState type at line 77; both `declare global` and `declare module '@jest/expect'` augmentations; guard on expect.extend |
| `src/jest/__tests__/jest-adapter.vitest.test.ts` | Vitest-runnable behavioral test using _updateSnapshot stub | VERIFIED | Contains `_updateSnapshot`; imports from 'vitest'; 8 tests pass |
| `src/jest/__tests__/matcher.test.ts` | Jest-syntax integration test using @jest/globals | VERIFIED | Contains `from '@jest/globals'`; `jest.mock('node:fs/promises')`; `jest.mock('node:fs')`; contains `_updateSnapshot`; no `vi.` calls |
| `vitest.config.ts` | Excludes the Jest-syntax test from Vitest glob | VERIFIED | `exclude` array contains `'src/jest/__tests__/matcher.test.ts'` |
| `tsup.config.ts` | Includes `src/jest/index.ts` entry; externals include `jest` and `@jest/globals` | VERIFIED | Entry array contains `'src/jest/index.ts'`; external array contains `'jest'` and `'@jest/globals'` |
| `package.json` | `./jest` export, jest optional peer, sideEffects array | VERIFIED | All five changes from Plan 02-02 Task 2 present |
| `dist/jest/index.js` | Built ESM Jest adapter | VERIFIED | Present (26.70 KB per summary) |
| `dist/jest/index.cjs` | Built CJS Jest adapter | VERIFIED | Present |
| `dist/jest/index.d.ts` | Type declarations | VERIFIED | Present |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/jest/index.ts` | `src/snapshot/engine.ts` | `import { getSnapshotPath, runCases, ... }` | WIRED | Line 26: `from '../snapshot/engine.js'` — all 8 engine functions imported and used |
| `src/jest/index.ts` | `src/snapshot/conversation-engine.ts` | `import { runConversationCases, computeConversationHashes, buildConversationSnapshot }` | WIRED | Line 36: `from '../snapshot/conversation-engine.js'` — all 3 functions imported and used |
| `src/jest/index.ts` | `this.snapshotState._updateSnapshot` | JestSnapshotState cast | WIRED | Lines 77, 196, 367: type defined and read in both matchers |
| `package.json exports './jest'` | `dist/jest/index.js` | import field | WIRED | `"import": "./dist/jest/index.js"` |
| `tsup.config.ts entry` | `src/jest/index.ts` | entry array element | WIRED | `'src/jest/index.ts'` in entry array |

---

### Data-Flow Trace (Level 4)

Not applicable — this phase produces a test matcher library, not a data-rendering component. The behavioral tests verify data flow (snapshot written/read correctly) through mocked fs.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Jest adapter behavioral tests pass (8 tests) | `npx vitest run src/jest/__tests__/jest-adapter.vitest.test.ts` | 8/8 tests pass | PASS |
| Full test suite unaffected | `npm test` | 21 files, 367 tests pass | PASS |
| TypeScript compiles clean | `npx tsc --noEmit` | exit 0 | PASS |
| Main bundle isolation | `grep -c "jest/index" dist/index.js` | 0 | PASS |
| dist/jest artifacts present | `ls dist/jest/` | index.js, index.cjs, index.d.ts, source maps | PASS |

---

### Probe Execution

No probes defined or conventional probe scripts found for this phase. Step 7c: SKIPPED.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| JEST-01 | 02-01-PLAN.md | Jest adapter for `expectPromptFn` and `expectConversation` matchers importable from `tidemark/jest` | SATISFIED | `src/jest/index.ts` exports both; 8 behavioral tests verify behavior under mocked I/O |
| JEST-02 | 02-02-PLAN.md | Jest adapter available as opt-in sub-package export — does not increase main `tidemark` bundle size | SATISFIED | `./jest` export map entry present; `dist/index.js` contains no jest/index references; discrete dist/jest bundle |

No orphaned requirements for Phase 2 in REQUIREMENTS.md beyond JEST-01 and JEST-02 (REQUIREMENTS.md §Jest Adapter).

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/jest/index.ts` | 187 | `const meta = fn[TIDEMARK_META]` with no null-guard; `meta.name` used at line 201 outside any try block | BLOCKER (CR-01 from code review) | Unhandled TypeError instead of clean test failure when user passes non-PromptFn value. Identified in 02-REVIEW.md as critical, not fixed before phase submission. |
| `src/jest/index.ts` | 451 | Comment: `setupFilesAfterFramework` — non-existent Jest config key | WARNING (CR-02 from code review) | Users following this comment will silently misconfigure Jest; `expect.extend` never runs; all tidemark matchers throw `TypeError: expect(...).toMatchTidemarkSnapshot is not a function`. Identified in 02-REVIEW.md as critical, not fixed. |
| `src/jest/__tests__/jest-adapter.vitest.test.ts` | 166-338 | Zero coverage of subsequent-run path (step 7: hash mismatch, field-level judge, sampling gate) | WARNING (WR-01 from code review) | The `matcher.test.ts` Jest-syntax file covers these paths but cannot run under Vitest. If a Jest CI lane is never added, the subsequent-run code in the Jest adapter is never exercised in any automated test. |

---

### Human Verification Required

None — all key behaviors are covered by automated mocked tests. The Jest-syntax `matcher.test.ts` file is the only item requiring a live Jest runtime, and that is explicitly deferred by design (D-12).

---

## Gaps Summary

Two gaps block clean passage:

**Gap 1 — CR-01 (BLOCKER): Missing null-guard on `fn[TIDEMARK_META]`**

`src/jest/index.ts` line 187 reads `const meta = fn[TIDEMARK_META]` without checking if the result is defined. Line 201 then uses `meta.name` unconditionally, outside the `try` block at line 259. If a user passes a non-PromptFn value (e.g., a bare arrow function), the matcher throws a raw `TypeError: Cannot read properties of undefined (reading 'name')` — surfaced as an unhandled async rejection in Jest, not a clean `pass: false` with an instructive message. The identical defect exists in `src/vitest/index.ts` and was noted as out-of-scope by the reviewer, but it is in scope here as the jest adapter was submitted with the same bug. The fix is a 5-line null-guard returning `{ pass: false, message: () => '...' }`.

This was identified as a critical finding in `02-REVIEW.md` (CR-01, reviewed 2026-05-27) and was not addressed before phase submission.

**Gap 2 — CR-02 (WARNING): `setupFilesAfterFramework` typo in auto-registration comment**

`src/jest/index.ts` line 451 comment reads `setupFilesAfterFramework (D-10)`. The correct Jest configuration key is `setupFilesAfterEnv`. A user following this documentation will add the path to a non-existent config key, silently preventing adapter registration, and receive a cryptic `TypeError: expect(...).toMatchTidemarkSnapshot is not a function` error. The fix is changing `setupFilesAfterFramework` to `setupFilesAfterEnv` in the comment.

This was identified as a critical finding in `02-REVIEW.md` (CR-02, reviewed 2026-05-27) and was not addressed before phase submission.

**Root cause:** Both items were caught by the code reviewer (02-REVIEW.md, status: issues_found) but the phase was submitted for goal verification without addressing the review's critical findings.

---

_Verified: 2026-05-27T09:50:00Z_
_Verifier: Claude (gsd-verifier)_
