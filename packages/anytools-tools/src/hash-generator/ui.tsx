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
import { useEffect, useState } from 'react';
import { type HashAlgo, type HashEncoding, hashFile, hashText, hmac } from './logic';
import { STRINGS } from './strings';

const ALL_ALGOS: HashAlgo[] = ['md5', 'sha-1', 'sha-256', 'sha-384', 'sha-512'];
// WebCrypto has no HMAC-MD5, and it would be the wrong default even if it did.
const HMAC_ALGOS = ALL_ALGOS.filter((a): a is Exclude<HashAlgo, 'md5'> => a !== 'md5');

type Mode = 'text' | 'file' | 'hmac';

export function HashGeneratorUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const [mode, setMode] = useState<Mode>('text');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [encoding, setEncoding] = useState<HashEncoding>('hex');
  const [enabled, setEnabled] = useState<Set<HashAlgo>>(new Set(['md5', 'sha-1', 'sha-256']));
  const [results, setResults] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [hmacKey, setHmacKey] = useState('');

  useEffect(() => {
    if (mode !== 'hmac') return;
    let cancelled = false;
    const run = async () => {
      const out: Record<string, string> = {};
      for (const algo of HMAC_ALGOS) {
        if (!enabled.has(algo)) continue;
        try {
          out[algo] = await hmac(hmacKey, text, algo, encoding);
        } catch {
          out[algo] = s.error;
        }
      }
      if (!cancelled) setResults(out);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [mode, text, hmacKey, encoding, enabled, s.error]);

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
          out[algo] = s.error;
        }
      }
      if (!cancelled) setResults(out);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [text, encoding, enabled, mode, s.error]);

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
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList>
            <TabsTrigger value="text">{s.tabText}</TabsTrigger>
            <TabsTrigger value="file">{s.tabFile}</TabsTrigger>
            <TabsTrigger value="hmac">HMAC</TabsTrigger>
          </TabsList>
          <TabsContent value="text" className="space-y-3">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={s.pasteText}
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
              {busy ? s.hashing : s.hashFile}
            </Button>
          </TabsContent>
          {/* HMAC is keyed: unlike a plain hash it proves the message came from someone
              holding the secret. logic.hmac() has existed and been tested against RFC 4231
              since this tool shipped; it was simply never surfaced. */}
          <TabsContent value="hmac" className="space-y-3">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={s.messageToAuthenticate}
              rows={3}
            />
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">{s.secretKey}</span>
              <input
                type="text"
                value={hmacKey}
                onChange={(e) => setHmacKey(e.target.value)}
                placeholder={s.sharedSecret}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-mono"
              />
            </label>
            <p className="text-sm text-muted-foreground">{s.hmacNote}</p>
          </TabsContent>
        </Tabs>

        <div className="flex flex-wrap gap-3">
          <span className="text-sm text-muted-foreground">{s.algorithms}</span>
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
          <span className="ml-auto text-sm text-muted-foreground">{ui.output}:</span>
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

        <p className="text-xs text-muted-foreground">{s.weakNote}</p>
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
