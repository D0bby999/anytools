import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PrivacyNote,
  Textarea,
  useLocalized,
} from '~/components/tools-ui';
import { useMemo, useState } from 'react';
import { type DiffEntry, diffJson, summarize } from './logic';
import { STRINGS } from './strings';

// type-changed is a fourth kind outside the added/removed/changed scale, so it
// takes the neutral tint; its label says which kind it is.
const KIND_STYLE: Record<DiffEntry['kind'], string> = {
  added: 'bg-primary-soft text-primary',
  removed: 'bg-destructive-soft text-destructive',
  changed: 'bg-warning-soft text-warning',
  'type-changed': 'bg-muted text-foreground',
};

function short(value: unknown): string {
  const text = JSON.stringify(value);
  return text && text.length > 80 ? `${text.slice(0, 77)}…` : (text ?? 'undefined');
}

export function JsonDiffUi() {
  const s = useLocalized(STRINGS);
  const kindLabel: Record<DiffEntry['kind'], string> = {
    added: s.added,
    removed: s.removed,
    changed: s.changed,
    'type-changed': s.typeChanged,
  };
  const [left, setLeft] = useState('{\n  "name": "anytools",\n  "version": 1\n}');
  const [right, setRight] = useState('{\n  "name": "anytools",\n  "version": 2\n}');
  const result = useMemo(() => diffJson(left, right), [left, right]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <span className="block text-sm font-medium mb-1.5">{s.original}</span>
            <Textarea
              value={left}
              onChange={(e) => setLeft(e.target.value)}
              rows={10}
              className="font-mono text-sm"
              aria-label={s.originalJson}
            />
          </div>
          <div>
            <span className="block text-sm font-medium mb-1.5">{s.modified}</span>
            <Textarea
              value={right}
              onChange={(e) => setRight(e.target.value)}
              rows={10}
              className="font-mono text-sm"
              aria-label={s.modifiedJson}
            />
          </div>
        </div>

        {!result.ok ? (
          <p className="text-sm text-destructive">
            {s.invalid
              .replace('{side}', result.side === 'left' ? s.original : s.modified)
              .replace('{error}', result.error)}
          </p>
        ) : result.identical ? (
          <p className="text-sm font-medium text-primary">{s.identical}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {Object.entries(summarize(result.entries))
                .filter(([, count]) => count > 0)
                .map(([kind, count]) => (
                  <Badge key={kind} className={`border-0 ${KIND_STYLE[kind as DiffEntry['kind']]}`}>
                    {count} {kindLabel[kind as DiffEntry['kind']]}
                  </Badge>
                ))}
            </div>
            <ul className="divide-y rounded-lg border overflow-hidden">
              {result.entries.map((entry) => (
                <li key={`${entry.kind}:${entry.path}`} className="p-3 text-sm space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge className={`border-0 ${KIND_STYLE[entry.kind]}`}>
                      {kindLabel[entry.kind]}
                    </Badge>
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
        {result.ok && result.unsafeIntegers.length > 0 && (
          <p className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning">
            {s.unsafeWarning.replace('{list}', result.unsafeIntegers.join(', '))}
          </p>
        )}
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
