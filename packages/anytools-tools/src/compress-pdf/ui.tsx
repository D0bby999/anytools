'use client';
import { trackEvent } from '@anytools/analytics';
import { Card, CardContent, CardHeader, CardTitle, PrivacyNote, useLocalized } from '@anytools/ui';
import { useMemo, useState } from 'react';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { SHARED_ERROR_STRINGS } from '../shared/shared-error-strings';
import { toolErrorText } from '../shared/tool-error';
import { useObjectUrls } from '../shared/use-object-urls';
import { type CompressPdfResult, compressPdf } from './logic';
import { STRINGS } from './strings';

/** DPI presets offered in the select. `null` = no resolution cap. */
const DPI_OPTIONS: (number | null)[] = [null, 150, 300];

const kb = (n: number) =>
  n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;

export function CompressPdfUi() {
  const s = useLocalized(STRINGS);
  const sharedErrors = useLocalized(SHARED_ERROR_STRINGS);
  const errorStrings = useMemo(() => ({ ...sharedErrors, ...s }), [sharedErrors, s]);
  const objectUrls = useObjectUrls();

  const [files, setFiles] = useState<File[]>([]);
  const [quality, setQuality] = useState(60);
  const [maxDpi, setMaxDpi] = useState<number | null>(150);
  const [result, setResult] = useState<CompressPdfResult | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const file = files[0] ?? null;

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    trackEvent('tool_run', { tool: 'compress-pdf' });
    try {
      const r = await compressPdf(file, { quality, maxDpi });
      setResult(r);
      setUrl((prev) => {
        if (prev) objectUrls.revoke(prev);
        return objectUrls.create(r.blob);
      });
    } catch (e) {
      setResult(null);
      setError(toolErrorText(e, errorStrings, s.failed));
    } finally {
      setBusy(false);
    }
  };

  const outName = file ? `${file.name.replace(/\.pdf$/i, '')}-compressed.pdf` : 'compressed.pdf';

  const pct = result
    ? result.sizeAfter === result.sizeBefore
      ? s.aboutSame
      : result.sizeAfter < result.sizeBefore
        ? s.smaller.replace('{n}', ((1 - result.sizeAfter / result.sizeBefore) * 100).toFixed(0))
        : s.larger.replace('{n}', ((result.sizeAfter / result.sizeBefore - 1) * 100).toFixed(0))
    : '';

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
          }}
          accept="application/pdf,.pdf"
          multiple={false}
          label={s.dropLabel}
        />

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">
              {s.quality.replace('{n}', String(quality))}
            </span>
            <input
              type="range"
              min={10}
              max={95}
              step={5}
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
              className="w-full"
            />
            <span className="mt-1 block text-xs text-muted-foreground">{s.qualityHint}</span>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">{s.maxDpi}</span>
            <select
              value={maxDpi ?? ''}
              onChange={(e) => setMaxDpi(e.target.value ? Number(e.target.value) : null)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {DPI_OPTIONS.map((dpi) => (
                <option key={dpi ?? 'none'} value={dpi ?? ''}>
                  {dpi === null ? s.maxDpiNone : s.maxDpiValue.replace('{n}', String(dpi))}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button
          type="button"
          onClick={run}
          disabled={!file || busy}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy ? s.compressing : s.compress}
        </button>

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {result && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {(result.pageCount === 1 ? s.pageCountOne : s.pageCountMany).replace(
                '{n}',
                String(result.pageCount),
              )}
            </p>
            <div className="rounded-md border bg-muted p-3 text-sm">
              {s.summary
                .replace('{recompressed}', String(result.imagesRecompressed))
                .replace('{total}', String(result.imagesRecompressed + result.imagesSkipped))
                .replace('{skipped}', String(result.imagesSkipped))
                .replace('{before}', kb(result.sizeBefore))
                .replace('{after}', kb(result.sizeAfter))
                .replace('{pct}', pct)}
            </div>
            {result.imagesRecompressed === 0 && (
              <output className="block rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                {s.noImages}
              </output>
            )}
            {url && (
              <a
                href={url}
                download={outName}
                className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                {s.download.replace('{name}', outName)}
              </a>
            )}
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
