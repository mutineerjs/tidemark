# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
