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
} from '@anytools/ui';
import { useEffect, useState } from 'react';
import { type HashAlgo, type HashEncoding, hashFile, hashText } from './logic';

const ALL_ALGOS: HashAlgo[] = ['md5', 'sha-1', 'sha-256', 'sha-384', 'sha-512'];

type Mode = 'text' | 'file';

export function HashGeneratorUi() {
  const [mode, setMode] = useState<Mode>('text');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [encoding, setEncoding] = useState<HashEncoding>('hex');
  const [enabled, setEnabled] = useState<Set<HashAlgo>>(new Set(['md5', 'sha-1', 'sha-256']));
  const [results, setResults] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== 'text') return;
    let cancelled = false;
    const run = async () => {
      const out: Record<string, string> = {};
      for (const algo of ALL_ALGOS) {
        if (!enabled.has(algo)) continue;
        try {
          out[algo] = await hashText(text, algo, encoding);
        } catch {
          out[algo] = 'Error';
        }
      }
      if (!cancelled) setResults(out);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [text, encoding, enabled, mode]);

  const handleFile = async () => {
    if (!file) return;
    setBusy(true);
    const out: Record<string, string> = {};
    for (const algo of ALL_ALGOS) {
      if (!enabled.has(algo)) continue;
      out[algo] = await hashFile(file, algo, encoding);
    }
    setResults(out);
    setBusy(false);
  };

  const toggle = (algo: HashAlgo) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(algo)) next.delete(algo);
      else next.add(algo);
      return next;
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Hash Generator</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList>
            <TabsTrigger value="text">Text</TabsTrigger>
            <TabsTrigger value="file">File</TabsTrigger>
          </TabsList>
          <TabsContent value="text" className="space-y-3">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste text to hash"
              rows={4}
            />
          </TabsContent>
          <TabsContent value="file" className="space-y-3">
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm"
            />
            <Button onClick={handleFile} disabled={!file || busy}>
              {busy ? 'Hashing…' : 'Hash file'}
            </Button>
          </TabsContent>
        </Tabs>

        <div className="flex flex-wrap gap-3">
          <span className="text-sm text-muted-foreground">Algorithms:</span>
          {ALL_ALGOS.map((algo) => (
            <label key={algo} className="flex items-center gap-1 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={enabled.has(algo)}
                onChange={() => toggle(algo)}
                className="h-4 w-4"
              />
              {algo.toUpperCase()}
            </label>
          ))}
          <span className="ml-auto text-sm text-muted-foreground">Output:</span>
          {(['hex', 'base64'] as HashEncoding[]).map((enc) => (
            <label key={enc} className="flex items-center gap-1 text-sm cursor-pointer">
              <input
                type="radio"
                checked={encoding === enc}
                onChange={() => setEncoding(enc)}
                className="h-4 w-4"
              />
              {enc}
            </label>
          ))}
        </div>

        <div className="space-y-2">
          {ALL_ALGOS.filter((a) => enabled.has(a)).map((algo) => (
            <div key={algo}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {algo}
                </span>
                {results[algo] && <CopyButton text={results[algo]} />}
              </div>
              <pre className="rounded-md border bg-muted px-3 py-2 text-sm font-mono whitespace-pre-wrap break-all">
                {results[algo] || <span className="text-muted-foreground italic">—</span>}
              </pre>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          MD5 and SHA-1 are cryptographically broken — fine for non-security checksums, never for
          passwords or signatures. Use SHA-256+ for anything security-related.
        </p>
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
