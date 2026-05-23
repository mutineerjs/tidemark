<!-- GSD:project-start source:PROJECT.md -->
## Project

**Tidemark**

Tidemark is a TypeScript library that brings snapshot testing to LLM features. Engineers define prompts as typed `promptFn` functions with Zod-validated output, capture behaviour across test cases as committed JSON snapshots, and get automatic drift detection when the prompt, model, or schema changes underneath them. It ships as a Vitest matcher — no new test runner, no SaaS, no separate prompt store.

**Core Value:** Detect prompt/model/schema drift before production does — with field-level attribution, not blob diffs.

### Constraints

- **Tech stack**: TypeScript-native, Zod as default schema library (open to `@standard-schema/spec` later)
- **Runtime**: Vitest plugin first; Jest is v0.2
- **Scope**: promptFn is the only entry point — no BYO-function layer
- **Distribution**: npm package, public OSS, no SaaS component
- **Timeline**: No fixed date — ship when the promptFn + snapshot loop feels solid
- **Testing**: Every code addition must include unit tests; the full test suite must pass without real API keys (mock adapters required from Phase 1)
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### LLM Provider SDKs
| Technology | Version (pinned) | Purpose | Why |
|------------|-----------------|---------|-----|
| `@anthropic-ai/sdk` | `^0.97.0` | Anthropic API calls | Official SDK, ships `MessageStream` with typed events + async iterator, `messages.stream()` for high-level streaming, `messages.create({ stream: true })` for low-level raw `AsyncIterable`. `client.beta.messages.toolRunner()` automates multi-turn tool loops. Actively released (v0.97.0 dropped 2026-05-19). |
| `openai` | `^6.38.0` | OpenAI API calls | Official SDK, ships `zodResponseFormat()` helper for Zod-typed structured output via `chat.completions.parse()`. `peerDependencies` now accepts `zod: "^3.25 || ^4.0"`, confirming it supports both Zod generations. Actively released (v6.38.0 dropped 2026-05-15). |
- Anthropic: `anthropic.messages.stream()` returns `MessageStream`. Use `.on('text', ...)` for token streaming. Use `await stream.finalMessage()` for the accumulated result. Expose the raw `Stream` via an escape hatch for users who need it.
- OpenAI: `client.chat.completions.stream()` returns `ChatCompletionStream` with the same event-emitter + async iterator shape.
- Internal type: define streaming output as `AsyncIterable<string>` for text-chunk deltas and a `Promise<T>` for the final validated output. This is testable with standard `for await` loops in Vitest.
### Schema
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `zod` | `^4.4.3` (peer) | Output schema, input validation, `.describe()` injection | Zod v4 shipped in 2025: 14x faster string parsing, 2.3x smaller bundle, TypeScript 5.5+ required. v4 implements `@standard-schema/spec` natively. The OpenAI SDK already accepts `zod: "^3.25 || ^4.0"`. Target v4 from day one — users on v3 who are stuck should be able to use the `zod/v3` compat path. |
| `@standard-schema/spec` | `^1.1.0` | Type-only interface for future non-Zod adapter support | Ships no runtime code. Standard Schema 1.0 released 2025-01-27, 1.1.0 released 2025-12-15. Adopted by Zod (≥3.24.0), Valibot, ArkType, Effect Schema. Lets Tidemark accept any compliant schema as a future extension without breaking the Zod-primary interface. Use `~standard` property check for runtime dispatch. |
- `peerDependencies`: `"zod": "^3.25.0 || ^4.0.0"` — lets users bring their own Zod.
- `devDependencies`: pin to `zod@^4.4.3` for development.
- Internal code: import from `"zod/v4/core"` only — supports both Zod and Zod Mini simultaneously.
- Accept user schemas with `<T extends z4.$ZodType>` generics, not concrete types.
- Do NOT import from the root `"zod"` in library code — use the versioned sub-path.
### Test Runner / Matcher Layer
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `vitest` | `^4.1.6` (peer) | Test runner; Tidemark ships as a Vitest custom matcher | Vitest v4 is current stable (v5 is beta). v4.1 introduced named exports `Matcher`, `MatcherResult`, `MatcherState` from `'vitest'` — these are what library authors need for typed custom matchers. |
| `@vitest/snapshot` | `^4.1.6` | Snapshot primitives | Exposes `Snapshots.toMatchSnapshot`, `Snapshots.toMatchFileSnapshot` etc. Custom snapshot matchers call these with `.call(this, ...)` to reuse Vitest's storage and update mechanism. Tidemark's `toMatchSnapshot` is built on this primitive. |
| `@vitest/expect` | `^4.1.6` | `expect` type internals | Sub-package used internally by Vitest; useful for type-only imports when building matchers. |
### Build Toolchain
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `tsup` | `^8.5.1` | Bundle TypeScript library to ESM + CJS | Industry default for TS npm libraries. Zero-config dual ESM/CJS output, `.d.ts` generation, sourcemaps, tree-shaking, in one tool. 6M+ weekly downloads vs tsdown's ~500K. tsup is active and stable; tsdown is the future successor (from the Vite/Rolldown ecosystem) but is pre-1.0 and has known bugs. Start with tsup. Migrate to tsdown when it hits 1.0 stable. |
| `typescript` | `^5.5.0` | Type checking, declaration emit | TypeScript 5.5+ required by Zod v4. `isolatedDeclarations` optional for tsup (not required as it is for tsdown). |
- `tsc` alone: doesn't bundle, doesn't tree-shake, produces one output file per input file. Wrong for an npm library that wants a clean `dist/`.
- `Rollup` directly: correct tree-shaking but heavy config for this use case. No meaningful benefit over tsup for a library of this scope.
- `tsdown`: superior ESM-first defaults and ~2x faster DTS generation, but pre-1.0 as of research date. Revisit at tsdown 1.0.
- `esbuild` directly: no `.d.ts` output; must pair with `tsc --emitDeclarationOnly`. More wiring than tsup.
### Provider Adapter Interface
- Tidemark needs `modelVersion` (the exact resolved model string from the response) to compute drift hashes — Vercel AI SDK doesn't surface this.
- Tidemark needs `rawRequest` + `rawResponse` for the escape hatch — not accessible through Vercel's abstraction.
- Vercel's SDK surface area is large and evolves quickly; coupling Tidemark's core to it creates maintenance risk.
- The custom interface has 4 properties — easy to implement, easy to mock, easy to test.
### Supporting Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod-to-json-schema` | `^3.24.5` | Convert Zod schemas to JSON Schema for tool definitions | Needed when passing Zod-typed tool schemas to provider APIs. OpenAI's `zodResponseFormat` uses this internally; Anthropic's tool `input_schema` requires manual conversion. |
| `fast-deep-equal` | `^3.1.3` | Deep equality for field-level diff comparison | Fast, zero-dependency. Use for snapshot field comparison where exact match is required. |
| `diff` | `^9.0.0` | Text diff for string fields in failure output | Produces unified diffs for string field drift attribution in failure messages. |
| `ms` | `^2.1.3` | Human-readable latency formatting in failure messages | Tiny, zero-dependency. |
- `langchain` / `llamaindex`: framework-level dependencies that would conflict with Tidemark's ownership of the LLM call. Not used.
- `ai` (Vercel AI SDK): Discussed above. Not used for provider calls. May be referenced for `@ai-sdk/provider` types in the future if ecosystem converges on Standard Schema.
- `jest-dom` / `@testing-library/*`: Unrelated to Tidemark's test domain.
### Development Dependencies
| Library | Version | Purpose |
|---------|---------|---------|
| `vitest` | `^4.1.6` | Tidemark's own test suite (note: also a peer dep) |
| `@anthropic-ai/sdk` | `^0.97.0` | Tidemark's own development and integration tests |
| `openai` | `^6.38.0` | OpenAI integration tests |
| `zod` | `^4.4.3` | Tidemark's own type development |
| `@types/diff` | `^7.0.0` | Type definitions for `diff` package |
| `tsx` | `^4.19.0` | Run TypeScript scripts during development (`npx tsx`) |
## Alternatives Considered
| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Build tool | tsup 8.x | tsdown | Pre-1.0, known bugs, author recommends waiting for 1.0. Revisit. |
| Build tool | tsup 8.x | tsc alone | Doesn't bundle; produces flat file-per-file output; no tree-shaking |
| LLM abstraction | Native SDKs + custom adapter | Vercel AI SDK | Hides modelVersion from response; hides rawRequest/rawResponse; large surface area; wrong abstraction layer |
| Schema | Zod v4 | Valibot | Tidemark is Zod-native by design. Standard Schema is the future compat path, not a migration target. |
| Schema compat | @standard-schema/spec | Handwritten adapters per library | Standard Schema is the community consensus (Zod, Valibot, ArkType all ship it). Zero runtime cost. |
| Snapshot storage | Custom JSON files | Vitest native `.snap` format | Vitest's format is Jest-compatible but not human-readable as JSON. Tidemark's format needs a `$schema`, `promptHash`, `schemaHash`, field-level metadata. Must be custom. |
| Diffing | `diff` package | `deep-diff` | `diff` is actively maintained (v9.0.0), simpler API, widely used. |
| Test runner | Vitest | Jest | Vitest is the current standard for TS/ESM projects. Jest support is explicitly v0.2. |
## Key Version Pinning Rationale
- **Zod v4, not v3:** v4 is current stable (4.4.3), ships as both `zod` (root) and `zod/v4/core`. TypeScript 5.5+ requirement aligns with Tidemark's own TS requirement. v4 implements Standard Schema natively. The Zod team's library-author guidance is to support `^3.25.0 || ^4.0.0` via peer dep, but write internal code against `zod/v4/core`.
- **OpenAI SDK v6, not v4/v5:** v6.38.0 is current as of 2026-05-15. The v4→v5→v6 progression was rapid; the `openai` package's `dist-tags.next` is v4.0.0-beta (legacy; confusingly named) — ignore it. Use `latest`.
- **Anthropic SDK 0.x:** Still pre-1.0 versioned but actively maintained. 0.97.0 as of 2026-05-19.
- **Vitest v4, not v5:** v5 is in beta (5.0.0-beta.3). Adopt v4.1.x for stability; v5 when stable.
## Installation
# Production peer dependencies (what users of Tidemark must have)
# Install Tidemark itself
# Tidemark's own dev dependencies (for library development)
# Optional: for running integration tests against real APIs
## Sources
- Anthropic SDK TypeScript — Context7 `/anthropics/anthropic-sdk-typescript` (HIGH confidence)
- OpenAI Node SDK — Context7 `/openai/openai-node` (HIGH confidence)
- npm `openai@6.38.0` peerDependencies: `zod: "^3.25 || ^4.0"` — npm registry (HIGH confidence)
- Vitest extending matchers — Context7 `/vitest-dev/vitest` + https://vitest.dev/guide/extending-matchers (HIGH confidence)
- Vitest Snapshots API — Context7 `/vitest-dev/vitest` docs on `Snapshots.*` (HIGH confidence)
- tsup — Context7 `/egoist/tsup` + https://www.pkgpulse.com/blog/tsup-vs-rollup-vs-esbuild-2026 (HIGH confidence)
- tsdown vs tsup — https://alan.norbauer.com/articles/tsdown-bundler/ (MEDIUM confidence, single author review)
- Zod v4 library authors guide — https://zod.dev/library-authors (HIGH confidence, official)
- Zod v4 changelog — https://zod.dev/v4/changelog (HIGH confidence, official)
- Standard Schema — https://standardschema.dev/schema + npm `@standard-schema/spec@1.1.0` (HIGH confidence)
- TypeScript dual ESM/CJS — https://lirantal.com/blog/typescript-in-2025-with-esm-and-cjs-npm-publishing (MEDIUM confidence)
- npm versions verified against registry as of 2026-05-19
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
