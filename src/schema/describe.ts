// src/schema/describe.ts
// Zod v4 _zod.def tree walk + buildSystemMessage with .describe() injection (CORE-03)
//
// CONFIRMED access path (01-01-SUMMARY A3):
//   z4.globalRegistry.get(schema)?.description
// _zod.def is the correct Zod v4 internal def access (not ._def which is Zod v3)

import * as z4 from 'zod/v4/core';

// Represents a single node in the walked schema tree
export interface SchemaNodeDescription {
  type: string;
  description?: string;
  // object fields
  shape?: Record<string, SchemaNodeDescription>;
  // array items
  items?: SchemaNodeDescription;
  // optional/nullable inner type
  inner?: SchemaNodeDescription;
  // union branches
  options?: SchemaNodeDescription[];
  // enum allowed values
  values?: string[];
}

/**
 * Get the .describe() annotation for a Zod schema field.
 *
 * Zod v4: .describe('text') calls .meta({ description: 'text' }) which registers
 * the description in z4.globalRegistry.
 *
 * Access path confirmed in 01-01-SUMMARY A3:
 *   z4.globalRegistry.get(schema)?.description
 *
 * Falls back to direct .description property (also confirmed in SUMMARY).
 * Returns undefined (not throw) if no description is set.
 */
export function getFieldDescription(schema: z4.$ZodType): string | undefined {
  // Primary: use globalRegistry (canonical Zod v4 API, confirmed A3)
  const registryMeta = (z4 as unknown as { globalRegistry?: { get(s: unknown): { description?: string } | undefined } }).globalRegistry?.get(schema);
  if (registryMeta?.description !== undefined) {
    return registryMeta.description;
  }
  // Fallback: direct .description property (also confirmed in SUMMARY)
  const direct = (schema as unknown as { description?: string }).description;
  if (direct !== undefined) {
    return direct;
  }
  return undefined;
}

/**
 * Walk a Zod schema's _zod.def tree and produce a SchemaNodeDescription.
 *
 * Uses _zod.def (Zod v4) — NOT ._def (Zod v3). Runtime dispatch handles both
 * via the `'_zod' in schema` guard (PATTERNS §Shared Patterns, RESEARCH Pitfall 1).
 *
 * Handles: object, string, number, boolean, array, optional, nullable, union.
 * Default branch: returns { type: def.type ?? 'unknown', description } — no recursion,
 * so unknown/exotic nodes cannot cause unbounded recursion (T-02-03 mitigation).
 */
export function walkZodDef(schema: z4.$ZodType): SchemaNodeDescription {
  // Runtime v3/v4 dispatch
  const isV4 = '_zod' in schema;
  const def = isV4
    ? (schema as unknown as { _zod: { def: Record<string, unknown> } })._zod.def
    : (schema as unknown as { _def: Record<string, unknown> })._def;

  const description = getFieldDescription(schema);

  switch (def.type) {
    case 'string':
      return { type: 'string', description };

    case 'number':
      return { type: 'number', description };

    case 'boolean':
      return { type: 'boolean', description };

    case 'enum': {
      // Zod v4: enum values live in def.entries (value→value object map)
      // Fallback to def.values (array form) for older/alternative forms.
      // Guard against both being undefined — return empty array, not a throw (T-02-03).
      const entries = (def.entries as Record<string, string> | undefined);
      const valuesArr = entries
        ? Object.values(entries)
        : ((def.values as string[] | undefined) ?? []);
      return { type: 'enum', values: valuesArr, description };
    }

    case 'object': {
      // Zod v4 object def.shape is a record of field names to schemas
      const shapeRaw = (def.shape ?? {}) as Record<string, z4.$ZodType>;
      const shape: Record<string, SchemaNodeDescription> = {};
      for (const [key, fieldSchema] of Object.entries(shapeRaw)) {
        shape[key] = walkZodDef(fieldSchema as z4.$ZodType);
      }
      return { type: 'object', shape, description };
    }

    case 'array': {
      // Zod v4 array def uses 'element' (not 'items')
      const element = (def.element ?? def.items) as z4.$ZodType | undefined;
      return {
        type: 'array',
        items: element ? walkZodDef(element) : { type: 'unknown' },
        description,
      };
    }

    case 'optional': {
      const innerType = (def.innerType ?? def.type) as z4.$ZodType | undefined;
      return {
        type: 'optional',
        inner: innerType ? walkZodDef(innerType) : { type: 'unknown' },
        description,
      };
    }

    case 'nullable': {
      const innerType = (def.innerType ?? def.type) as z4.$ZodType | undefined;
      return {
        type: 'nullable',
        inner: innerType ? walkZodDef(innerType) : { type: 'unknown' },
        description,
      };
    }

    case 'union': {
      // Zod v4 union def.options is an array of schemas
      const options = (def.options ?? []) as z4.$ZodType[];
      return {
        type: 'union',
        options: options.map((opt) => walkZodDef(opt)),
        description,
      };
    }

    default:
      // Terminal node — no recursion, so unknown types cannot cause infinite loops (T-02-03)
      return { type: (def.type as string) ?? 'unknown', description };
  }
}

/**
 * Format a SchemaNodeDescription as a human-readable structured list.
 * Claude's Discretion (CONTEXT §Claude's Discretion): structured list format, deterministic field order.
 */
export function formatSchemaDescription(
  node: SchemaNodeDescription,
  indent = 0
): string {
  const pad = '  '.repeat(indent);
  const descSuffix = node.description ? ` — ${node.description}` : '';

  switch (node.type) {
    case 'object': {
      const lines: string[] = [`${pad}object${descSuffix}`];
      if (node.shape) {
        for (const [key, child] of Object.entries(node.shape)) {
          const childStr = formatSchemaDescription(child, indent + 1);
          lines.push(`${pad}  ${key}: ${childStr.trim()}`);
        }
      }
      return lines.join('\n');
    }

    case 'array': {
      const itemStr = node.items
        ? formatSchemaDescription(node.items, 0).trim()
        : 'unknown';
      return `${pad}array of ${itemStr}${descSuffix}`;
    }

    case 'optional': {
      const innerStr = node.inner
        ? formatSchemaDescription(node.inner, 0).trim()
        : 'unknown';
      return `${pad}optional ${innerStr}${descSuffix}`;
    }

    case 'nullable': {
      const innerStr = node.inner
        ? formatSchemaDescription(node.inner, 0).trim()
        : 'unknown';
      return `${pad}nullable ${innerStr}${descSuffix}`;
    }

    case 'union': {
      const opts = (node.options ?? [])
        .map((opt) => formatSchemaDescription(opt, 0).trim())
        .join(' | ');
      return `${pad}${opts}${descSuffix}`;
    }

    case 'enum': {
      const values = node.values ?? [];
      if (values.length === 0) {
        return `${pad}enum${descSuffix}`;
      }
      return `${pad}enum(${values.join(' | ')})${descSuffix}`;
    }

    default:
      return `${pad}${node.type}${descSuffix}`;
  }
}

/**
 * Build the system message sent to the LLM adapter.
 *
 * D-06 ordering:
 *   [user prompt]
 *
 *   Output schema:
 *   [formatted schema description with .describe() annotations]
 *
 *   Respond with valid JSON matching this schema.
 */
export function buildSystemMessage(
  promptText: string,
  outputSchema: z4.$ZodType
): string {
  const node = walkZodDef(outputSchema);
  const schemaDescription = formatSchemaDescription(node);
  return [
    promptText,
    '',
    'Output schema:',
    schemaDescription,
    '',
    'Respond with valid JSON matching this schema.',
  ].join('\n');
}
