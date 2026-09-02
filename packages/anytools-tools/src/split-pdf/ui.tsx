'use client';
import { Card, CardContent, CardHeader, CardTitle, PrivacyNote } from '@anytools/ui';
import { useEffect, useState } from 'react';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { useObjectUrls } from '../shared/use-object-urls';
import { type SplitResult, readPageCount, splitPdf } from './logic';

export function SplitPdfUi() {
  // Revokes every URL this component created when it unmounts; without it each blob
  // stays pinned for the life of the document, and client-side navigation does not clear it.
  const objectUrls = useObjectUrls();
  const [files, setFiles] = useState<File[]>([]);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [mode, setMode] = useState<'ranges' | 'each'>('ranges');
  const [range, setRange] = useState('');
  const [result, setResult] = useState<SplitResult | null>(null);
  const [urls, setUrls] = useState<string[]>([]);
  const [zipUrl, setZipUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const file = files[0] ?? null;

  const revoke = () => {
    setUrls((prev) => {
      for (const u of prev) objectUrls.revoke(u);
      return [];
    });
    setZipUrl((prev) => {
      if (prev) objectUrls.revoke(prev);
      return null;
    });
  };

  // Read the page count as soon as a file lands, so the range field can say what is valid
  // instead of failing only on submit.
  useEffect(() => {
    if (!file) {
      setPageCount(null);
      return;
    }
    let cancelled = false;
    readPageCount(file)
      .then((n) => !cancelled && setPageCount(n))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not read PDF'));
    return () => {
      cancelled = true;
    };
  }, [file]);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    revoke();
    try {
      const r = await splitPdf(
        file,
        mode === 'each' ? { kind: 'each' } : { kind: 'ranges', range },
      );
      setResult(r);
      setUrls(r.parts.map((p) => objectUrls.create(p.blob)));
      setZipUrl(r.zip ? objectUrls.create(r.zip) : null);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : 'Split failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Split PDF</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <MultiFileDropzone
          files={files}
          onChange={(f) => {
            setFiles(f);
            setResult(null);
            setError(null);
            revoke();
          }}
          accept="application/pdf,.pdf"
          multiple={false}
          label="PDF to split"
        />

        {pageCount !== null && (
          <p className="text-sm text-muted-foreground">
            {pageCount} {pageCount === 1 ? 'page' : 'pages'}
          </p>
        )}

        <fieldset className="space-y-2">
          <legend className="text-sm text-muted-foreground">What to produce</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="split-mode"
              checked={mode === 'ranges'}
              onChange={() => setMode('ranges')}
            />
            Extract page ranges
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="split-mode"
              checked={mode === 'each'}
              onChange={() => setMode('each')}
            />
            One file per page
          </label>
        </fieldset>

        {mode === 'ranges' && (
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">
              Pages — e.g. <code>1-3, 7, 9-12</code>. Each run of consecutive pages becomes its own
              file.
            </span>
            <input
              type="text"
              value={range}
              onChange={(e) => setRange(e.target.value)}
              placeholder={pageCount ? `1-${pageCount}` : '1-3, 7'}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </label>
        )}

        <button
          type="button"
          onClick={run}
          disabled={!file || busy || (mode === 'ranges' && !range.trim())}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Splitting…' : 'Split PDF'}
        </button>

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {result && (
          <div className="space-y-3">
            {zipUrl && (
              <a
                href={zipUrl}
                download="split.zip"
                className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Download all {result.parts.length} as .zip
              </a>
            )}
            <ul className="space-y-1">
              {result.parts.map((p, i) => (
                <li
                  key={p.name}
                  className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm"
                >
                  <span className="truncate">
                    {p.name} — {p.pages} {p.pages === 1 ? 'page' : 'pages'}
                  </span>
                  <a href={urls[i]} download={p.name} className="shrink-0 underline">
                    Download
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
