'use client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CheckboxField,
  CopyButton,
  Label,
  PrivacyNote,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  useLocalized,
  useUiStrings,
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import { type SlugifyOptions, makeBulkSlugs, makeSlug } from './logic';
import { STRINGS } from './strings';

export function SlugifyUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [options, setOptions] = useState<SlugifyOptions>({
    separator: '-',
    lowercase: true,
    strict: false,
    locale: 'en',
  });

  const single = useMemo(() => (text ? makeSlug(text, options) : ''), [text, options]);
  const bulk = useMemo(
    () => (text && mode === 'bulk' ? makeBulkSlugs(text, options) : []),
    [text, options, mode],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={mode} onValueChange={(v) => setMode(v as 'single' | 'bulk')}>
          <TabsList>
            <TabsTrigger value="single">{s.single}</TabsTrigger>
            <TabsTrigger value="bulk">{s.bulk}</TabsTrigger>
          </TabsList>
          <TabsContent value="single" className="space-y-3">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Tiếng Việt có dấu"
              rows={3}
            />
          </TabsContent>
          <TabsContent value="bulk" className="space-y-3">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'Hello World\nTiếng Việt\nCafé Au Lait'}
              rows={6}
            />
          </TabsContent>
        </Tabs>

        <div className="flex flex-wrap gap-4 text-sm">
          <div className="space-y-1.5">
            <Label htmlFor="slug-separator">{s.separator}</Label>
            <Select
              value={options.separator}
              onValueChange={(v) => setOptions({ ...options, separator: v as '-' | '_' | '.' })}
            >
              <SelectTrigger id="slug-separator" className="min-w-32">
                <SelectValue>
                  {options.separator === '-'
                    ? s.hyphen
                    : options.separator === '_'
                      ? s.underscore
                      : s.dot}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="-">{s.hyphen}</SelectItem>
                <SelectItem value="_">{s.underscore}</SelectItem>
                <SelectItem value=".">{s.dot}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="slug-locale">{s.locale}</Label>
            <Select
              value={options.locale}
              onValueChange={(v) =>
                setOptions({ ...options, locale: v as SlugifyOptions['locale'] })
              }
            >
              <SelectTrigger id="slug-locale" className="min-w-24">
                <SelectValue>{String(options.locale).toUpperCase()}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {['en', 'vi', 'de', 'fr', 'es', 'pt'].map((l) => (
                  <SelectItem key={l} value={l}>
                    {l.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <CheckboxField
            label={s.lowercase}
            checked={options.lowercase}
            onCheckedChange={(v) => setOptions({ ...options, lowercase: v === true })}
          />
          <CheckboxField
            label={s.strict}
            checked={options.strict}
            onCheckedChange={(v) => setOptions({ ...options, strict: v === true })}
          />
        </div>

        {mode === 'single' ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {ui.output}
              </span>
              {single && <CopyButton text={single} />}
            </div>
            <code className="block rounded-md border bg-muted px-3 py-2 text-sm font-mono break-all">
              {single || <span className="text-muted-foreground italic">—</span>}
            </code>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {(bulk.length === 1 ? s.slugOne : s.slugMany).replace('{n}', String(bulk.length))}
              </span>
              {bulk.length > 0 && <CopyButton text={bulk.join('\n')} />}
            </div>
            <pre className="rounded-md border bg-muted px-3 py-2 text-sm font-mono whitespace-pre-wrap break-all max-h-80 overflow-auto">
              {bulk.join('\n') || <span className="text-muted-foreground italic">—</span>}
            </pre>
          </div>
        )}
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
