'use client';
import { Card, CardContent, CardHeader, CardTitle, PrivacyNote, useLocalized } from '@anytools/ui';
import { useMemo, useState } from 'react';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { SHARED_ERROR_STRINGS } from '../shared/shared-error-strings';
import { toolErrorText } from '../shared/tool-error';
import { useObjectUrls } from '../shared/use-object-urls';
import { type ExtractResult, extractImagesFromPdf } from './logic';
import { STRINGS } from './strings';

export function ExtractImagesFromPdfUi() {
  const s = useLocalized(STRINGS);
  const sharedErrors = useLocalized(SHARED_ERROR_STRINGS);
  // Errors from the shared modules (canvas ceiling, page ranges, pdf.js…) under the tool's own keys.
  const errorStrings = useMemo(() => ({ ...sharedErrors, ...s }), [sharedErrors, s]);
  // Revokes every URL this component created when it unmounts; without it each blob
  // stays pinned for the life of the document, and client-side navigation does not clear it.
  const objectUrls = useObjectUrls();
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<ExtractResult | null>(null);
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
      const r = await extractImagesFromPdf(file, (done, total) => setProgress({ done, total }));
      setResult(r);
      setUrls(r.images.map((i) => objectUrls.create(i.blob)));
      setZipUrl(r.zip ? objectUrls.create(r.zip) : null);
    } catch (e) {
      setResult(null);
      setError(toolErrorText(e, errorStrings, s.failed));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
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
          label={s.dropLabel}
        />

        <button
          type="button"
          onClick={run}
          disabled={!file || busy}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy ? s.scanning : s.extract}
        </button>

        {progress && progress.total > 0 && (
          <p className="text-sm text-muted-foreground">
            {s.pageOf
              .replace('{n}', String(progress.done))
              .replace('{total}', String(progress.total))}
          </p>
        )}

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {result && result.images.length === 0 && (
          // Not an error: a text-only PDF genuinely has no embedded images, and saying so
          // is more useful than an empty panel that looks like a failure.
          <output className="block rounded-md border bg-muted px-3 py-2 text-sm">
            {s.noImages}
          </output>
        )}

        {result && result.images.length > 0 && (
          <div className="space-y-3">
            {zipUrl && (
              <a
                href={zipUrl}
                download="images.zip"
                className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                {s.downloadAllZip.replace('{n}', String(result.images.length))}
              </a>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {result.images.map((img, i) => (
                <figure key={img.name} className="space-y-1">
                  {/* biome-ignore lint/performance/noImgElement: blob URL preview, not optimizable */}
                  <img
                    src={urls[i]}
                    alt={s.extractedAlt.replace('{n}', String(img.pageNumber))}
                    className="w-full rounded border"
                  />
                  <figcaption className="text-xs text-muted-foreground">
                    p{img.pageNumber} · {img.width}×{img.height}{' '}
                    <a href={urls[i]} download={img.name} className="underline">
                      {s.downloadLink}
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
