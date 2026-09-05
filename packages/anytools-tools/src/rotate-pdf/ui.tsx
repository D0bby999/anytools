'use client';
import { Card, CardContent, CardHeader, CardTitle, PrivacyNote, useLocalized } from '@anytools/ui';
import { useEffect, useState } from 'react';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { useObjectUrls } from '../shared/use-object-urls';
import { type RotateAngle, type RotateResult, readPageCount, rotatePdf } from './logic';
import { STRINGS } from './strings';

const ANGLES: RotateAngle[] = [90, 180, 270];

export function RotatePdfUi() {
  const s = useLocalized(STRINGS);
  // Revokes every URL this component created when it unmounts; without it each blob
  // stays pinned for the life of the document, and client-side navigation does not clear it.
  const objectUrls = useObjectUrls();
  const [files, setFiles] = useState<File[]>([]);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [angle, setAngle] = useState<RotateAngle>(90);
  const [allPages, setAllPages] = useState(true);
  const [range, setRange] = useState('');
  const [result, setResult] = useState<RotateResult | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const file = files[0] ?? null;

  useEffect(() => {
    if (!file) {
      setPageCount(null);
      return;
    }
    let cancelled = false;
    readPageCount(file)
      .then((n) => !cancelled && setPageCount(n))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : s.couldNotReadPdf));
    return () => {
      cancelled = true;
    };
  }, [file, s.couldNotReadPdf]);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const r = await rotatePdf(file, angle, allPages ? '' : range);
      setResult(r);
      setUrl((prev) => {
        if (prev) objectUrls.revoke(prev);
        return objectUrls.create(r.blob);
      });
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : s.failed);
    } finally {
      setBusy(false);
    }
  };

  const outName = file ? file.name.replace(/\.pdf$/i, '') : 'document';

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
            setUrl((prev) => {
              if (prev) objectUrls.revoke(prev);
              return null;
            });
          }}
          accept="application/pdf,.pdf"
          multiple={false}
          label={s.dropLabel}
        />

        {pageCount !== null && (
          <p className="text-sm text-muted-foreground">
            {(pageCount === 1 ? s.pageCountOne : s.pageCountMany).replace('{n}', String(pageCount))}
          </p>
        )}

        <label className="block text-sm">
          <span className="mb-1 block text-muted-foreground">{s.rotateBy}</span>
          <select
            value={angle}
            onChange={(e) => setAngle(Number(e.target.value) as RotateAngle)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm md:w-48"
          >
            {ANGLES.map((a) => (
              <option key={a} value={a}>
                {a}°
              </option>
            ))}
          </select>
        </label>

        <fieldset className="space-y-2">
          <legend className="text-sm text-muted-foreground">{s.whichPages}</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="rot" checked={allPages} onChange={() => setAllPages(true)} />
            {s.everyPage}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="rot"
              checked={!allPages}
              onChange={() => setAllPages(false)}
            />
            {s.onlyThese}
          </label>
          {!allPages && (
            <input
              type="text"
              value={range}
              onChange={(e) => setRange(e.target.value)}
              placeholder={pageCount ? `1-${pageCount}` : '1-3, 7'}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          )}
        </fieldset>

        <button
          type="button"
          onClick={run}
          disabled={!file || busy || (!allPages && !range.trim())}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy ? s.rotating : s.rotate.replace('{angle}', String(angle))}
        </button>

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {result && url && (
          <div className="space-y-3">
            <div className="rounded-md border bg-muted p-3 text-sm">
              {(result.pages === 1 ? s.rotatedOne : s.rotatedMany)
                .replace('{n}', String(result.rotated))
                .replace('{total}', String(result.pages))}
            </div>
            <a
              href={url}
              download={`${outName}-rotated.pdf`}
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              {s.download.replace('{name}', `${outName}-rotated.pdf`)}
            </a>
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
