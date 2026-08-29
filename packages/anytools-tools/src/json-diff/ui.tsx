'use client';
import { Badge, Card, CardContent, CardHeader, CardTitle, PrivacyNote, Textarea } from '@anytools/ui';
import { useMemo, useState } from 'react';
import { type DiffEntry, diffJson, summarize } from './logic';

// type-changed keeps a raw categorical purple — a fourth diff kind outside the
// success/warning/destructive status scale.
const KIND_STYLE: Record<DiffEntry['kind'], string> = {
  added: 'bg-success/10 text-success',
  removed: 'bg-destructive/10 text-destructive',
  changed: 'bg-warning/10 text-warning',
  'type-changed': 'bg-purple-500/10 text-purple-700 dark:text-purple-300',
};

function short(value: unknown): string {
  const text = JSON.stringify(value);
  return text && text.length > 80 ? `${text.slice(0, 77)}…` : (text ?? 'undefined');
}

export function JsonDiffUi() {
  const [left, setLeft] = useState('{\n  "name": "anytools",\n  "version": 1\n}');
  const [right, setRight] = useState('{\n  "name": "anytools",\n  "version": 2\n}');
  const result = useMemo(() => diffJson(left, right), [left, right]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">JSON Diff</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <span className="block text-sm font-medium mb-1.5">Original</span>
            <Textarea
              value={left}
              onChange={(e) => setLeft(e.target.value)}
              rows={10}
              className="font-mono text-sm"
              aria-label="Original JSON"
            />
          </div>
          <div>
            <span className="block text-sm font-medium mb-1.5">Modified</span>
            <Textarea
              value={right}
              onChange={(e) => setRight(e.target.value)}
              rows={10}
              className="font-mono text-sm"
              aria-label="Modified JSON"
            />
          </div>
        </div>

        {!result.ok ? (
          <p className="text-sm text-destructive">
            {result.side === 'left' ? 'Original' : 'Modified'} JSON is invalid: {result.error}
          </p>
        ) : result.identical ? (
          <p className="text-sm font-medium text-success">
            Structurally identical — key order and whitespace ignored.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {Object.entries(summarize(result.entries))
                .filter(([, count]) => count > 0)
                .map(([kind, count]) => (
                  <Badge key={kind} className={`border-0 ${KIND_STYLE[kind as DiffEntry['kind']]}`}>
                    {count} {kind}
                  </Badge>
                ))}
            </div>
            <ul className="divide-y rounded-lg border overflow-hidden">
              {result.entries.map((entry) => (
                <li key={`${entry.kind}:${entry.path}`} className="p-3 text-sm space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge className={`border-0 ${KIND_STYLE[entry.kind]}`}>{entry.kind}</Badge>
                    <code className="font-mono text-xs">{entry.path}</code>
                  </div>
                  <div className="font-mono text-xs text-muted-foreground overflow-x-auto">
                    {entry.kind !== 'added' && <p>- {short(entry.before)}</p>}
                    {entry.kind !== 'removed' && <p>+ {short(entry.after)}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
