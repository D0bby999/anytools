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
} from '@anytools/ui';
import { useState } from 'react';
import { type RegexFlags, type TestResult, replaceRegex, testRegex } from './logic';

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

const FLAG_LABELS: { key: keyof RegexFlags; label: string }[] = [
  { key: 'global', label: 'g — global' },
  { key: 'ignoreCase', label: 'i — ignore case' },
  { key: 'multiline', label: 'm — ^/$ per line' },
  { key: 'dotAll', label: 's — dot matches newline' },
  { key: 'unicode', label: 'u — unicode' },
  { key: 'sticky', label: 'y — sticky' },
];

const MAX_TEXT_LEN = 10_240;
const EXAMPLE_PATTERN = '(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})';
const EXAMPLE_TEXT = 'Today is 2026-05-25 and tomorrow is 2026-05-26.';

export function RegexTesterUi() {
  const [pattern, setPattern] = useState('');
  const [text, setText] = useState('');
  const [flags, setFlags] = useState<RegexFlags>(DEFAULT_FLAGS);
  const [mode, setMode] = useState<Mode>('test');
  const [replacement, setReplacement] = useState('');
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [replaceResult, setReplaceResult] = useState<ReplaceResult | null>(null);

  const truncated = text.length > MAX_TEXT_LEN;

  const handleRun = () => {
    if (pattern.length === 0) {
      setTestResult(null);
      setReplaceResult(null);
      return;
    }
    const safeText = text.slice(0, MAX_TEXT_LEN);
    setTestResult(testRegex(pattern, flags, safeText));
    if (mode === 'replace') {
      setReplaceResult(replaceRegex(pattern, flags, safeText, replacement));
    } else {
      setReplaceResult(null);
    }
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
        <CardTitle className="text-xl">Regex Tester</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps Input forwardRef which biome can't detect statically */}
        <label className="block text-sm">
          <span className="block mb-1 text-muted-foreground">Pattern</span>
          <div className="flex gap-2">
            <span className="font-mono text-muted-foreground self-center">/</span>
            <Input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="e.g. (?<year>\d{4})-(?<month>\d{2})"
              className="font-mono"
            />
            <span className="font-mono text-muted-foreground self-center">/</span>
          </div>
        </label>

        <div className="flex flex-wrap gap-3 items-center text-sm">
          <span className="text-muted-foreground">Flags:</span>
          {FLAG_LABELS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={flags[key]}
                onChange={() => toggleFlag(key)}
                className="h-4 w-4"
              />
              <span className="text-xs">{label}</span>
            </label>
          ))}
          <Button variant="ghost" size="sm" onClick={tryExample}>
            Try example
          </Button>
        </div>

        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList>
            <TabsTrigger value="test">Test</TabsTrigger>
            <TabsTrigger value="replace">Replace</TabsTrigger>
          </TabsList>

          <TabsContent value="test" className="space-y-3">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Test text"
              rows={6}
            />
          </TabsContent>

          <TabsContent value="replace" className="space-y-3">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Test text"
              rows={6}
            />
            <Input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="Replacement (use $1, $2, $<name> for groups)"
              className="font-mono"
            />
          </TabsContent>
        </Tabs>

        <div className="flex items-center gap-3">
          <Button onClick={handleRun} disabled={pattern.length === 0}>
            Run
          </Button>
          {truncated && (
            <span className="text-xs text-destructive">
              Text capped at {MAX_TEXT_LEN.toLocaleString()} chars
            </span>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            {text.length.toLocaleString()} / {MAX_TEXT_LEN.toLocaleString()} chars
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
                {testResult.matches.length} match{testResult.matches.length === 1 ? '' : 'es'}
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
                        groups:{' '}
                        {m.groups.map((g, gi) => `$${gi + 1}=${JSON.stringify(g)}`).join(' · ')}
                      </div>
                    )}
                    {Object.keys(m.namedGroups).length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        named:{' '}
                        {Object.entries(m.namedGroups)
                          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                          .join(' · ')}
                      </div>
                    )}
                  </div>
                ))}
                {testResult.matches.length > 50 && (
                  <p className="text-xs text-muted-foreground">
                    Showing first 50 of {testResult.matches.length} matches.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {mode === 'replace' && replaceResult && (
          <div>
            <span className="block mb-1 text-xs uppercase tracking-wide text-muted-foreground">
              After replace
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
          Click <strong>Run</strong> to execute — avoids re-running on every keystroke. Text is
          capped at {MAX_TEXT_LEN.toLocaleString()} chars and execution at 1 second to prevent
          catastrophic backtracking from freezing the tab. Runs in your browser.
        </p>
      </CardContent>
    </Card>
  );
}
