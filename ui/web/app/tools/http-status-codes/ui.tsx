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
  useLocalized,
} from '~/components/tools-ui';
import { useMemo, useState } from 'react';
import { type StatusClass, classOfCode, searchMimeTypes, searchStatusCodes } from './logic';
import { STRINGS } from './strings';

// One tint per class, from this app's tokens: informational muted, success the
// brand ink, redirect the selected-row tint, then warning and destructive for
// client and server errors. The code itself is always written in the badge.
const CLASS_STYLE: Record<StatusClass, string> = {
  '1xx': 'bg-muted text-muted-foreground',
  '2xx': 'bg-primary-soft text-primary',
  '3xx': 'bg-selected text-selected-foreground',
  '4xx': 'bg-warning-soft text-warning',
  '5xx': 'bg-destructive-soft text-destructive',
};

const CLASSES: (StatusClass | 'all')[] = ['all', '1xx', '2xx', '3xx', '4xx', '5xx'];

export function HttpStatusCodesUi() {
  const s = useLocalized(STRINGS);
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
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs defaultValue="status">
          <TabsList>
            <TabsTrigger value="status">{s.statusTab}</TabsTrigger>
            <TabsTrigger value="mime">{s.mimeTab}</TabsTrigger>
          </TabsList>

          <TabsContent value="status" className="space-y-3">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={s.searchStatus}
              aria-label={s.searchStatusAria}
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
                    klass === c
                      ? 'bg-primary text-primary-foreground border-transparent'
                      : 'hover:bg-muted'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            <ul className="divide-y rounded-lg border overflow-hidden">
              {statuses.map((entry) => (
                <li key={entry.code} className="flex items-start gap-3 p-3">
                  <Badge
                    className={`border-0 font-mono shrink-0 ${CLASS_STYLE[classOfCode(entry.code)]}`}
                  >
                    {entry.code}
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{entry.name}</p>
                    <p className="text-sm text-muted-foreground">{entry.description}</p>
                  </div>
                </li>
              ))}
              {statuses.length === 0 && (
                <li className="p-3 text-sm text-muted-foreground">{s.noStatus}</li>
              )}
            </ul>
          </TabsContent>

          <TabsContent value="mime" className="space-y-3">
            <Input
              value={mimeQuery}
              onChange={(e) => setMimeQuery(e.target.value)}
              placeholder={s.searchMime}
              aria-label={s.searchMimeAria}
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
                <li className="p-3 text-sm text-muted-foreground">{s.noMime}</li>
              )}
            </ul>
          </TabsContent>
        </Tabs>
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
