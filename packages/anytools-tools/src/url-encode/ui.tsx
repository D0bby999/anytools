'use client';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  PrivacyNote,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  useLocalized,
  useUiStrings,
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import { toolErrorText } from '../shared/tool-error';
import { decodeUrlComponent, encodeUrl, encodeUrlComponent } from './logic';
import { STRINGS } from './strings';

type Mode = 'component' | 'full' | 'decode';

const EXAMPLES: Record<Mode, string> = {
  component: 'hello world & special chars',
  full: 'https://example.com/path with space?q=hello world',
  decode: 'hello%20world%20%26%20special%20chars',
};

export function UrlEncodeUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const [mode, setMode] = useState<Mode>('component');
  const [input, setInput] = useState('');
  const [plusAsSpace, setPlusAsSpace] = useState(true);

  const result = useMemo(() => {
    if (input.length === 0) return { value: '', error: '' };
    try {
      if (mode === 'component') return { value: encodeUrlComponent(input), error: '' };
      if (mode === 'full') return { value: encodeUrl(input), error: '' };
      return { value: decodeUrlComponent(input, { plusAsSpace }), error: '' };
    } catch (e) {
      return { value: '', error: toolErrorText(e, s, ui.conversionFailed) };
    }
  }, [input, mode, plusAsSpace, s, ui.conversionFailed]);

  const textarea = (
    <Textarea
      value={input}
      onChange={(e) => setInput(e.target.value)}
      placeholder={EXAMPLES[mode]}
      rows={4}
      aria-label={ui.input}
    />
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList>
            <TabsTrigger value="component">{s.encodeComponent}</TabsTrigger>
            <TabsTrigger value="full">{s.encodeFull}</TabsTrigger>
            <TabsTrigger value="decode">{ui.decode}</TabsTrigger>
          </TabsList>
          <TabsContent value="component">{textarea}</TabsContent>
          <TabsContent value="full">{textarea}</TabsContent>
          <TabsContent value="decode" className="space-y-3">
            {textarea}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={plusAsSpace}
                onChange={(e) => setPlusAsSpace(e.target.checked)}
                className="h-4 w-4"
              />
              {s.plusAsSpace}
            </label>
          </TabsContent>
        </Tabs>

        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setInput(EXAMPLES[mode])}>
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

        {result.error ? (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {result.error}
          </output>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {ui.output}
              </span>
              {result.value && <CopyButton text={result.value} />}
            </div>
            <output className="block min-h-[80px] rounded-md border bg-muted px-3 py-2 text-sm font-mono whitespace-pre-wrap break-all">
              {result.value || (
                <span className="text-muted-foreground italic">{ui.waitingForInput}</span>
              )}
            </output>
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
