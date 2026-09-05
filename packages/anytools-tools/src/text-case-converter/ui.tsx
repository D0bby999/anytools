'use client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  PrivacyNote,
  Textarea,
  useLocalized,
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import { type CaseType, convertAllCases } from './logic';
import { STRINGS } from './strings';

// Each label is written in the case it names, so it doubles as the example — kept in English.
const ORDER: { key: CaseType; label: string }[] = [
  { key: 'camel', label: 'camelCase' },
  { key: 'pascal', label: 'PascalCase' },
  { key: 'snake', label: 'snake_case' },
  { key: 'kebab', label: 'kebab-case' },
  { key: 'constant', label: 'CONSTANT_CASE' },
  { key: 'dot', label: 'dot.case' },
  { key: 'path', label: 'path/case' },
  { key: 'sentence', label: 'Sentence case' },
  { key: 'capital', label: 'Capital Case' },
  { key: 'train', label: 'Train-Case' },
  { key: 'upper', label: 'UPPERCASE' },
  { key: 'lower', label: 'lowercase' },
];

export function TextCaseConverterUi() {
  const s = useLocalized(STRINGS);
  const [text, setText] = useState('');
  const results = useMemo(() => (text ? convertAllCases(text) : null), [text]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={s.placeholder}
          rows={3}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {ORDER.map(({ key, label }) => (
            <div key={key} className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-32 shrink-0">{label}</span>
              <code className="flex-1 font-mono text-sm rounded bg-muted px-2 py-1 break-all">
                {results?.[key] || <span className="text-muted-foreground italic">—</span>}
              </code>
              {results?.[key] && <CopyButton text={results[key]} />}
            </div>
          ))}
        </div>
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
