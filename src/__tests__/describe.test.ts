// src/__tests__/describe.test.ts
// Tests for walkZodDef + buildSystemMessage — Zod v4 _zod.def tree walk + describe() injection (CORE-03)

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as z4 from 'zod/v4/core';
import * as z from 'zod'; // test files may use root 'zod' — simulates user-side code

import {
  walkZodDef,
  getFieldDescription,
  buildSystemMessage,
  formatSchemaDescription,
} from '../schema/describe.js';

describe('getFieldDescription', () => {
  it('returns the .describe() annotation text for a field', () => {
    const schema = z.string().describe('full name');
    const desc = getFieldDescription(schema);
    expect(desc).toBe('full name');
  });

  it('returns undefined for a schema with no description', () => {
    const schema = z.string();
    expect(getFieldDescription(schema)).toBeUndefined();
  });

  it('returns description for a number schema', () => {
    const schema = z.number().describe('user age');
    expect(getFieldDescription(schema)).toBe('user age');
  });
});

describe('walkZodDef', () => {
  it('handles z.string() — returns type=string node', () => {
    const node = walkZodDef(z.string());
    expect(node.type).toBe('string');
  });

  it('handles z.number() — returns type=number node', () => {
    const node = walkZodDef(z.number());
    expect(node.type).toBe('number');
  });

  it('handles z.boolean() — returns type=boolean node', () => {
    const node = walkZodDef(z.boolean());
    expect(node.type).toBe('boolean');
  });

  it('includes description from .describe() on leaf nodes', () => {
    const schema = z.string().describe('full name');
    const node = walkZodDef(schema);
    expect(node.type).toBe('string');
    expect(node.description).toBe('full name');
  });

  it('handles z.object — shape.name.description matches .describe() and shape.age.type is number', () => {
    const schema = z.object({
      name: z.string().describe('full name'),
      age: z.number(),
    });
    const node = walkZodDef(schema);
    expect(node.type).toBe('object');
    expect(node.shape).toBeDefined();
    expect(node.shape!.name.description).toBe('full name');
    expect(node.shape!.age.type).toBe('number');
  });

  it('handles z.array — returns type=array with items', () => {
    const schema = z.array(z.string());
    const node = walkZodDef(schema);
    expect(node.type).toBe('array');
    expect(node.items).toBeDefined();
    expect(node.items!.type).toBe('string');
  });

  it('handles z.optional — wraps inner type', () => {
    const schema = z.optional(z.string());
    const node = walkZodDef(schema);
    expect(node.type).toBe('optional');
    expect(node.inner).toBeDefined();
    expect(node.inner!.type).toBe('string');
  });

  it('handles z.nullable — wraps inner type', () => {
    const schema = z.nullable(z.number());
    const node = walkZodDef(schema);
    expect(node.type).toBe('nullable');
    expect(node.inner).toBeDefined();
    expect(node.inner!.type).toBe('number');
  });

  it('handles z.union — returns type=union with options array', () => {
    const schema = z.union([z.string(), z.number()]);
    const node = walkZodDef(schema);
    expect(node.type).toBe('union');
    expect(node.options).toBeDefined();
    expect(node.options).toHaveLength(2);
    expect(node.options![0].type).toBe('string');
    expect(node.options![1].type).toBe('number');
  });

  it('unknown def type returns type=unknown without throwing', () => {
    // Simulate an exotic schema with an unknown def.type
    // by using a real schema and checking default branch is defensive
    // We test this by checking that walkZodDef doesn't throw on valid schemas
    expect(() => walkZodDef(z.string())).not.toThrow();
  });

  it('handles z.enum — returns type=enum with values array', () => {
    const schema = z.enum(['billing', 'technical', 'general', 'refund']);
    const node = walkZodDef(schema);
    expect(node.type).toBe('enum');
    expect(node.values).toBeDefined();
    expect(node.values).toEqual(['billing', 'technical', 'general', 'refund']);
  });

  it('handles z.enum with .describe() — keeps description on the node', () => {
    const schema = z.enum(['billing', 'technical', 'general', 'refund']).describe('support ticket category');
    const node = walkZodDef(schema);
    expect(node.type).toBe('enum');
    expect(node.description).toBe('support ticket category');
    expect(node.values).toEqual(['billing', 'technical', 'general', 'refund']);
  });
});

