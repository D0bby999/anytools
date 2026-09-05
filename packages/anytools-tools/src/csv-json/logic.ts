import Papa from 'papaparse';

export type CsvOptions = {
  delimiter?: string;
  header?: boolean;
  skipEmptyLines?: boolean;
};

/**
 * Type a CSV field only when the number would print back exactly as it was typed.
 *
 * PapaParse's own `dynamicTyping` runs `parseFloat` on anything numeric-looking, which is how
 * a phone number `0912345678` became 912345678, a postcode `02134` became 2134, `1e5` became
 * 100000 and `3.10` became 3.1. Round-tripping through `String(Number(v)) === v` keeps every
 * one of those as the string it was, while `30`, `-2`, `0.5` still become numbers.
 */
export function typeField(value: string): string | number | boolean {
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  if (/^-?\d+(\.\d+)?$/.test(value) && String(Number(value)) === value) return Number(value);
  return value;
}

export function csvToJson(csv: string, options: CsvOptions = {}): unknown[] {
  const result = Papa.parse(csv, {
    header: options.header ?? true,
    delimiter: options.delimiter ?? '',
    skipEmptyLines: options.skipEmptyLines ?? true,
    dynamicTyping: false,
    transform: typeField,
  });
  if (result.errors.length > 0 && !result.data.length) {
    throw new Error(result.errors[0]?.message ?? 'Parse failed');
  }
  return result.data;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * One CSV row per record, nested objects as dotted columns (`address.city`), arrays as JSON
 * text. Without this a nested object came out as the literal `[object Object]`.
 */
export function flattenRecord(record: unknown, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isPlainObject(record)) {
    out[prefix || 'value'] = Array.isArray(record) ? JSON.stringify(record) : record;
    return out;
  }
  for (const [key, value] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) Object.assign(out, flattenRecord(value, path));
    else if (Array.isArray(value)) out[path] = JSON.stringify(value);
    else out[path] = value ?? '';
  }
  return out;
}

export function jsonToCsv(data: unknown[], options: CsvOptions = {}): string {
  if (!Array.isArray(data) || data.length === 0) return '';
  const rows = data.map((r) => flattenRecord(r));
  // The column set is the union over every record, in first-seen order. Taking the first
  // record's keys, as the plain unparse does, silently dropped any column it did not have.
  const fields: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        fields.push(key);
      }
    }
  }
  return Papa.unparse(
    { fields, data: rows.map((row) => fields.map((f) => row[f] ?? '')) },
    { delimiter: options.delimiter ?? ',', header: options.header ?? true },
  );
}
