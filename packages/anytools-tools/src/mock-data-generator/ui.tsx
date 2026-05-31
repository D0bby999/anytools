'use client';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  Input,
  PrivacyNote,
} from '@anytools/ui';
import { useState } from 'react';
import {
  type FakerLocale,
  type FieldSpec,
  type FieldType,
  exportAs,
  generateMockData,
} from './logic';

const FIELD_TYPES: FieldType[] = [
  'uuid',
  'fullName',
  'firstName',
  'lastName',
  'email',
  'phone',
  'company',
  'jobTitle',
  'streetAddress',
  'city',
  'country',
  'zipCode',
  'date',
  'number',
  'boolean',
  'word',
  'sentence',
  'url',
  'avatar',
];

const PRESET_USER: FieldSpec[] = [
  { name: 'id', type: 'uuid' },
  { name: 'name', type: 'fullName' },
  { name: 'email', type: 'email' },
  { name: 'company', type: 'company' },
  { name: 'createdAt', type: 'date' },
];

export function MockDataGeneratorUi() {
  const [fields, setFields] = useState<FieldSpec[]>(PRESET_USER);
  const [count, setCount] = useState(10);
  const [locale, setLocale] = useState<FakerLocale>('en');
  const [format, setFormat] = useState<'json' | 'csv' | 'sql'>('json');
  const [output, setOutput] = useState('');

  const updateField = (i: number, patch: Partial<FieldSpec>) => {
    setFields((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  };
  const removeField = (i: number) => setFields((prev) => prev.filter((_, idx) => idx !== i));
  const addField = () =>
    setFields((prev) => [...prev, { name: `field${prev.length + 1}`, type: 'word' }]);

  const generate = () => {
    const rows = generateMockData(fields, count, locale);
    setOutput(exportAs(rows, format));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Mock Data Generator</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {fields.map((field, i) => (
            <div key={`field-${i}-${field.name}`} className="flex gap-2 items-center">
              <Input
                value={field.name}
                onChange={(e) => updateField(i, { name: e.target.value })}
                placeholder="field name"
                className="max-w-[180px]"
              />
              <select
                value={field.type}
                onChange={(e) => updateField(i, { type: e.target.value as FieldType })}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="ghost" onClick={() => removeField(i)}>
                ×
              </Button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={addField}>
            + Add field
          </Button>
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps Input forwardRef */}
          <label className="text-sm">
            <span className="block mb-1 text-muted-foreground">Count (1-1000)</span>
            <Input
              type="number"
              min={1}
              max={1000}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-muted-foreground">Locale</span>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as FakerLocale)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="en">EN</option>
              <option value="vi">VI</option>
              <option value="es">ES</option>
              <option value="pt">PT</option>
              <option value="fr">FR</option>
              <option value="de">DE</option>
              <option value="ja">JA</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-muted-foreground">Format</span>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as typeof format)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
              <option value="sql">SQL INSERT</option>
            </select>
          </label>
          <Button onClick={generate}>Generate</Button>
        </div>

        {output && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Output</span>
              <CopyButton text={output} />
            </div>
            <pre className="rounded-md border bg-muted px-3 py-2 text-sm font-mono whitespace-pre-wrap break-all max-h-96 overflow-auto">
              {output}
            </pre>
          </div>
        )}
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
