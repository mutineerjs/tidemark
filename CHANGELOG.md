# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0](https://github.com/mutineerjs/tidemark/compare/tidemark-v0.2.0...tidemark-v0.3.0) (2026-05-28)


### Features

* **02-01:** add Jest-syntax integration test (D-12, @jest/globals imports) ([e595791](https://github.com/mutineerjs/tidemark/commit/e5957916d4f3b6343f79e70b519a8a9c5091ffc6))
* **02-01:** add Vitest behavioral test for Jest adapter + exclude Jest-syntax test ([2244366](https://github.com/mutineerjs/tidemark/commit/2244366a1a95a26e44f56c5a694d2a8187bb8b6b))
* **02-01:** create Jest adapter src/jest/index.ts and install @jest/globals ([dc9a0c3](https://github.com/mutineerjs/tidemark/commit/dc9a0c3af9022c071673b8feb669a9ccb5f6d2f4))


### Bug Fixes

* **02:** add null-guard for missing TIDEMARK_META and fix setupFilesAfterEnv comment (CR-01, CR-02) ([c093012](https://github.com/mutineerjs/tidemark/commit/c09301280d9e92a6ce7a8d6c8d2fc490a2d3f0c9))
* build dist before npm publish in release workflow ([f2ad8f0](https://github.com/mutineerjs/tidemark/commit/f2ad8f0a94b60b7593092e06e9812166963890c0))
* **jest:** correct Matchers type params to resolve TS2428 ([07c7297](https://github.com/mutineerjs/tidemark/commit/07c7297481d43d1c7f4aa1ef1381109cb303bd05))
* trigger release ([5ba2474](https://github.com/mutineerjs/tidemark/commit/5ba24740cf69f89362535e77eb6bef4c2daa02a2))
* trigger release ([fd579b1](https://github.com/mutineerjs/tidemark/commit/fd579b1b7d9ee5f3948fe4ed3bee19b38406b78a))

## [0.2.0](https://github.com/mutineerjs/tidemark/compare/tidemark-v0.1.0...tidemark-v0.2.0) (2026-05-28)


### Features

* **02-01:** add Jest-syntax integration test (D-12, @jest/globals imports) ([51d0a13](https://github.com/mutineerjs/tidemark/commit/51d0a1305b65d8123d0884ba759b53274b56ac37))
* **02-01:** add Vitest behavioral test for Jest adapter + exclude Jest-syntax test ([40967c1](https://github.com/mutineerjs/tidemark/commit/40967c1ff11736681800e681efbc84d119c0e8f5))
* **02-01:** create Jest adapter src/jest/index.ts and install @jest/globals ([0e16a07](https://github.com/mutineerjs/tidemark/commit/0e16a07e320b3bf9207d001668bfd4ad9a46870f))


### Bug Fixes

* **02:** add null-guard for missing TIDEMARK_META and fix setupFilesAfterEnv comment (CR-01, CR-02) ([0b8967c](https://github.com/mutineerjs/tidemark/commit/0b8967cda36eb5bd4e5da62a24e0d11e11ae0afc))
* build dist before npm publish in release workflow ([5aa6f14](https://github.com/mutineerjs/tidemark/commit/5aa6f141fdd191b4040def6925b9865249a9d9e3))
* **jest:** correct Matchers type params to resolve TS2428 ([1256128](https://github.com/mutineerjs/tidemark/commit/1256128094af102ab89b573b49f81fd07879a100))

## [Unreleased]

### Added

- Jest adapter (`@mutineerjs/tidemark/jest`) — drop-in equivalent of the Vitest adapter; register via `setupFilesAfterEnv` in `jest.config.ts` and import `expectPromptFn` from `@mutineerjs/tidemark/jest`
- `sample` option on `toMatchSnapshot` — probability (0–1) of running the LLM drift check on subsequent test runs; test passes immediately without API calls when skipped
- `every` option on `toMatchSnapshot` — run the LLM drift check 1-in-N times; shorthand for `sample: 1/N`
- `threshold` option on `toMatchSnapshot` — override the default LLM judge equivalence threshold (default: 0.85) per test call

## [0.1.0] - 2026-05-20

### Added

- `promptFn` factory with typed Zod input/output, stable name identifier, model and temperature config
- Anthropic adapter (Claude Sonnet 4.x) implementing `ProviderAdapter` interface
- OpenAI adapter with shared `ProviderAdapter` interface
- Streaming support via `promptFn.stream()` returning `AsyncIterable<StreamChunk<T>>`
- Tool use / function calling for both Anthropic and OpenAI formats
- Basic multi-turn conversation state via `messages` array
- Cost and latency observability per call (inputTokens, outputTokens, estimatedCostUsd, responseTimeMs)
- Snapshot testing via `expectPromptFn(fn).toMatchSnapshot(cases)` Vitest matcher
- JSON snapshot files with deterministic key order, prompt/schema/model drift detection
- LLM-as-judge semantic field equivalence scoring (configurable threshold, default 0.85)
- Field-level drift attribution in failure messages
- `tidemark/testing` sub-package with `mockPromptFn()` utility
- Three example apps: text extraction, classification, structured generation
- Benchmark page with reproducible drift detection demonstrations
