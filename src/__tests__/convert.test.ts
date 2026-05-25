// src/__tests__/convert.test.ts
// Tests for buildAnthropicTools, buildOpenAITools, and convertToolSchemas
// Includes a module-level mock to cover the z4.toJSONSchema ?? {} fallback branch

import { describe, it, expect, vi } from 'vitest';
import * as z from 'zod';
import type * as z4 from 'zod/v4/core';

// Remove toJSONSchema from z4 to exercise the ?? {} fallback in convertToolSchemas (line 68)
vi.mock('zod/v4/core', async (importOriginal) => {
  const actual = await importOriginal();
  return Object.assign({}, actual, { toJSONSchema: undefined });
});

const { convertToolSchemas, buildAnthropicTools, buildOpenAITools } = await import('../tools/convert.js');

describe('convertToolSchemas — toJSONSchema absent (fallback to {})', () => {
  it('returns inputSchema: {} when z4.toJSONSchema is not available', () => {
    // Use a real Zod schema so globalRegistry.get() does not crash
    const result = convertToolSchemas({ myTool: z.string() as unknown as z4.$ZodType });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('myTool');
    expect(result[0].inputSchema).toEqual({});
  });

  it('maps multiple tools with fallback inputSchema', () => {
    const result = convertToolSchemas({
      toolA: z.string() as unknown as z4.$ZodType,
      toolB: z.number() as unknown as z4.$ZodType,
    });
    expect(result).toHaveLength(2);
    expect(result.every((t) => JSON.stringify(t.inputSchema) === '{}')).toBe(true);
  });
});

describe('buildAnthropicTools', () => {
  it('maps tools to Anthropic Tool format', () => {
    const result = buildAnthropicTools([
      { name: 'search', description: 'Search the web', inputSchema: { type: 'object' } },
    ]);
    expect(result[0].name).toBe('search');
    expect(result[0].description).toBe('Search the web');
  });

  it('falls back to tool name when description is undefined', () => {
    const result = buildAnthropicTools([
      { name: 'lookup', description: undefined, inputSchema: {} },
    ]);
    expect(result[0].description).toBe('lookup');
  });
});

describe('buildOpenAITools', () => {
  it('maps tools to OpenAI function-tool format', () => {
    const result = buildOpenAITools([
      { name: 'search', description: 'Search', inputSchema: { type: 'object' } },
    ]);
    expect(result[0].type).toBe('function');
    expect(result[0].function.name).toBe('search');
    expect(result[0].function.description).toBe('Search');
  });

  it('falls back to tool name when description is undefined', () => {
    const result = buildOpenAITools([
      { name: 'lookup', description: undefined, inputSchema: {} },
    ]);
    expect(result[0].function.description).toBe('lookup');
  });
});
