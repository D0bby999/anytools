'use client';
import {
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
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import { decodeHtml, encodeHtml } from './logic';

export function HtmlEntityUi() {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'encode' | 'decode'>('encode');
  const [encodeEverything, setEncodeEverything] = useState(false);

  const result = useMemo(() => {
    if (!text) return '';
    try {
      return mode === 'encode' ? encodeHtml(text, { encodeEverything }) : decodeHtml(text);
    } catch {
      return '';
    }
  }, [text, mode, encodeEverything]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">HTML Entity Encoder / Decoder</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={mode} onValueChange={(v) => setMode(v as 'encode' | 'decode')}>
          <TabsList>
            <TabsTrigger value="encode">Encode</TabsTrigger>
            <TabsTrigger value="decode">Decode</TabsTrigger>
          </TabsList>
          <TabsContent value="encode" className="space-y-3">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="<script>alert('xss')</script>"
              rows={5}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={encodeEverything}
                onChange={(e) => setEncodeEverything(e.target.checked)}
                className="h-4 w-4"
              />
              Encode every character (not just required)
            </label>
          </TabsContent>
          <TabsContent value="decode">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="&amp;lt;script&amp;gt;"
              rows={5}
            />
          </TabsContent>
        </Tabs>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Output</span>
            {result && <CopyButton text={result} />}
          </div>
          <pre className="rounded-md border bg-muted px-3 py-2 text-sm font-mono whitespace-pre-wrap break-all min-h-[80px]">
            {result || <span className="text-muted-foreground italic">—</span>}
          </pre>
        </div>
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
