import TOML from '@iarna/toml';
import YAML from 'yaml';
import { ToolError } from '../shared/tool-error';

export type Format = 'json' | 'yaml' | 'toml';

export function parseFormat(input: string, format: Format): unknown {
  if (format === 'json') return JSON.parse(input);
  // `yaml` (YAML 1.2 core schema) rather than js-yaml: js-yaml applied the 1.1 timestamp
  // rule, so `date: 2024-01-01` reached the JSON side as "2024-01-01T00:00:00.000Z".
  if (format === 'yaml') return YAML.parse(input);
  return TOML.parse(input);
}

export function stringifyFormat(value: unknown, format: Format): string {
  if (format === 'json') return JSON.stringify(value, null, 2);
  if (format === 'yaml') return YAML.stringify(value, { indent: 2, lineWidth: 100 });
  const nullPath = findNull(value);
  if (nullPath !== null) {
    // @iarna/toml's own message for this is "Array values can't have mixed types" or a stack
    // trace, neither of which says what the problem is.
    throw new ToolError(
      'tomlNull',
      `TOML has no null value, and "${nullPath || '(root)'}" is null. Remove the key or give it a value before converting.`,
      { path: nullPath || '(root)' },
    );
  }
  return TOML.stringify(value as TOML.JsonMap);
}

/** Dotted path of the first null found, '' for a null root, or null when there is none. */
function findNull(value: unknown, path = ''): string | null {
  if (value === null) return path;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findNull(value[i], `${path}[${i}]`);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const hit = findNull(v, path ? `${path}.${k}` : k);
      if (hit !== null) return hit;
    }
  }
  return null;
}

export function convertFormat(input: string, from: Format, to: Format): string {
  if (from === to) return input;
  return stringifyFormat(parseFormat(input, from), to);
}

export function detectFormat(input: string): Format {
  const trimmed = input.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  if (/^[a-zA-Z_][a-zA-Z0-9_.-]*\s*=/m.test(trimmed) && !/^\s*[-?]/.test(trimmed)) return 'toml';
  return 'yaml';
}
