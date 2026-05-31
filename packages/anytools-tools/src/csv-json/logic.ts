import Papa from 'papaparse';

export type CsvOptions = {
  delimiter?: string;
  header?: boolean;
  skipEmptyLines?: boolean;
};

export function csvToJson(csv: string, options: CsvOptions = {}): unknown[] {
  const result = Papa.parse(csv, {
    header: options.header ?? true,
    delimiter: options.delimiter ?? '',
    skipEmptyLines: options.skipEmptyLines ?? true,
    dynamicTyping: true,
  });
  if (result.errors.length > 0 && !result.data.length) {
    throw new Error(result.errors[0]?.message ?? 'Parse failed');
  }
  return result.data;
}

export function jsonToCsv(data: unknown[], options: CsvOptions = {}): string {
  if (!Array.isArray(data) || data.length === 0) return '';
  return Papa.unparse(data, {
    delimiter: options.delimiter ?? ',',
    header: options.header ?? true,
  });
}
