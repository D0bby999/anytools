'use client';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import { decodeUrlComponent, encodeUrl, encodeUrlComponent } from './logic';

type Mode = 'component' | 'full' | 'decode';

const EXAMPLES: Record<Mode, string> = {
  component: 'hello world & special chars',
  full: 'https://example.com/path with space?q=hello world',
  decode: 'hello%20world%20%26%20special%20chars',
};

export function UrlEncodeUi() {
  const [mode, setMode] = useState<Mode>('component');
  const [input, setInput] = useState('');

  const result = useMemo(() => {
    if (input.length === 0) return { value: '', error: '' };
    try {
      if (mode === 'component') return { value: encodeUrlComponent(input), error: '' };
      if (mode === 'full') return { value: encodeUrl(input), error: '' };
      return { value: decodeUrlComponent(input), error: '' };
    } catch (e) {
      return { value: '', error: e instanceof Error ? e.message : 'Conversion failed' };
    }
  }, [input, mode]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">URL Encoder / Decoder</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList>
            <TabsTrigger value="component">Encode component</TabsTrigger>
            <TabsTrigger value="full">Encode full URL</TabsTrigger>
            <TabsTrigger value="decode">Decode</TabsTrigger>
          </TabsList>
          <TabsContent value="component">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={EXAMPLES.component}
              rows={4}
              aria-label="Input"
            />
          </TabsContent>
          <TabsContent value="full">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={EXAMPLES.full}
              rows={4}
              aria-label="Input"
            />
          </TabsContent>
          <TabsContent value="decode">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={EXAMPLES.decode}
              rows={4}
              aria-label="Input"
            />
          </TabsContent>
        </Tabs>

        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setInput(EXAMPLES[mode])}>
            Try example
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setInput('')}
            disabled={input.length === 0}
          >
            Clear
          </Button>
        </div>

        {result.error ? (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {result.error}
          </output>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Output</span>
              {result.value && <CopyButton text={result.value} />}
            </div>
            <output className="block min-h-[80px] rounded-md border bg-muted px-3 py-2 text-sm font-mono whitespace-pre-wrap break-all">
              {result.value || (
                <span className="text-muted-foreground italic">Waiting for input…</span>
              )}
            </output>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Runs in your browser. Input never leaves your device.
        </p>
      </CardContent>
    </Card>
  );
}
