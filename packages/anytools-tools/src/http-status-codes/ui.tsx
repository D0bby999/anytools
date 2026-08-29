'use client';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  Input,
  PrivacyNote,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import { type StatusClass, classOfCode, searchMimeTypes, searchStatusCodes } from './logic';

const CLASS_STYLE: Record<StatusClass, string> = {
  '1xx': 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  '2xx': 'bg-green-500/10 text-green-700 dark:text-green-300',
  '3xx': 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  '4xx': 'bg-orange-500/10 text-orange-700 dark:text-orange-300',
  '5xx': 'bg-red-500/10 text-red-700 dark:text-red-300',
};

const CLASSES: (StatusClass | 'all')[] = ['all', '1xx', '2xx', '3xx', '4xx', '5xx'];

export function HttpStatusCodesUi() {
  const [query, setQuery] = useState('');
  const [klass, setKlass] = useState<StatusClass | 'all'>('all');
  const [mimeQuery, setMimeQuery] = useState('');

  const statuses = useMemo(
    () => searchStatusCodes(query, klass === 'all' ? undefined : klass),
    [query, klass],
  );
  const mimes = useMemo(() => searchMimeTypes(mimeQuery), [mimeQuery]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">HTTP Status Codes & MIME Types</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs defaultValue="status">
          <TabsList>
            <TabsTrigger value="status">Status codes</TabsTrigger>
            <TabsTrigger value="mime">MIME types</TabsTrigger>
          </TabsList>

          <TabsContent value="status" className="space-y-3">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search: 404, timeout, gateway…"
              aria-label="Search status codes"
              className="h-11"
            />
            <div className="flex flex-wrap gap-2">
              {CLASSES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setKlass(c)}
                  aria-pressed={klass === c}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    klass === c ? 'bg-accent text-accent-foreground border-transparent' : 'hover:bg-accent/10'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            <ul className="divide-y rounded-lg border overflow-hidden">
              {statuses.map((entry) => (
                <li key={entry.code} className="flex items-start gap-3 p-3">
                  <Badge className={`border-0 font-mono shrink-0 ${CLASS_STYLE[classOfCode(entry.code)]}`}>
                    {entry.code}
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{entry.name}</p>
                    <p className="text-sm text-muted-foreground">{entry.description}</p>
                  </div>
                </li>
              ))}
              {statuses.length === 0 && (
                <li className="p-3 text-sm text-muted-foreground">No matching status code.</li>
              )}
            </ul>
          </TabsContent>

          <TabsContent value="mime" className="space-y-3">
            <Input
              value={mimeQuery}
              onChange={(e) => setMimeQuery(e.target.value)}
              placeholder="Search: .png, json, font…"
              aria-label="Search MIME types"
              className="h-11"
            />
            <ul className="divide-y rounded-lg border overflow-hidden">
              {mimes.map((entry) => (
                <li key={entry.extension + entry.mime} className="flex items-center gap-3 p-3">
                  <code className="font-mono text-sm w-16 shrink-0">{entry.extension}</code>
                  <div className="min-w-0 flex-1">
                    <code className="font-mono text-sm break-all">{entry.mime}</code>
                    <p className="text-xs text-muted-foreground">{entry.label}</p>
                  </div>
                  <CopyButton text={entry.mime} />
                </li>
              ))}
              {mimes.length === 0 && (
                <li className="p-3 text-sm text-muted-foreground">No matching MIME type.</li>
              )}
            </ul>
          </TabsContent>
        </Tabs>
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
