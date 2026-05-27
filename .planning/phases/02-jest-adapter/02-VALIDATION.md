---
phase: 02
slug: jest-adapter
status: complete
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-27
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for the Jest adapter (JEST-01, JEST-02).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/jest/__tests__/` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~6 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/jest/__tests__/`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~6 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-T1 | 01 | 1 | JEST-01 | T-02-01, T-02-02, T-02-SC | Path-traversal guard via `isValidCaseName`; `_updateSnapshot` read-only cast | unit | `npx vitest run src/jest/__tests__/jest-adapter.vitest.test.ts` | ✅ | ✅ green |
| 02-01-T2 | 01 | 1 | JEST-01 | T-02-03 | D-11 CI shortcut: `_updateSnapshot === 'none'` + snapshot exists → zero LLM calls | unit | `npx vitest run src/jest/__tests__/jest-adapter.vitest.test.ts` | ✅ | ✅ green |
| 02-01-T3 | 01 | 1 | JEST-01 | — | Jest-syntax integration test uses `@jest/globals`, excluded from Vitest run | integration | `npm test` (file excluded, suite stays green) | ✅ | ✅ green |
| 02-02-T1 | 02 | 2 | JEST-02 | T-02-04 | `dist/jest/` artifacts exist; `dist/index.js` does not reference `jest/index` | build contract | `npx vitest run src/jest/__tests__/jest-build-contract.test.ts` | ✅ | ✅ green |
| 02-02-T2 | 02 | 2 | JEST-02 | T-02-05, T-02-06 | `./jest` export map correct; `jest` optional peer; `sideEffects` array preserves auto-registration | build contract | `npx vitest run src/jest/__tests__/jest-build-contract.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements — framework was already installed from Phase 1.

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Audit 2026-05-27

| Metric | Count |
|--------|-------|
| Gaps found | 1 |
| Resolved | 1 |
| Escalated | 0 |

**Gap resolved:** JEST-02 had no automated build contract test. Created `src/jest/__tests__/jest-build-contract.test.ts` (15 tests) verifying dist/jest artifacts, `./jest` export map, main bundle isolation, optional jest peer dep, and sideEffects array. All 418 tests pass post-fill.

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (none; existing infra used)
- [x] No watch-mode flags
- [x] Feedback latency < 6s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-27
