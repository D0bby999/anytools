'use client';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  useLocalized,
  useToolLocale,
  useUiStrings,
} from '@anytools/ui';
import { useState } from 'react';
import { richText } from '../shared/rich-text';
import { type RegexFlags, type TestResult, flagString } from './logic';
import { runRegexInWorker } from './regex-worker';
import { STRINGS } from './strings';

type Mode = 'test' | 'replace';
type ReplaceResult = { ok: true; result: string } | { ok: false; error: string };

const DEFAULT_FLAGS: RegexFlags = {
  global: true,
  ignoreCase: false,
  multiline: false,
  dotAll: false,
  unicode: false,
  sticky: false,
};

// The flag letter is the JavaScript token and never changes; the description is localized.
const FLAG_LETTERS: { key: keyof RegexFlags; letter: string }[] = [
  { key: 'global', letter: 'g' },
  { key: 'ignoreCase', letter: 'i' },
  { key: 'multiline', letter: 'm' },
  { key: 'dotAll', letter: 's' },
  { key: 'unicode', letter: 'u' },
  { key: 'sticky', letter: 'y' },
];

const MAX_TEXT_LEN = 10_240;
const EXAMPLE_PATTERN = '(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})';
const EXAMPLE_TEXT = 'Today is 2026-05-25 and tomorrow is 2026-05-26.';

export function RegexTesterUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const locale = useToolLocale();
  const [pattern, setPattern] = useState('');
  const [text, setText] = useState('');
  const [flags, setFlags] = useState<RegexFlags>(DEFAULT_FLAGS);
  const [mode, setMode] = useState<Mode>('test');
  const [replacement, setReplacement] = useState('');
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [replaceResult, setReplaceResult] = useState<ReplaceResult | null>(null);

  const flagDescription: Record<keyof RegexFlags, string> = {
    global: s.flagGlobal,
    ignoreCase: s.flagIgnoreCase,
    multiline: s.flagMultiline,
    dotAll: s.flagDotAll,
    unicode: s.flagUnicode,
    sticky: s.flagSticky,
  };

  const truncated = text.length > MAX_TEXT_LEN;
  const maxLen = MAX_TEXT_LEN.toLocaleString(locale);

  const [running, setRunning] = useState(false);

  const handleRun = async () => {
    if (pattern.length === 0) {
      setTestResult(null);
      setReplaceResult(null);
      return;
    }
    const safeText = text.slice(0, MAX_TEXT_LEN);
    setRunning(true);
    // Off the main thread, so a pattern that backtracks forever is terminated after 1 s
    // instead of freezing the tab.
    const result = await runRegexInWorker({
      pattern,
      flags: flagString(flags),
      text: safeText,
      replacement: mode === 'replace' ? replacement : undefined,
    });
    setRunning(false);
    if (!result.ok) {
      setTestResult(result);
      setReplaceResult(mode === 'replace' ? result : null);
      return;
    }
    setTestResult({ ok: true, matches: result.matches });
    setReplaceResult(mode === 'replace' ? { ok: true, result: result.replaced ?? safeText } : null);
  };

  const toggleFlag = (key: keyof RegexFlags) =>
    setFlags((prev) => ({ ...prev, [key]: !prev[key] }));

  const tryExample = () => {
    setPattern(EXAMPLE_PATTERN);
    setText(EXAMPLE_TEXT);
    setTestResult(null);
    setReplaceResult(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps Input forwardRef which biome can't detect statically */}
        <label className="block text-sm">
          <span className="block mb-1 text-muted-foreground">{s.pattern}</span>
          <div className="flex gap-2">
            <span className="font-mono text-muted-foreground self-center">/</span>
            <Input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder={s.patternPlaceholder}
              className="font-mono"
            />
            <span className="font-mono text-muted-foreground self-center">/</span>
          </div>
        </label>

        <div className="flex flex-wrap gap-3 items-center text-sm">
          <span className="text-muted-foreground">{s.flags}</span>
          {FLAG_LETTERS.map(({ key, letter }) => (
            <label key={key} className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={flags[key]}
                onChange={() => toggleFlag(key)}
                className="h-4 w-4"
              />
              <span className="text-xs">
                {letter} — {flagDescription[key]}
              </span>
            </label>
          ))}
          <Button variant="ghost" size="sm" onClick={tryExample}>
            {ui.tryExample}
          </Button>
        </div>

        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList>
            <TabsTrigger value="test">{s.test}</TabsTrigger>
            <TabsTrigger value="replace">{s.replace}</TabsTrigger>
          </TabsList>

          <TabsContent value="test" className="space-y-3">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={s.testText}
              rows={6}
            />
          </TabsContent>

          <TabsContent value="replace" className="space-y-3">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={s.testText}
              rows={6}
            />
            <Input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder={s.replacementPlaceholder}
              className="font-mono"
            />
          </TabsContent>
        </Tabs>

        <div className="flex items-center gap-3">
          <Button onClick={handleRun} disabled={pattern.length === 0 || running}>
            {running ? s.running : ui.run}
          </Button>
          {truncated && (
            <span className="text-xs text-destructive">{s.capped.replace('{n}', maxLen)}</span>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            {s.charCount
              .replace('{n}', text.length.toLocaleString(locale))
              .replace('{max}', maxLen)}
          </span>
        </div>

        {testResult && !testResult.ok && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {testResult.error}
          </output>
        )}

        {testResult?.ok && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge>
                {testResult.matches.length === 1
                  ? s.matchOne
                  : s.matchMany.replace('{n}', String(testResult.matches.length))}
              </Badge>
            </div>
            {testResult.matches.length > 0 && (
              <div className="space-y-2 max-h-80 overflow-auto">
                {testResult.matches.slice(0, 50).map((m) => (
                  <div
                    key={`${m.index}-${m.match}`}
                    className="rounded-md border bg-muted px-3 py-2 text-sm font-mono"
                  >
                    <div>
                      <span className="text-muted-foreground">
                        [{m.index}–{m.index + m.length - 1}]
                      </span>{' '}
                      <span>{m.match}</span>
                    </div>
                    {m.groups.length > 0 && (
                      <div className="text-xs text-muted-foreground mt-1">
                        {s.groups}{' '}
                        {m.groups.map((g, gi) => `$${gi + 1}=${JSON.stringify(g)}`).join(' · ')}
                      </div>
                    )}
                    {Object.keys(m.namedGroups).length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {s.named}{' '}
                        {Object.entries(m.namedGroups)
                          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                          .join(' · ')}
                      </div>
                    )}
                  </div>
                ))}
                {testResult.matches.length > 50 && (
                  <p className="text-xs text-muted-foreground">
                    {s.showingFirst.replace('{n}', String(testResult.matches.length))}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {mode === 'replace' && replaceResult && (
          <div>
            <span className="block mb-1 text-xs uppercase tracking-wide text-muted-foreground">
              {s.afterReplace}
            </span>
            {replaceResult.ok ? (
              <pre className="rounded-md border bg-muted px-3 py-2 text-sm font-mono whitespace-pre-wrap break-all">
                {replaceResult.result}
              </pre>
            ) : (
              <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {replaceResult.error}
              </output>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {richText(s.footnote, { run: <strong>{ui.run}</strong>, n: maxLen })}
        </p>
      </CardContent>
    </Card>
  );
}
