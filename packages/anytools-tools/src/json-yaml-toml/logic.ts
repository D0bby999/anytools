import TOML from '@iarna/toml';
import yaml from 'js-yaml';

export type Format = 'json' | 'yaml' | 'toml';

export function parseFormat(input: string, format: Format): unknown {
  if (format === 'json') return JSON.parse(input);
  if (format === 'yaml') return yaml.load(input);
  return TOML.parse(input);
}

export function stringifyFormat(value: unknown, format: Format): string {
  if (format === 'json') return JSON.stringify(value, null, 2);
  if (format === 'yaml') return yaml.dump(value, { indent: 2, lineWidth: 100 });
  return TOML.stringify(value as TOML.JsonMap);
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
