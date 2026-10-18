import { fakerDE, fakerEN, fakerES, fakerFR, fakerJA, fakerPT_BR, fakerVI } from '@faker-js/faker';

export type FakerLocale = 'en' | 'vi' | 'es' | 'pt' | 'fr' | 'de' | 'ja';

const FAKERS = {
  en: fakerEN,
  vi: fakerVI,
  es: fakerES,
  pt: fakerPT_BR,
  fr: fakerFR,
  de: fakerDE,
  ja: fakerJA,
} as const;

export type FieldType =
  | 'uuid'
  | 'fullName'
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'phone'
  | 'company'
  | 'jobTitle'
  | 'streetAddress'
  | 'city'
  | 'country'
  | 'zipCode'
  | 'date'
  | 'number'
  | 'boolean'
  | 'word'
  | 'sentence'
  | 'url'
  | 'avatar';

export type FieldSpec = { name: string; type: FieldType; min?: number; max?: number };

export function generateMockData(
  fields: FieldSpec[],
  count: number,
  locale: FakerLocale = 'en',
): Record<string, unknown>[] {
  const f = FAKERS[locale];
  const rows: Record<string, unknown>[] = [];
  const safeCount = Math.max(1, Math.min(count, 1000));
  for (let i = 0; i < safeCount; i++) {
    const row: Record<string, unknown> = {};
    for (const field of fields) {
      row[field.name] = generateField(f, field);
    }
    rows.push(row);
  }
  return rows;
}

function generateField(f: (typeof FAKERS)[FakerLocale], field: FieldSpec): unknown {
  switch (field.type) {
    case 'uuid':
      return f.string.uuid();
    case 'fullName':
      return f.person.fullName();
    case 'firstName':
      return f.person.firstName();
    case 'lastName':
      return f.person.lastName();
    case 'email':
      return f.internet.email();
    case 'phone':
      return f.phone.number();
    case 'company':
      return f.company.name();
    case 'jobTitle':
      return f.person.jobTitle();
    case 'streetAddress':
      return f.location.streetAddress();
    case 'city':
      return f.location.city();
    case 'country':
      return f.location.country();
    case 'zipCode':
      return f.location.zipCode();
    case 'date':
      return f.date.past().toISOString();
    case 'number':
      return f.number.int({ min: field.min ?? 0, max: field.max ?? 100 });
    case 'boolean':
      return f.datatype.boolean();
    case 'word':
      return f.lorem.word();
    case 'sentence':
      return f.lorem.sentence();
    case 'url':
      return f.internet.url();
    case 'avatar':
      return f.image.avatar();
  }
}

export function exportAs(rows: Record<string, unknown>[], format: 'json' | 'csv' | 'sql'): string {
  if (format === 'json') return JSON.stringify(rows, null, 2);
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0] as object);
  if (format === 'csv') {
    const csvEscape = (v: unknown) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = cols.map(csvEscape).join(',');
    const body = rows.map((r) => cols.map((c) => csvEscape(r[c])).join(',')).join('\n');
    return `${header}\n${body}`;
  }
  // sql
  const sqlEscape = (v: unknown) =>
    v == null
      ? 'NULL'
      : typeof v === 'number' || typeof v === 'boolean'
        ? String(v)
        : `'${String(v).replaceAll("'", "''")}'`;
  const values = rows.map((r) => `(${cols.map((c) => sqlEscape(r[c])).join(', ')})`).join(',\n');
  return `INSERT INTO mock_data (${cols.join(', ')}) VALUES\n${values};`;
}
