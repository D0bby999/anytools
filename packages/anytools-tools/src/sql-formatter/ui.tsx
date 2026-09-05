'use client';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  PrivacyNote,
  Textarea,
  useLocalized,
  useUiStrings,
} from '@anytools/ui';
import { useEffect, useState } from 'react';
import { DIALECTS, type SqlDialect, formatSql, minifySql } from './logic';
import { STRINGS } from './strings';

const EXAMPLE = `select u.id, u.name, count(o.id) as order_count
from users u left join orders o on o.user_id = u.id
where u.created_at > now() - interval '30 days'
group by u.id, u.name having count(o.id) > 0
order by order_count desc limit 100`;

export function SqlFormatterUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const [input, setInput] = useState('');
  const [dialect, setDialect] = useState<SqlDialect>('postgresql');
  const [tabWidth, setTabWidth] = useState(2);
  const [keywordCase, setKeywordCase] = useState<'upper' | 'lower' | 'preserve'>('upper');
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (input.trim().length === 0) {
      setOutput('');
      setError(null);
      return;
    }
    try {
      setOutput(formatSql(input, { language: dialect, tabWidth, keywordCase }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : ui.formatFailed);
      setOutput('');
    }
  }, [input, dialect, tabWidth, keywordCase, ui.formatFailed]);

  const doMinify = () => setOutput(minifySql(output || input));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-sm">
            <span className="block mb-1 text-muted-foreground">{s.dialect}</span>
            <select
              value={dialect}
              onChange={(e) => setDialect(e.target.value as SqlDialect)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm min-w-[180px]"
            >
              {DIALECTS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-muted-foreground">{ui.indent}</span>
            <select
              value={tabWidth}
              onChange={(e) => setTabWidth(Number(e.target.value))}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value={2}>{ui.spaces2}</option>
              <option value={4}>{ui.spaces4}</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-muted-foreground">{s.keywords}</span>
            <select
              value={keywordCase}
              onChange={(e) => setKeywordCase(e.target.value as 'upper' | 'lower' | 'preserve')}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="upper">{s.upper}</option>
              <option value="lower">{s.lower}</option>
              <option value="preserve">{s.preserve}</option>
            </select>
          </label>
          <Button variant="ghost" size="sm" onClick={() => setInput(EXAMPLE)}>
            {ui.tryExample}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setInput('')}
            disabled={input.length === 0}
          >
            {ui.clear}
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {ui.input}
              </span>
            </div>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={s.pasteSql}
              rows={14}
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {ui.output}
              </span>
              <div className="flex gap-2">
                {output && (
                  <Button variant="outline" size="sm" onClick={doMinify}>
                    {ui.minify}
                  </Button>
                )}
                {output && <CopyButton text={output} />}
              </div>
            </div>
            {error ? (
              <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </output>
            ) : (
              <pre className="rounded-md border bg-muted px-3 py-2 text-sm font-mono whitespace-pre-wrap break-all min-h-[336px]">
                {output || (
                  <span className="text-muted-foreground italic">{s.outputPlaceholder}</span>
                )}
              </pre>
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">{s.note}</p>
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
