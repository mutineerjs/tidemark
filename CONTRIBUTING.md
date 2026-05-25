# Contributing to Tidemark

## Development setup

```bash
git clone https://github.com/mutineerjs/tidemark.git
cd tidemark
npm install
npm run build
npm test
```

Tests run fully offline via `MockAdapter` — no API keys required for the main test suite.

## Project structure

```
src/
  adapters/     # Provider adapters (Anthropic, OpenAI, Mock)
  core/         # promptFn factory, streaming, retry logic
  schema/       # Zod schema hashing and describe injection
  snapshot/     # Snapshot engine, drift detection, judge
  testing/      # mockPromptFn test utility
  vitest/       # Vitest custom matcher
examples/       # Runnable examples (require real API keys)
```

## Running the examples

Examples make real API calls and require environment variables:

```bash
export ANTHROPIC_API_KEY=sk-...
export OPENAI_API_KEY=sk-...
npx vitest run --config vitest.examples.config.ts
```

## Adding a provider adapter

Implement the `ProviderAdapter` interface from `src/adapters/interface.ts`. Look at `src/adapters/anthropic.ts` and `src/adapters/openai.ts` as reference implementations. Every adapter must:

- Return `modelVersion` as the exact resolved model string from the API response (used for drift hashing)
- Not include the `apiKey` in `rawRequest` (security requirement, see `T-03-01` in the test suite)
- Have tests that pass without a real API key (mock the HTTP layer)

## Code style

- TypeScript strict mode
- No comments unless the *why* is non-obvious
- Import from `zod/v4/core` (not the root `zod`) in library code
- Use `.js` extensions on relative imports (ESM requirement)

## Tests

```bash
npm test              # full suite
npm run test:watch    # watch mode
npm run test:coverage # with coverage
npm run typecheck     # type-check only
```

All code additions require unit tests. The full test suite must pass without real API keys.

## Pull requests

- Keep PRs focused — one concern per PR
- The CI workflow runs build, typecheck, and the full test suite on every push
- Snapshot files in `examples/__tests__/__snapshots__/` are committed and should be updated if example prompts change

## Releases

Releases are automated via [release-please](https://github.com/googleapis/release-please). Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/). A `fix:` commit bumps the patch version; a `feat:` bumps minor; a `feat!:` or `BREAKING CHANGE:` bumps major.
