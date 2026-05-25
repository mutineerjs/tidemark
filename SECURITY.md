# Security Policy

## Reporting a vulnerability

Please do not open a public GitHub issue for security vulnerabilities. Instead, report them via GitHub's [private vulnerability reporting](https://github.com/mutineerjs/tidemark/security/advisories/new).

Include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact

You'll receive a response within 7 days.

## API key handling

Tidemark passes your API key to the provider SDK and does not store it. As a safeguard, the `rawRequest` field on `TidemarkCallMeta` explicitly strips any `apiKey` property before returning it to your code — confirmed by the `T-03-01` security test in the test suite.

Never commit API keys. Use environment variables (`process.env.ANTHROPIC_API_KEY`, `process.env.OPENAI_API_KEY`) or a secrets manager.

## Snapshot files

Snapshot files (`.snap.json`) capture LLM outputs and are committed to your repository. Do not use Tidemark to snapshot outputs that contain sensitive data — treat snapshot files as you would any other committed file.
