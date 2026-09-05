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
import { decodeBase64, decodeBase64Url, encodeBase64, encodeBase64Url } from './logic';
import { STRINGS } from './strings';

type Mode = 'encode' | 'decode';

const EXAMPLES = {
  encode: 'Hello, 世界 🌏',
  decode: 'SGVsbG8sIOS4lueVjCDwn4yP',
};

export function Base64ToolUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const [mode, setMode] = useState<Mode>('encode');
  const [urlSafe, setUrlSafe] = useState(false);
  const [input, setInput] = useState('');

  const result = useMemo(() => {
    if (input.length === 0) return { value: '', error: '' };
    try {
      if (mode === 'encode') {
        return { value: urlSafe ? encodeBase64Url(input) : encodeBase64(input), error: '' };
      }
      return { value: urlSafe ? decodeBase64Url(input) : decodeBase64(input), error: '' };
    } catch (e) {
      return { value: '', error: e instanceof Error ? e.message : ui.conversionFailed };
    }
  }, [input, mode, urlSafe, ui.conversionFailed]);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="text-xl">{s.title}</CardTitle>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={urlSafe}
            onChange={(e) => setUrlSafe(e.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          {s.urlSafe}
        </label>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList>
            <TabsTrigger value="encode">{ui.encode}</TabsTrigger>
            <TabsTrigger value="decode">{ui.decode}</TabsTrigger>
          </TabsList>

          <TabsContent value="encode" className="space-y-3">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={EXAMPLES.encode}
              rows={5}
              aria-label={s.plainInput}
            />
          </TabsContent>
          <TabsContent value="decode" className="space-y-3">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={EXAMPLES.decode}
              rows={5}
              aria-label={s.base64Input}
            />
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
