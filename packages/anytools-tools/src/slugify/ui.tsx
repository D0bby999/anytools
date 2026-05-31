'use client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  PrivacyNote,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import { type SlugifyOptions, makeBulkSlugs, makeSlug } from './logic';

export function SlugifyUi() {
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
        <CardTitle className="text-xl">Slugify</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={mode} onValueChange={(v) => setMode(v as 'single' | 'bulk')}>
          <TabsList>
            <TabsTrigger value="single">Single</TabsTrigger>
            <TabsTrigger value="bulk">Bulk (line-by-line)</TabsTrigger>
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
          <label className="flex items-center gap-1">
            Separator:
            <select
              value={options.separator}
              onChange={(e) =>
                setOptions({ ...options, separator: e.target.value as '-' | '_' | '.' })
              }
              className="h-8 rounded border border-input bg-background px-2"
            >
              <option value="-">- (hyphen)</option>
              <option value="_">_ (underscore)</option>
              <option value=".">. (dot)</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            Locale:
            <select
              value={options.locale}
              onChange={(e) =>
                setOptions({ ...options, locale: e.target.value as SlugifyOptions['locale'] })
              }
              className="h-8 rounded border border-input bg-background px-2"
            >
              <option value="en">EN</option>
              <option value="vi">VI</option>
              <option value="de">DE</option>
              <option value="fr">FR</option>
              <option value="es">ES</option>
              <option value="pt">PT</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={options.lowercase}
              onChange={(e) => setOptions({ ...options, lowercase: e.target.checked })}
              className="h-4 w-4"
            />
            lowercase
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={options.strict}
              onChange={(e) => setOptions({ ...options, strict: e.target.checked })}
              className="h-4 w-4"
            />
            strict (strip punctuation)
          </label>
        </div>

        {mode === 'single' ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Output</span>
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
                {bulk.length} slug{bulk.length === 1 ? '' : 's'}
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
