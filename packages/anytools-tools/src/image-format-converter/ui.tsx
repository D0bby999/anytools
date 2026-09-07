'use client';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
  MultiFileDropzone,
  PrivacyNote,
  RangeSlider,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
          <MultiFileDropzone
            files={file ? [file] : []}
            onChange={(files) => setFile(files[0] ?? null)}
            accept="image/png,image/jpeg,image/webp,image/avif,image/gif"
            multiple={false}
            label={s.sourceImage}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ifc-target">{s.targetFormat}</Label>
            <Select value={target} onValueChange={(v) => setTarget(v as TargetFormat)}>
              <SelectTrigger id="ifc-target">
                <SelectValue>{target.toUpperCase()}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {FORMATS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {(target === 'jpeg' || target === 'webp') && (
            <RangeSlider
              label={s.qualityLabel}
              unit="%"
              value={Math.round(quality * 100)}
              min={10}
              max={100}
              step={5}
              onChange={(v) => setQuality(v / 100)}
            />
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
              <Button asChild size="sm">
                <a href={downloadUrl} download={downloadName}>
                  {s.downloadFile.replace('{name}', downloadName)}
                </a>
              </Button>
            </div>
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
