'use client';
import {
  Button,
  ConverterTemplate,
  CopyButton,
  Label,
  PrivacyNote,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
    <ConverterTemplate
      title={s.title}
      toolbar={
        <>
          <div className="space-y-1.5">
            <Label htmlFor="sql-dialect">{s.dialect}</Label>
            <Select value={dialect} onValueChange={(v) => setDialect(v as SqlDialect)}>
              <SelectTrigger id="sql-dialect" className="min-w-44">
                <SelectValue>
                  {DIALECTS.find((d) => d.value === dialect)?.label ?? dialect}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {DIALECTS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sql-indent">{ui.indent}</Label>
            <Select value={String(tabWidth)} onValueChange={(v) => setTabWidth(Number(v))}>
              <SelectTrigger id="sql-indent" className="min-w-28">
                <SelectValue>{tabWidth === 4 ? ui.spaces4 : ui.spaces2}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2">{ui.spaces2}</SelectItem>
                <SelectItem value="4">{ui.spaces4}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sql-keywords">{s.keywords}</Label>
            <Select
              value={keywordCase}
              onValueChange={(v) => setKeywordCase(v as 'upper' | 'lower' | 'preserve')}
            >
              <SelectTrigger id="sql-keywords" className="min-w-32">
                <SelectValue>
                  {keywordCase === 'upper'
                    ? s.upper
                    : keywordCase === 'lower'
                      ? s.lower
                      : s.preserve}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="upper">{s.upper}</SelectItem>
                <SelectItem value="lower">{s.lower}</SelectItem>
                <SelectItem value="preserve">{s.preserve}</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
        </>
      }
      source={
        <div className="space-y-1.5">
          <div className="flex min-h-8 items-center">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {ui.input}
            </span>
          </div>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={s.pasteSql}
            rows={14}
            className="h-full"
            aria-label={ui.input}
          />
        </div>
      }
      target={
        <div className="space-y-1.5">
          <div className="flex min-h-8 items-center justify-between">
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
            <pre className="min-h-[336px] whitespace-pre-wrap break-all rounded-md border bg-muted px-3 py-2 font-mono text-sm">
              {output || (
                <span className="italic text-muted-foreground">{s.outputPlaceholder}</span>
              )}
            </pre>
          )}
        </div>
      }
      disclaimer={
        <>
          <p>{s.note}</p>
          <PrivacyNote />
        </>
      }
    />
  );
}
