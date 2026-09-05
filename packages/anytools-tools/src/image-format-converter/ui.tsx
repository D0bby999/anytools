'use client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PrivacyNote,
  useLocalized,
  useUiStrings,
} from '@anytools/ui';
import { useEffect, useState } from 'react';
import { toolErrorText } from '../shared/tool-error';
import { type ConvertResult, type TargetFormat, convertImage } from './logic';
import { STRINGS } from './strings';

const FORMATS: TargetFormat[] = ['png', 'jpeg', 'webp'];

export function ImageFormatConverterUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState<TargetFormat>('webp');
  const [quality, setQuality] = useState(0.9);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!file) {
      setResult(null);
      setDownloadUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setError(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError(null);
    convertImage(file, target, quality)
      .then((r) => {
        if (cancelled) return;
        setResult(r);
        setDownloadUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(r.blob);
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setResult(null);
        setError(toolErrorText(e, s, ui.conversionFailed));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [file, target, quality, s, ui.conversionFailed]);

  // Cleanup object URL on unmount
  useEffect(
    () => () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [],
  );

  const fileExt = target === 'jpeg' ? 'jpg' : target;
  const downloadName = file
    ? `${file.name.replace(/\.[^.]+$/, '')}.${fileExt}`
    : `image.${fileExt}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="text-sm">
            <span className="block mb-1 text-muted-foreground">{s.sourceImage}</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/avif,image/gif"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:opacity-90"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="block mb-1 text-muted-foreground">{s.targetFormat}</span>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value as TargetFormat)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          {(target === 'jpeg' || target === 'webp') && (
            <label className="text-sm">
              <span className="block mb-1 text-muted-foreground">
                {s.quality.replace('{p}', String(Math.round(quality * 100)))}
              </span>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                className="w-full"
              />
            </label>
          )}
        </div>

        {busy && <p className="text-sm text-muted-foreground">{s.converting}</p>}

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {result && downloadUrl && (
          <div className="space-y-3">
            <div className="rounded-md border bg-muted p-3 text-sm">
              <div>
                {result.width} × {result.height} px
              </div>
              <div>
                {(result.sizeBefore / 1024).toFixed(1)} KB → {(result.sizeAfter / 1024).toFixed(1)}{' '}
                KB ({((1 - result.sizeAfter / result.sizeBefore) * 100).toFixed(1)}%{' '}
                {result.sizeAfter > result.sizeBefore ? s.larger : s.smaller})
              </div>
            </div>
            <div className="flex flex-col items-center gap-3">
              {/* biome-ignore lint/performance/noImgElement: blob URL preview, not optimizable */}
              <img
                src={downloadUrl}
                alt={s.convertedPreview}
                className="max-w-full max-h-80 rounded border"
              />
              <a
                href={downloadUrl}
                download={downloadName}
                className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                {s.downloadFile.replace('{name}', downloadName)}
              </a>
            </div>
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
