# Tidemark Benchmark

Demonstrates Tidemark's drift detection in three canonical scenarios.
Run the benchmark yourself: `npx tsx examples/benchmark.ts`

---

## Scenario 1: Prompt Change Detection

When the prompt string changes, Tidemark detects it via the SHA-256 prompt hash.

```
Snapshot drift: prompt hash changed.
Re-run with --update to accept the new baseline.
```

**What changed:** The prompt text was modified ("Be concise." added).
**How to update:** Re-run with `--update` flag to accept the new baseline.

---

## Scenario 2: Schema Change Detection

When the output schema changes (new field added), Tidemark detects it via the Zod `_def` tree hash.

```
Snapshot drift: schema hash changed.
Re-run with --update to accept the new baseline.
```

**What changed:** A new `urgency: z.number()` field was added to the output schema.
**How to update:** Re-run with `--update` flag after verifying the new schema is intentional.

---

## Scenario 3: Model Version Drift

When the resolved model version changes (e.g., a provider alias remaps to a new model), Tidemark detects it.

```
Snapshot drift: model hash changed.
Re-run with --update to accept the new baseline.
```

**What changed:** The model version resolved from the API response changed from
`claude-sonnet-4-5-20250929` to `claude-haiku-3-20240307`.

**Why this matters:** A model alias like `claude-sonnet-latest` may silently resolve to a new
concrete version after a provider update. Tidemark catches this before it reaches production.

---

## Reproducing

Requirements: Node.js 18+, TypeScript 5.5+

```bash
git clone https://github.com/your-org/tidemark
cd tidemark
npm install
npx tsx examples/benchmark.ts
```

The benchmark uses `MockAdapter` (no API key required) to demonstrate deterministic drift detection.
All three scenarios write a baseline snapshot, then run a modified version of the same function
to show exactly what Tidemark reports when drift is detected.
