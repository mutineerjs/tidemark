// Excluded from CI — vitest.config.ts include: ['src/**/*.test.ts'] only picks up src/ files.
// Run manually: npx vitest run examples/__tests__/streaming.test.ts (requires ANTHROPIC_API_KEY)

import { it, expect } from 'vitest';
import { streamingFn } from '../streaming.js';

it('streamingFn yields text chunks and resolves final output', async () => {
  const stream = streamingFn.stream({ topic: 'TypeScript testing' });
  const chunks: string[] = [];
  try {
    for await (const chunk of stream) {
      if (chunk.type === 'text') chunks.push(chunk.delta);
    }
    expect(chunks.length).toBeGreaterThan(0);

    const { output, meta } = await stream.finalOutput();
    expect(typeof output.headline).toBe('string');
    expect(output.headline.length).toBeGreaterThan(0);
    expect(Array.isArray(output.bullets)).toBe(true);
    expect(output.bullets.length).toBeGreaterThanOrEqual(1);
    expect(typeof meta.modelVersion).toBe('string');
    expect(meta.outputTokens).toBeGreaterThan(0);
  } finally {
    stream.abort();
  }
}, 30_000);