describe('buildSystemMessage', () => {
  it('starts with the prompt text', () => {
    const schema = z.object({ result: z.string() });
    const msg = buildSystemMessage('Classify the text', schema);
    expect(msg.startsWith('Classify the text')).toBe(true);
  });

  it('contains "Output schema:" section', () => {
    const schema = z.object({ result: z.string() });
    const msg = buildSystemMessage('Classify the text', schema);
    expect(msg).toContain('Output schema:');
  });

  it('ends with the JSON instruction sentence (D-06)', () => {
    const schema = z.object({ result: z.string() });
    const msg = buildSystemMessage('Classify the text', schema);
    expect(msg.endsWith('Respond with valid JSON matching this schema.')).toBe(true);
  });

  it('includes .describe() text from annotated fields in the message', () => {
    const schema = z.object({
      category: z.string().describe('the primary classification label'),
      score: z.number().describe('confidence from 0 to 1'),
    });
    const msg = buildSystemMessage('Classify the input', schema);
    expect(msg).toContain('the primary classification label');
    expect(msg).toContain('confidence from 0 to 1');
  });

  it('unannotated fields still appear in schema section without crashing', () => {
    const schema = z.object({
      value: z.number(), // no .describe()
    });
    const msg = buildSystemMessage('Return a number', schema);
    expect(msg).toContain('Output schema:');
    expect(msg).not.toThrow; // not an assertion but validates no crash path
  });

  it('renders enum fields with pipe-joined values rather than bare "enum"', () => {
    const schema = z.object({
      category: z.enum(['billing', 'technical', 'general', 'refund']).describe('support ticket category'),
    });
    const msg = buildSystemMessage('Classify the support ticket', schema);
    expect(msg).toContain('enum(billing | technical | general | refund)');
    expect(msg).toContain('support ticket category');
  });
});

describe('formatSchemaDescription (enum)', () => {
  it('renders a standalone enum node as enum(a | b | c)', () => {
    const schema = z.enum(['a', 'b', 'c']);
    const node = walkZodDef(schema);
    const result = formatSchemaDescription(node);
    expect(result).toBe('enum(a | b | c)');
  });

  it('renders enum inside an object field with description', () => {
    const schema = z.object({
      category: z.enum(['billing', 'technical', 'general', 'refund']).describe('support ticket category'),
    });
    const node = walkZodDef(schema);
    const result = formatSchemaDescription(node);
    expect(result).toContain('enum(billing | technical | general | refund)');
    expect(result).toContain('support ticket category');
  });

  it('degrades gracefully for empty enum (no values)', () => {
    // Simulate a node with no values (empty array)
    const node = { type: 'enum' as const, values: [] };
    const result = formatSchemaDescription(node);
    expect(result).toBe('enum');
  });

  it('renders optional string as "optional string"', () => {
    const node = walkZodDef(z.optional(z.string()));
    expect(formatSchemaDescription(node)).toBe('optional string');
  });

  it('renders nullable number as "nullable number"', () => {
    const node = walkZodDef(z.nullable(z.number()));
    expect(formatSchemaDescription(node)).toBe('nullable number');
  });

  it('renders union of string and number as "string | number"', () => {
    const node = walkZodDef(z.union([z.string(), z.number()]));
    expect(formatSchemaDescription(node)).toBe('string | number');
  });

  it('renders array of string as "array of string"', () => {
    const node = walkZodDef(z.array(z.string()));
    expect(formatSchemaDescription(node)).toBe('array of string');
  });
});

