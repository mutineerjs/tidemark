// Tideline Benchmark — demonstrates 3 drift detection scenarios
// Run: npx tsx examples/benchmark.ts
// Note: Uses MockAdapter (no API key required) — pure drift detection simulation.

import { MockAdapter, TIDEMARK_META } from '../src/index.js';
import { createPromptFn } from '../src/index.js';
import {
  runCases,
  computeHashTriplet,
  compareHashTriplet,
  buildBaselineSnapshot,
  writeSnapshot,
  readSnapshot,
} from '../src/snapshot/engine.js';
import { formatDriftMessage } from '../src/snapshot/drift.js';
import * as z from 'zod';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_DIR = join(__dirname, '__snapshots__');

// ---------------------------------------------------------------------------
// Scenario 1: Prompt Hash Drift
//
// Demonstrates: changing the prompt string causes a promptHash mismatch.
// The same snapshot name ('bench-prompt-v1') is used with two different
// prompt functions — baseline written with v1, drift detected with v2.
// ---------------------------------------------------------------------------

async function scenario1(): Promise<void> {
  console.log('--- Scenario 1: Prompt Change Detection ---');

  const adapter = new MockAdapter();
  const outputSchema = z.object({
    category: z.enum(['billing', 'technical']).describe('category'),
  });

  // V1: baseline prompt
  const promptFnV1 = createPromptFn({
    name: 'bench-prompt-v1',
    prompt: () => 'Classify this message.',
    inputSchema: z.object({}),
    outputSchema,
    adapter,
  });

  // Write baseline — enqueue a deterministic response for the case run
  adapter.enqueue({ text: '{"category":"billing"}', modelVersion: 'mock-model-v1' });

  const metaV1 = promptFnV1[TIDEMARK_META];
  const { outputs: baselineOutputs, modelVersion: baselineModel } = await runCases(
    promptFnV1,
    [{ name: 'test-1', input: {} }]
  );
  const baselineMeta = computeHashTriplet(metaV1, baselineModel);
  const baselineSnap = buildBaselineSnapshot(metaV1, baselineMeta, baselineOutputs);
  const snapPath1 = join(SNAPSHOTS_DIR, 'bench-prompt-v1.snap.json');
  await writeSnapshot(snapPath1, baselineSnap);

  // V2: prompt text changed — same name, different prompt hash
  const promptFnV2 = createPromptFn({
    name: 'bench-prompt-v1',
    prompt: () => 'Classify this support message. Be concise.',
    inputSchema: z.object({}),
    outputSchema,
    adapter,
  });

  adapter.enqueue({ text: '{"category":"billing"}', modelVersion: 'mock-model-v1' });

  const metaV2 = promptFnV2[TIDEMARK_META];
  const { modelVersion: freshModel2 } = await runCases(
    promptFnV2,
    [{ name: 'test-1', input: {} }]
  );
  const freshMeta2 = computeHashTriplet(metaV2, freshModel2);

  const storedSnap1 = await readSnapshot(snapPath1);
  const changed1 = compareHashTriplet(storedSnap1!.$meta, freshMeta2);
  const message1 = formatDriftMessage({ hashChanged: changed1, cases: [] });

  console.log('Result:');
  console.log(message1);
  console.log();
}

// ---------------------------------------------------------------------------
// Scenario 2: Schema Hash Drift
//
// Demonstrates: adding a new field to the output schema causes a schemaHash
// mismatch. Same snapshot name, same prompt, different schema shape.
// ---------------------------------------------------------------------------

