'use client';
import { Card, CardContent, CardHeader, CardTitle, PrivacyNote } from '@anytools/ui';
import { useState } from 'react';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { useObjectUrls } from '../shared/use-object-urls';
import { type Dpi, type PdfToPngResult, pdfToPng } from './logic';

const DPIS: { value: Dpi; label: string }[] = [
  { value: 72, label: '72 — screen' },
  { value: 150, label: '150 — good print' },
  { value: 300, label: '300 — full print' },
];

export function PdfToPngUi() {
  // Revokes every URL this component created when it unmounts; without it each blob
  // stays pinned for the life of the document, and client-side navigation does not clear it.
  const objectUrls = useObjectUrls();
  const [files, setFiles] = useState<File[]>([]);
  const [dpi, setDpi] = useState<Dpi>(150);
  const [result, setResult] = useState<PdfToPngResult | null>(null);
  const [urls, setUrls] = useState<string[]>([]);
  const [zipUrl, setZipUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
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

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    revoke();
    setProgress({ done: 0, total: 0 });
    try {
      const r = await pdfToPng(file, dpi, (done, total) => setProgress({ done, total }));
      setResult(r);
      setUrls(r.pages.map((p) => objectUrls.create(p.blob)));
      setZipUrl(r.zip ? objectUrls.create(r.zip) : null);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : 'Render failed');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">PDF to PNG</CardTitle>
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
          label="PDF to render"
        />

        <fieldset className="space-y-2">
          <legend className="text-sm text-muted-foreground">Resolution</legend>
          {DPIS.map((d) => (
            <label key={d.value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="dpi"
                checked={dpi === d.value}
                onChange={() => setDpi(d.value)}
              />
              {d.label}
            </label>
          ))}
        </fieldset>

        <button
          type="button"
          onClick={run}
          disabled={!file || busy}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Rendering…' : 'Render to PNG'}
        </button>

        {progress && progress.total > 0 && (
          <p className="text-sm text-muted-foreground">
            Page {progress.done} of {progress.total}
          </p>
        )}

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
                download="pages.zip"
                className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Download all {result.pages.length} as .zip
              </a>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {result.pages.map((p, i) => (
                <figure key={p.name} className="space-y-1">
                  {/* biome-ignore lint/performance/noImgElement: blob URL preview, not optimizable */}
                  <img
                    src={urls[i]}
                    alt={`Page ${p.pageNumber}`}
                    className="w-full rounded border"
                  />
                  <figcaption className="text-xs text-muted-foreground">
                    p{p.pageNumber} · {p.width}×{p.height}{' '}
                    <a href={urls[i]} download={p.name} className="underline">
                      download
                    </a>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