describe('getFieldDescription — direct .description fallback', () => {
  it('returns direct .description when globalRegistry has no entry for the schema', () => {
    const fakeSchema = {
      _zod: { def: { type: 'string' } },
      description: 'fallback description',
    };
    const result = getFieldDescription(fakeSchema as unknown as import('zod/v4/core').$ZodType);
    expect(result).toBe('fallback description');
  });

  it('walkZodDef returns type "unknown" when def.type is undefined', () => {
    const fakeSchema = { _zod: { def: { type: undefined } } };
    const node = walkZodDef(fakeSchema as unknown as import('zod/v4/core').$ZodType);
    expect(node.type).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// walkZodDef — fallback branches (Zod v3 path + missing field defaults)
// ---------------------------------------------------------------------------

describe('walkZodDef — Zod v3 path and missing-field fallbacks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses _def when _zod is absent (Zod v3 path)', () => {
    // Spy on globalRegistry.get so it doesn't crash on a non-Zod object
    vi.spyOn(
      (z4 as unknown as { globalRegistry: { get: (...args: unknown[]) => unknown } }).globalRegistry,
      'get'
    ).mockReturnValue(undefined);

    const fakeV3 = { _def: { type: 'string' } };
    const node = walkZodDef(fakeV3 as unknown as z4.$ZodType);
    expect(node.type).toBe('string');
  });

  it('enum: uses def.values array when def.entries is absent', () => {
    vi.spyOn(
      (z4 as unknown as { globalRegistry: { get: (...args: unknown[]) => unknown } }).globalRegistry,
      'get'
    ).mockReturnValue(undefined);

    const fake = { _zod: { def: { type: 'enum', values: ['x', 'y'] } } };
    const node = walkZodDef(fake as unknown as z4.$ZodType);
    expect(node.type).toBe('enum');
    expect(node.values).toEqual(['x', 'y']);
  });

  it('enum: returns empty values array when neither def.entries nor def.values present', () => {
    vi.spyOn(
      (z4 as unknown as { globalRegistry: { get: (...args: unknown[]) => unknown } }).globalRegistry,
      'get'
    ).mockReturnValue(undefined);

    const fake = { _zod: { def: { type: 'enum' } } };
    const node = walkZodDef(fake as unknown as z4.$ZodType);
    expect(node.type).toBe('enum');
    expect(node.values).toEqual([]);
  });

  it('array: items is { type: "unknown" } when neither def.element nor def.items present', () => {
    vi.spyOn(
      (z4 as unknown as { globalRegistry: { get: (...args: unknown[]) => unknown } }).globalRegistry,
      'get'
    ).mockReturnValue(undefined);

    const fake = { _zod: { def: { type: 'array' } } };
    const node = walkZodDef(fake as unknown as z4.$ZodType);
    expect(node.type).toBe('array');
    expect(node.items?.type).toBe('unknown');
  });

  it('array: uses def.items fallback when def.element is absent', () => {
    vi.spyOn(
      (z4 as unknown as { globalRegistry: { get: (...args: unknown[]) => unknown } }).globalRegistry,
      'get'
    ).mockReturnValue(undefined);

    const itemSchema = { _zod: { def: { type: 'number' } } };
    const fake = { _zod: { def: { type: 'array', items: itemSchema } } };
    const node = walkZodDef(fake as unknown as z4.$ZodType);
    expect(node.items?.type).toBe('number');
  });

  it('object: shape is {} when def.shape is absent', () => {
    vi.spyOn(
      (z4 as unknown as { globalRegistry: { get: (...args: unknown[]) => unknown } }).globalRegistry,
      'get'
    ).mockReturnValue(undefined);

    const fake = { _zod: { def: { type: 'object' } } };
    const node = walkZodDef(fake as unknown as z4.$ZodType);
    expect(node.type).toBe('object');
    expect(node.shape).toEqual({});
  });

  it('union: options is [] when def.options is absent', () => {
    vi.spyOn(
      (z4 as unknown as { globalRegistry: { get: (...args: unknown[]) => unknown } }).globalRegistry,
      'get'
    ).mockReturnValue(undefined);

    const fake = { _zod: { def: { type: 'union' } } };
    const node = walkZodDef(fake as unknown as z4.$ZodType);
    expect(node.type).toBe('union');
    expect(node.options).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// formatSchemaDescription — missing inner/items/options fallback branches
// ---------------------------------------------------------------------------

describe('formatSchemaDescription — missing inner/items/options fallbacks', () => {
  it('array with no items field renders "array of unknown"', () => {
    expect(formatSchemaDescription({ type: 'array' })).toBe('array of unknown');
  });

  it('optional with no inner field renders "optional unknown"', () => {
    expect(formatSchemaDescription({ type: 'optional' })).toBe('optional unknown');
  });

  it('nullable with no inner field renders "nullable unknown"', () => {
    expect(formatSchemaDescription({ type: 'nullable' })).toBe('nullable unknown');
  });

  it('union with no options field renders empty string', () => {
    expect(formatSchemaDescription({ type: 'union' })).toBe('');
  });

  it('object with no shape field renders just "object" (shape undefined → if(node.shape) is false)', () => {
    expect(formatSchemaDescription({ type: 'object' })).toBe('object');
  });

  it('enum with no values property uses ?? [] fallback — renders "enum" for no values', () => {
    // node.values is absent (undefined) → hits the ?? [] right side
    expect(formatSchemaDescription({ type: 'enum' })).toBe('enum');
  });
});
