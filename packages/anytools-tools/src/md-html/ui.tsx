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
  useLocalized,
  useUiStrings,
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import { htmlToMarkdown, markdownToHtml } from './logic';
import { STRINGS } from './strings';

type Mode = 'md-to-html' | 'html-to-md';

export function MdHtmlUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const [mode, setMode] = useState<Mode>('md-to-html');
  const [input, setInput] = useState('');
  const [gfm, setGfm] = useState(true);

  const result = useMemo(() => {
    if (!input.trim()) return { ok: true as const, value: '' };
    try {
      const value = mode === 'md-to-html' ? markdownToHtml(input, { gfm }) : htmlToMarkdown(input);
      return { ok: true as const, value };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : ui.conversionFailed };
    }
  }, [input, mode, gfm, ui.conversionFailed]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList>
            <TabsTrigger value="md-to-html">MD → HTML</TabsTrigger>
            <TabsTrigger value="html-to-md">HTML → MD</TabsTrigger>
          </TabsList>
        </Tabs>
        {mode === 'md-to-html' && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={gfm}
              onChange={(e) => setGfm(e.target.checked)}
              className="h-4 w-4"
            />
            {s.gfm}
          </label>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <span className="block mb-1 text-xs uppercase tracking-wide text-muted-foreground">
              {ui.input}
            </span>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={mode === 'md-to-html' ? '# Hello\n\nWorld' : '<h1>Hello</h1>'}
              rows={12}
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {ui.output}
              </span>
              {result.ok && result.value && <CopyButton text={result.value} />}
            </div>
            {result.ok ? (
              <pre className="rounded-md border bg-muted px-3 py-2 text-sm font-mono whitespace-pre-wrap break-all min-h-[280px]">
                {result.value || <span className="text-muted-foreground italic">—</span>}
              </pre>
            ) : (
              <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {result.error}
              </output>
            )}
          </div>
        </div>
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
