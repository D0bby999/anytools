'use client';
import { trackEvent } from '@anytools/analytics';
import {
  Button,
  FilePipelineTemplate,
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
} from '@anytools/ui';
import { useMemo, useState } from 'react';
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
    <FilePipelineTemplate
      title={s.title}
      dropzone={
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
      }
      result={
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <RangeSlider
                label={s.qualityLabel}
                unit="%"
                value={quality}
                min={10}
                max={95}
                step={5}
                onChange={setQuality}
              />
              <p className="text-xs text-muted-foreground">{s.qualityHint}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cpdf-dpi">{s.maxDpi}</Label>
              {/* Radix reserves the empty string for "nothing selected", so "no cap" needs a real
                sentinel value rather than ''. */}
              <Select
                value={maxDpi === null ? 'none' : String(maxDpi)}
                onValueChange={(v) => setMaxDpi(v === 'none' ? null : Number(v))}
              >
                <SelectTrigger id="cpdf-dpi">
                  <SelectValue>
                    {maxDpi === null ? s.maxDpiNone : s.maxDpiValue.replace('{n}', String(maxDpi))}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {DPI_OPTIONS.map((dpi) => (
                    <SelectItem key={dpi ?? 'none'} value={dpi === null ? 'none' : String(dpi)}>
                      {dpi === null ? s.maxDpiNone : s.maxDpiValue.replace('{n}', String(dpi))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button type="button" onClick={run} disabled={!file || busy}>
            {busy ? s.compressing : s.compress}
          </Button>

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
                <Button asChild>
                  <a href={url} download={outName}>
                    {s.download.replace('{name}', outName)}
                  </a>
                </Button>
              )}
            </div>
          )}
        </>
      }
      disclaimer={<PrivacyNote />}
    />
  );
}
