'use client';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
import { type Granularity, diffStats, diffText, generatePatch } from './logic';
import { STRINGS } from './strings';

export function DiffCheckerUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [granularity, setGranularity] = useState<Granularity>('line');
  const [view, setView] = useState<'inline' | 'patch'>('inline');

  const changes = useMemo(() => diffText(a, b, granularity), [a, b, granularity]);
  const stats = useMemo(() => diffStats(changes), [changes]);
  const patch = useMemo(() => (view === 'patch' ? generatePatch(a, b) : ''), [a, b, view]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3 items-center text-sm">
          <div className="space-y-1.5">
            <Label htmlFor="diff-granularity">{s.granularity}</Label>
            <Select value={granularity} onValueChange={(v) => setGranularity(v as Granularity)}>
              <SelectTrigger id="diff-granularity" className="min-w-32">
                <SelectValue>
                  {granularity === 'line' ? s.line : granularity === 'word' ? s.word : s.character}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="line">{s.line}</SelectItem>
                <SelectItem value="word">{s.word}</SelectItem>
                <SelectItem value="char">{s.character}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="diff-view">{s.view}</Label>
            <Select value={view} onValueChange={(v) => setView(v as 'inline' | 'patch')}>
              <SelectTrigger id="diff-view" className="min-w-36">
                <SelectValue>{view === 'inline' ? s.inlineColor : s.unifiedPatch}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inline">{s.inlineColor}</SelectItem>
                <SelectItem value="patch">{s.unifiedPatch}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(a || b) && (
            <>
              <Badge variant="default">+{stats.added}</Badge>
              <Badge variant="destructive">-{stats.removed}</Badge>
            </>
          )}
        </div>

        <Tabs defaultValue="inputs">
          <TabsList>
            <TabsTrigger value="inputs">{s.inputs}</TabsTrigger>
            <TabsTrigger value="result">{ui.result}</TabsTrigger>
          </TabsList>
          <TabsContent value="inputs">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <span className="block mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                  {s.original}
                </span>
                <Textarea value={a} onChange={(e) => setA(e.target.value)} rows={10} />
              </div>
              <div>
                <span className="block mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                  {s.modified}
                </span>
                <Textarea value={b} onChange={(e) => setB(e.target.value)} rows={10} />
              </div>
            </div>
          </TabsContent>
          <TabsContent value="result">
            {view === 'inline' ? (
              <pre className="rounded-md border bg-muted px-3 py-2 text-sm font-mono whitespace-pre-wrap break-all min-h-[200px]">
                {changes.map((c, i) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: ephemeral diff render
                    key={`diff-${i}`}
                    className={
                      c.added
                        ? 'bg-success/15 text-success'
                        : c.removed
                          ? 'bg-destructive/15 text-destructive'
                          : ''
                    }
                  >
                    {c.value}
                  </span>
                ))}
              </pre>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    {s.unifiedPatch}
                  </span>
                  {patch && <CopyButton text={patch} />}
                </div>
                <pre className="rounded-md border bg-muted px-3 py-2 text-sm font-mono whitespace-pre-wrap break-all">
                  {patch}
                </pre>
              </div>
            )}
          </TabsContent>
        </Tabs>
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
