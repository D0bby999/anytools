'use client';
import { trackEvent } from '@anytools/analytics';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  PrivacyNote,
  SegmentedControl,
  useLocalized,
} from '@anytools/ui';
import { useEffect, useState } from 'react';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { toolErrorText } from '../shared/tool-error';
import { useObjectUrls } from '../shared/use-object-urls';
import { type ConvertTarget, type FontConvertResult, convertFont } from './logic';
import { type FontFlavor, detectFontFlavor } from './sfnt-woff';
import { STRINGS } from './strings';

const fmtSize = (n: number) =>
  n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`;

const DEFAULT_PREVIEW = 'Xin chào — áàảãạ ăâêôơư đ';

export function FontConverterUi() {
  const s = useLocalized(STRINGS);
  const objectUrls = useObjectUrls();
  const [files, setFiles] = useState<File[]>([]);
  const [flavor, setFlavor] = useState<FontFlavor | null>(null);
  const [target, setTarget] = useState<ConvertTarget>('native');
  const [subsetText, setSubsetText] = useState('');
  const [previewText, setPreviewText] = useState(DEFAULT_PREVIEW);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FontConvertResult | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [previewFamily, setPreviewFamily] = useState<string | null>(null);

  const file = files[0] ?? null;

  // Sniff the container as soon as a file is picked, so "Detected: …" does not wait for a
  // round trip through the converter.
  // objectUrls has a stable identity (useObjectUrls), safe to omit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useEffect(() => {
    setResult(null);
    setError(null);
    setUrl((prev) => {
      objectUrls.revoke(prev);
      return null;
    });
    if (!file) {
      setFlavor(null);
      return;
    }
    let cancelled = false;
    file.arrayBuffer().then((buf) => {
      if (!cancelled) setFlavor(detectFontFlavor(new Uint8Array(buf)));
    });
    return () => {
      cancelled = true;
    };
  }, [file]);

  // Load the converted font into the page so `previewText` renders in it. FontFace objects are
  // registered globally on `document.fonts`, so the one from a previous result must be removed
  // before (or when unmounting) — otherwise every conversion on this page leaks one font forever.
  useEffect(() => {
    if (!result) {
      setPreviewFamily(null);
      return;
    }
    let cancelled = false;
    const family = `font-converter-preview-${Date.now()}`;
    let face: FontFace | null = null;
    result.blob
      .arrayBuffer()
      .then((buf) => {
        if (cancelled) return null;
        face = new FontFace(family, buf);
        return face.load();
      })
      .then((loaded) => {
        if (cancelled || !loaded) return;
        document.fonts.add(loaded);
        setPreviewFamily(family);
      })
      .catch(() => {
        // Not every browser can render every outline flavor (e.g. some builds are TTF-only) —
        // the download still works even when the live preview cannot render.
      });
    return () => {
      cancelled = true;
      if (face) document.fonts.delete(face);
    };
  }, [result]);

  const run = async () => {
    if (!file) return;
    trackEvent('tool_run', { tool: 'font-converter' });
    setBusy(true);
    setError(null);
    try {
      const r = await convertFont(file, { target, subsetText });
      setResult(r);
      setUrl(objectUrls.create(r.blob));
    } catch (e) {
      setError(toolErrorText(e, s, s.convertFailed));
    } finally {
      setBusy(false);
    }
  };

  const percentSmaller =
    result && result.inputBytes > 0
      ? Math.round(((result.inputBytes - result.outputBytes) / result.inputBytes) * 100)
      : 0;
  const filename = file
    ? `${file.name.replace(/\.[^.]+$/, '')}${result?.subsetted ? '-subset' : ''}.${result?.extension ?? 'ttf'}`
    : `font.${result?.extension ?? 'ttf'}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <MultiFileDropzone
          files={files}
          onChange={setFiles}
          accept=".ttf,.otf,.woff"
          multiple={false}
          label={s.fileLabel}
        />

        {flavor && flavor !== 'unknown' && (
          <p className="text-sm text-muted-foreground">
            {s.detectedFlavor.replace('{flavor}', flavor.toUpperCase())}
          </p>
        )}

        <SegmentedControl
          value={target}
          onChange={setTarget}
          label={s.targetLabel}
          options={[
            { value: 'native', label: s.targetNative },
            { value: 'woff', label: s.targetWoff },
          ]}
        />

        <div className="space-y-1 text-sm">
          <label htmlFor="font-converter-subset" className="block text-muted-foreground">
            {s.subsetLabel}
          </label>
          <Input
            id="font-converter-subset"
            value={subsetText}
            onChange={(e) => setSubsetText(e.target.value)}
            placeholder={s.subsetPlaceholder}
          />
        </div>

        <button
          type="button"
          onClick={run}
          disabled={!file || busy}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy ? s.converting : s.convert}
        </button>

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {result && url && (
          <div className="space-y-3 rounded-md border bg-muted/40 p-3">
            <p className="text-sm text-muted-foreground">
              {(result.outputBytes < result.inputBytes ? s.summary : s.summaryGrew)
                .replace('{in}', fmtSize(result.inputBytes))
                .replace('{out}', fmtSize(result.outputBytes))
                .replace('{percent}', String(percentSmaller))}
            </p>
            {result.subsetted && (
              <p className="text-sm text-muted-foreground">
                {s.subsetSummary.replace('{n}', String(result.subsetCharCount))}
              </p>
            )}

            <a
              href={url}
              download={filename}
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              {s.download}
            </a>

            <div className="space-y-1 text-sm">
              <label htmlFor="font-converter-preview" className="block text-muted-foreground">
                {s.previewLabel}
              </label>
              <Input
                id="font-converter-preview"
                value={previewText}
                onChange={(e) => setPreviewText(e.target.value)}
              />
            </div>
            {previewFamily && (
              <p
                className="rounded-md border bg-background px-3 py-4 text-2xl"
                style={{ fontFamily: `"${previewFamily}"` }}
              >
                {previewText}
              </p>
            )}
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