async function scenario2(): Promise<void> {
  console.log('--- Scenario 2: Schema Change Detection ---');

  const adapter = new MockAdapter();

  // V1: baseline schema — single field
  const outputSchemaV1 = z.object({
    category: z.enum(['billing', 'technical']),
  });

  const schemaFnV1 = createPromptFn({
    name: 'bench-schema-v1',
    prompt: () => 'Classify this message.',
    inputSchema: z.object({}),
    outputSchema: outputSchemaV1,
    adapter,
  });

  adapter.enqueue({ text: '{"category":"billing"}', modelVersion: 'mock-model-v1' });

  const metaS1 = schemaFnV1[TIDEMARK_META];
  const { outputs: baselineOutputs2, modelVersion: baselineModel2 } = await runCases(
    schemaFnV1,
    [{ name: 'test-1', input: {} }]
  );
  const baselineMeta2 = computeHashTriplet(metaS1, baselineModel2);
  const baselineSnap2 = buildBaselineSnapshot(metaS1, baselineMeta2, baselineOutputs2);
  const snapPath2 = join(SNAPSHOTS_DIR, 'bench-schema-v1.snap.json');
  await writeSnapshot(snapPath2, baselineSnap2);

  // V2: schema changed — added urgency field (different schema hash)
  const outputSchemaV2 = z.object({
    category: z.enum(['billing', 'technical']),
    urgency: z.number(),
  });

  const schemaFnV2 = createPromptFn({
    name: 'bench-schema-v1',
    prompt: () => 'Classify this message.',
    inputSchema: z.object({}),
    outputSchema: outputSchemaV2,
    adapter,
  });

  adapter.enqueue({
    text: '{"category":"billing","urgency":3}',
    modelVersion: 'mock-model-v1',
  });

  const metaS2 = schemaFnV2[TIDEMARK_META];
  const { modelVersion: freshModel3 } = await runCases(
    schemaFnV2,
    [{ name: 'test-1', input: {} }]
  );
  const freshMeta3 = computeHashTriplet(metaS2, freshModel3);

  const storedSnap2 = await readSnapshot(snapPath2);
  const changed2 = compareHashTriplet(storedSnap2!.$meta, freshMeta3);
  const message2 = formatDriftMessage({ hashChanged: changed2, cases: [] });

  console.log('Result:');
  console.log(message2);
  console.log();
}

// ---------------------------------------------------------------------------
// Scenario 3: Model Version Drift
//
// Demonstrates: when the resolved model version changes (e.g. a provider
// alias remaps to a newer concrete version), the modelHash changes.
// ---------------------------------------------------------------------------

async function scenario3(): Promise<void> {
  console.log('--- Scenario 3: Model Version Drift ---');

  const adapter = new MockAdapter();
  const outputSchema = z.object({
    category: z.enum(['billing', 'technical']),
  });

  const modelFnBase = createPromptFn({
    name: 'bench-model-v1',
    prompt: () => 'Classify this message.',
    inputSchema: z.object({}),
    outputSchema,
    adapter,
  });

  // Baseline: model resolves to claude-sonnet-4-5-20250929
  adapter.enqueue({
    text: '{"category":"billing"}',
    modelVersion: 'claude-sonnet-4-5-20250929',
  });

  const metaM = modelFnBase[TIDEMARK_META];
  const { outputs: baselineOutputs3, modelVersion: baselineModel3 } = await runCases(
    modelFnBase,
    [{ name: 'test-1', input: {} }]
  );
  const baselineMeta3 = computeHashTriplet(metaM, baselineModel3);
  const baselineSnap3 = buildBaselineSnapshot(metaM, baselineMeta3, baselineOutputs3);
  const snapPath3 = join(SNAPSHOTS_DIR, 'bench-model-v1.snap.json');
  await writeSnapshot(snapPath3, baselineSnap3);

  // Drift: model alias now resolves to claude-haiku-3-20240307
  adapter.enqueue({
    text: '{"category":"billing"}',
    modelVersion: 'claude-haiku-3-20240307',
  });

  // Same function meta, but the adapter returns a different modelVersion this time
  const { modelVersion: freshModel4 } = await runCases(
    modelFnBase,
    [{ name: 'test-1', input: {} }]
  );
  const freshMeta4 = computeHashTriplet(metaM, freshModel4);

  const storedSnap3 = await readSnapshot(snapPath3);
  const changed3 = compareHashTriplet(storedSnap3!.$meta, freshMeta4);
  const message3 = formatDriftMessage({ hashChanged: changed3, cases: [] });

  console.log('Result:');
  console.log(message3);
  console.log();
}

// ---------------------------------------------------------------------------
// Run all scenarios
// ---------------------------------------------------------------------------

await scenario1();
await scenario2();
await scenario3();

console.log('Benchmark complete. See BENCHMARK.md for captured output.');
