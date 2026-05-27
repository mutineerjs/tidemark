// src/jest/__tests__/jest-build-contract.test.ts
// Behavioral contract test for JEST-02: opt-in sub-package export + bundle isolation.
// All checks are against actual disk state (dist/ artifacts, package.json).
// No mocks, no imports of the adapter itself — pure fs/JSON checks.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Use process.cwd() — Vitest runs from the project root and import.meta.dirname
// resolves to the CWD rather than the physical file directory in this config.
const ROOT = process.cwd();

// ---------------------------------------------------------------------------
// (1) dist/jest/ build artifacts exist
// ---------------------------------------------------------------------------

describe('JEST-02 — dist/jest build artifacts', () => {
  it('dist/jest/index.js (ESM entry) exists on disk', () => {
    const p = resolve(ROOT, 'dist/jest/index.js');
    expect(existsSync(p), `Expected ${p} to exist`).toBe(true);
  });

  it('dist/jest/index.cjs (CJS entry) exists on disk', () => {
    const p = resolve(ROOT, 'dist/jest/index.cjs');
    expect(existsSync(p), `Expected ${p} to exist`).toBe(true);
  });

  it('dist/jest/index.d.ts (type declarations) exists on disk', () => {
    const p = resolve(ROOT, 'dist/jest/index.d.ts');
    expect(existsSync(p), `Expected ${p} to exist`).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (2) package.json ./jest export map has correct types/import/require fields
// ---------------------------------------------------------------------------

describe('JEST-02 — package.json ./jest export map', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as Record<string, unknown>;
  const exports = pkg.exports as Record<string, Record<string, string>> | undefined;

  it('exports["./jest"] key exists', () => {
    expect(exports).toBeDefined();
    expect(exports!['./jest']).toBeDefined();
  });

  it('exports["./jest"].types is "./dist/jest/index.d.ts"', () => {
    expect(exports!['./jest'].types).toBe('./dist/jest/index.d.ts');
  });

  it('exports["./jest"].import is "./dist/jest/index.js"', () => {
    expect(exports!['./jest'].import).toBe('./dist/jest/index.js');
  });

  it('exports["./jest"].require is "./dist/jest/index.cjs"', () => {
    expect(exports!['./jest'].require).toBe('./dist/jest/index.cjs');
  });
});

// ---------------------------------------------------------------------------
// (3) main dist/index.js does NOT contain a "jest/index" reference (bundle isolation)
// ---------------------------------------------------------------------------

describe('JEST-02 — main bundle isolation', () => {
  it('dist/index.js does not contain any "jest/index" reference (adapter is tree-shaken from main bundle)', () => {
    const mainBundle = readFileSync(resolve(ROOT, 'dist/index.js'), 'utf-8');
    const occurrences = (mainBundle.match(/jest\/index/g) ?? []).length;
    expect(occurrences).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (4) package.json jest is an optional peer dependency
// ---------------------------------------------------------------------------

describe('JEST-02 — jest optional peer dependency', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as Record<string, unknown>;
  const peerDeps = pkg.peerDependencies as Record<string, string> | undefined;
  const peerMeta = pkg.peerDependenciesMeta as Record<string, Record<string, unknown>> | undefined;

  it('peerDependencies.jest is declared', () => {
    expect(peerDeps).toBeDefined();
    expect(peerDeps!['jest']).toBeDefined();
  });

  it('peerDependencies.jest matches ">=29.0.0"', () => {
    expect(peerDeps!['jest']).toBe('>=29.0.0');
  });

  it('peerDependenciesMeta.jest.optional is true', () => {
    expect(peerMeta).toBeDefined();
    expect(peerMeta!['jest']).toBeDefined();
    expect(peerMeta!['jest'].optional).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (5) package.json sideEffects array includes dist/jest entries
// ---------------------------------------------------------------------------

describe('JEST-02 — package.json sideEffects includes jest adapter entries', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as Record<string, unknown>;
  const sideEffects = pkg.sideEffects;

  it('sideEffects is an array (not false)', () => {
    expect(Array.isArray(sideEffects)).toBe(true);
  });

  it('sideEffects includes "./dist/jest/index.js"', () => {
    expect(sideEffects as string[]).toContain('./dist/jest/index.js');
  });

  it('sideEffects includes "./dist/jest/index.cjs"', () => {
    expect(sideEffects as string[]).toContain('./dist/jest/index.cjs');
  });

  it('sideEffects also retains vitest adapter entries (no regression)', () => {
    expect(sideEffects as string[]).toContain('./dist/vitest/index.js');
    expect(sideEffects as string[]).toContain('./dist/vitest/index.cjs');
  });
});
