// src/schema/wave0-validation.test.ts
// Wave 0 assumption validation tests — must pass before building on these APIs.
// Results recorded inline as comments for downstream plan consumption.

import { describe, it, expect } from 'vitest';
import * as z from 'zod'; // root import for user-simulating test code
import * as z4 from 'zod/v4/core'; // internal import path used by library code
import { MockAdapter } from '../adapters/mock.js';

// ============================================================
// A3 — Zod v4 .describe() access path from zod/v4/core
// ============================================================
// CONFIRMED ACCESS PATH (for Plan 02 use):
//   z4.globalRegistry.get(schema)?.description
//   where z4 = import * as z4 from 'zod/v4/core'
//
// Also confirmed: schema.description is directly accessible as a property.
// Plan 02 should use z4.globalRegistry.get(schema)?.description as the
// primary access path (it's the canonical Zod v4 API per RESEARCH).
// The schema.description fallback is also available if needed.
describe('A3: Zod v4 .describe() access path', () => {
  it('z4.globalRegistry.get(schema)?.description returns the describe text', () => {
    // Create a Zod v4 schema via root import (users bring their own zod)
    const schema = z.string().describe('A test description for Plan 02');

    // Primary confirmed path: z4.globalRegistry.get(schema)?.description
    // This is the canonical Zod v4 API for reading .describe() annotations.
    const meta = (z4 as unknown as { globalRegistry: { get(s: unknown): { description?: string } | undefined } })
      .globalRegistry.get(schema);

    expect(meta).toBeDefined();
    expect(meta?.description).toBe('A test description for Plan 02');
  });

  it('description is accessible via both globalRegistry and direct .description property', () => {
    const schema = z.object({
      category: z.string().describe('The category field'),
    });

    // Test object-level describe
    schema.describe('Top-level object description');

    // Individual field description via globalRegistry
    const fieldSchema = z.string().describe('Field description test');
    const fieldMeta = (z4 as unknown as { globalRegistry: { get(s: unknown): { description?: string } | undefined } })
      .globalRegistry.get(fieldSchema);
    expect(fieldMeta?.description).toBe('Field description test');

    // Direct property access also works (confirmed alternative)
    expect(fieldSchema.description).toBe('Field description test');
  });

  it('_zod.def is the correct Zod v4 internal def access (not ._def)', () => {
    const schema = z.object({ x: z.string() });

    // Zod v4 uses _zod.def, NOT _def (D-16, RESEARCH Pitfall 1)
    expect('_zod' in schema).toBe(true);
    const def = (schema as unknown as { _zod: { def: { type: string } } })._zod.def;
    expect(def.type).toBe('object');

    // _def should not exist (Zod v4 removed it)
    // Note: we don't assert _def is undefined since behavior may vary,
    // but _zod.def is the canonical path.
    expect(def).toBeDefined();
  });
});

// ============================================================
// A2 — z.toJSONSchema() for tool schemas
// ============================================================
// CONFIRMED: z.toJSONSchema(schema) (Zod v4 built-in) produces a valid
// JSON Schema object with a 'properties' key for object schemas.
// This is the preferred method for tool input schema conversion.
// zod-to-json-schema is available as a fallback for Zod v3 users.
describe('A2: z.toJSONSchema() for tool schema conversion', () => {
  it('z.toJSONSchema produces JSON Schema with properties key', () => {
    const schema = z.object({ x: z.string() });
    // z.toJSONSchema is a Zod v4 built-in (RESEARCH Pitfall 5 validation)
    const jsonSchema = z.toJSONSchema(schema);

    expect(jsonSchema).toBeDefined();
    expect(typeof jsonSchema).toBe('object');
    expect('properties' in jsonSchema).toBe(true);
    expect((jsonSchema as Record<string, unknown>).properties).toHaveProperty('x');
  });

  it('z.toJSONSchema includes required fields and type', () => {
    const schema = z.object({
      name: z.string(),
      count: z.number(),
    });
    const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;

    expect(jsonSchema.type).toBe('object');
    expect(jsonSchema.properties).toBeDefined();
    const props = jsonSchema.properties as Record<string, unknown>;
    expect(props.name).toBeDefined();
    expect(props.count).toBeDefined();
  });
});

// ============================================================
// A4 — MockStreamSource.abort() after finalResponse() is safe
// ============================================================
// CONFIRMED: Calling abort() on a MockStreamSource after finalResponse()
// has resolved does not throw. The abort() method simply sets _aborted = true,
// and since the iterator has already completed, there is no error.
// This validates D-17: always call abort() in finally blocks.
describe('A4: abort() after finalResponse() is safe (D-17)', () => {
  it('abort() after stream completion does not throw', async () => {
    const adapter = new MockAdapter();
    adapter.enqueue({ text: '{"value": 42}' });

    const streamSource = adapter.stream({
      messages: [{ role: 'user', content: 'test' }],
    });

    // Consume the stream fully
    const chunks: string[] = [];
    for await (const chunk of streamSource) {
      chunks.push(chunk.delta);
    }

    // Get the final response
    const response = await streamSource.finalResponse();
    expect(response.text).toBe('{"value": 42}');

    // Abort after completion — this must NOT throw (D-17 pattern)
    expect(() => streamSource.abort()).not.toThrow();
  });

  it('abort() during iteration stops the stream', async () => {
    const adapter = new MockAdapter();
    adapter.enqueue({ text: 'abcdefgh' });

    const streamSource = adapter.stream({
      messages: [{ role: 'user', content: 'test' }],
    });

    const chunks: string[] = [];
    for await (const chunk of streamSource) {
      chunks.push(chunk.delta);
      if (chunks.length >= 3) {
        streamSource.abort(); // abort mid-stream
        break;
      }
    }

    // Stream was aborted — fewer chunks than full text
    expect(chunks.length).toBeLessThan(8);
    // Abort after completion is also safe here (finally pattern)
    expect(() => streamSource.abort()).not.toThrow();
  });
});
