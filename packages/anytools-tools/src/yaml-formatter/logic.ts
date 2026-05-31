import yaml from 'js-yaml';

export type FormatResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function formatYaml(input: string, indent: 2 | 4, sortKeys = false): FormatResult<string> {
  try {
    const parsed = yaml.load(input);
    return { ok: true, value: yaml.dump(parsed, { indent, sortKeys, lineWidth: 100 }) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Format failed' };
  }
}

export function validateYaml(input: string): FormatResult<true> {
  try {
    yaml.load(input);
    return { ok: true, value: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Invalid YAML' };
  }
}
