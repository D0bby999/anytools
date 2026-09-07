'use client';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  Input,
  Label,
  PrivacyNote,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useLocalized,
  useUiStrings,
} from '@anytools/ui';
import { useState } from 'react';
import {
  type FakerLocale,
  type FieldSpec,
  type FieldType,
  exportAs,
  generateMockData,
} from './logic';
import { STRINGS } from './strings';

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
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
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
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {fields.map((field, i) => (
            <div key={`field-${i}-${field.name}`} className="flex gap-2 items-center">
              <Input
                value={field.name}
                onChange={(e) => updateField(i, { name: e.target.value })}
                placeholder={s.fieldName}
                className="max-w-[180px]"
              />
              <Select
                value={field.type}
                onValueChange={(v) => updateField(i, { type: v as FieldType })}
              >
                <SelectTrigger aria-label={s.fieldType} className="max-w-[200px]">
                  <SelectValue>{field.type}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="ghost"
                aria-label={ui.remove}
                onClick={() => removeField(i)}
              >
                ×
              </Button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={addField}>
            {s.addField}
          </Button>
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps Input forwardRef */}
          <label className="text-sm">
            <span className="block mb-1 text-muted-foreground">{s.count}</span>
            <Input
              type="number"
              min={1}
              max={1000}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </label>
          <div className="space-y-1.5">
            <Label htmlFor="mock-locale">{s.locale}</Label>
            <Select value={locale} onValueChange={(v) => setLocale(v as FakerLocale)}>
              <SelectTrigger id="mock-locale" className="min-w-24">
                <SelectValue>{locale.toUpperCase()}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {['en', 'vi', 'es', 'pt', 'fr', 'de', 'ja'].map((l) => (
                  <SelectItem key={l} value={l}>
                    {l.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mock-format">{s.format}</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as typeof format)}>
              <SelectTrigger id="mock-format" className="min-w-32">
                <SelectValue>{format === 'sql' ? 'SQL INSERT' : format.toUpperCase()}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="json">JSON</SelectItem>
                <SelectItem value="csv">CSV</SelectItem>
                <SelectItem value="sql">SQL INSERT</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={generate}>{ui.generate}</Button>
        </div>

        {output && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {ui.output}
              </span>
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
