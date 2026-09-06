'use client';
import { trackEvent } from '@anytools/analytics';
import {
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
} from '@anytools/ui';
import { useEffect, useMemo, useState } from 'react';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { toolErrorText } from '../shared/tool-error';
import { useObjectUrls } from '../shared/use-object-urls';
import {
  BASE64_SIZE_WARN_BYTES,
  type EncodedImage,
  cssBackgroundImage,
  cssUrlFunction,
  dataUriToBlob,
  encodeImageFile,
  extensionFromMime,
  htmlImgTag,
  markdownImage,
  parseDataUri,
} from './logic';
import { STRINGS } from './strings';

const SLUG = 'image-to-base64';
const kb = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`;

/** A labelled snippet with its own copy button — reused for all four paste-ready formats. */
function Snippet({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        <CopyButton text={value} />
      </div>
      <output className="block max-h-24 overflow-auto rounded-md border bg-muted px-3 py-2 text-xs font-mono break-all whitespace-pre-wrap">
        {value}
      </output>
    </div>
  );
}

export function ImageToBase64Ui() {
  const s = useLocalized(STRINGS);
  const objectUrls = useObjectUrls();

  const [mode, setMode] = useState<'encode' | 'decode'>('encode');

  // --- Encode: image file -> data URI ---
  // The effect only fetches/decodes; it stores the raw thrown value rather than a localized
  // string, so `s` (the locale table) never needs to be a dependency here.
  const [files, setFiles] = useState<File[]>([]);
  const [encoded, setEncoded] = useState<EncodedImage | null>(null);
  const [encodeErrorRaw, setEncodeErrorRaw] = useState<unknown>(null);

  useEffect(() => {
    const file = files[0];
    if (!file) {
      setEncoded(null);
      setEncodeErrorRaw(null);
      return;
    }
    let cancelled = false;
    trackEvent('tool_run', { tool: SLUG });
    encodeImageFile(file)
      .then((r) => {
        if (cancelled) return;
        setEncoded(r);
        setEncodeErrorRaw(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setEncoded(null);
        setEncodeErrorRaw(e);
      });
    return () => {
      cancelled = true;
    };
  }, [files]);

  const encodeError = encodeErrorRaw ? toolErrorText(encodeErrorRaw, s, s.failed) : null;
  const growth = encoded
    ? Math.round(((encoded.sizeAfter - encoded.sizeBefore) / encoded.sizeBefore) * 100)
    : 0;

  // --- Decode: pasted data URI -> image + download ---
  // Pure derivation from `pasted` — no state, no side effects, so nothing needs debouncing or
  // an effect: parsing a data URI is cheap even for a large paste.
  const [pasted, setPasted] = useState('');
  const [downloadErrorRaw, setDownloadErrorRaw] = useState<unknown>(null);

  const parsed = useMemo(() => {
    if (!pasted.trim()) return { dataUri: null, mime: null, errorRaw: null as unknown };
    try {
      const { mime } = parseDataUri(pasted);
      return { dataUri: pasted.trim(), mime, errorRaw: null as unknown };
    } catch (e) {
      return { dataUri: null, mime: null, errorRaw: e as unknown };
    }
  }, [pasted]);

  const decodeErrorRaw = parsed.errorRaw ?? downloadErrorRaw;
  const decodeError = decodeErrorRaw ? toolErrorText(decodeErrorRaw, s, s.decodeFailed) : null;

  const downloadDecoded = () => {
    if (!parsed.dataUri) return;
    setDownloadErrorRaw(null);
    try {
      const blob = dataUriToBlob(parsed.dataUri);
      const url = objectUrls.create(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `image.${extensionFromMime(blob.type)}`;
      a.click();
      setTimeout(() => objectUrls.revoke(url), 30_000);
      trackEvent('tool_run', { tool: SLUG });
    } catch (e) {
      setDownloadErrorRaw(e);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={mode} onValueChange={(v) => setMode(v as 'encode' | 'decode')}>
          <TabsList>
            <TabsTrigger value="encode">{s.tabEncode}</TabsTrigger>
            <TabsTrigger value="decode">{s.tabDecode}</TabsTrigger>
          </TabsList>

          <TabsContent value="encode" className="space-y-4">
            <MultiFileDropzone
              files={files}
              onChange={setFiles}
              accept="image/*"
              multiple={false}
              label={s.dropLabel}
            />

            {encodeError && (
              <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {encodeError}
              </output>
            )}

            {encoded && (
              <div className="space-y-4">
                {encoded.sizeAfter > BASE64_SIZE_WARN_BYTES && (
                  <output className="block rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                    {s.sizeWarning
                      .replace('{encoded}', kb(encoded.sizeAfter))
                      .replace('{percent}', String(growth))
                      .replace('{original}', kb(encoded.sizeBefore))}
                  </output>
                )}
                <img src={encoded.dataUri} alt={encoded.name} className="max-h-48 rounded border" />
                <Snippet label={s.dataUri} value={encoded.dataUri} />
                <Snippet label={s.htmlTag} value={htmlImgTag(encoded.dataUri)} />
                <Snippet label={s.cssBackground} value={cssBackgroundImage(encoded.dataUri)} />
                <Snippet label={s.cssUrl} value={cssUrlFunction(encoded.dataUri)} />
                <Snippet label={s.markdown} value={markdownImage(encoded.dataUri)} />
              </div>
            )}
          </TabsContent>

          <TabsContent value="decode" className="space-y-4">
            <div className="text-sm">
              <span className="mb-1 block text-muted-foreground">{s.pasteLabel}</span>
              <Textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder={s.pastePlaceholder}
                rows={6}
                aria-label={s.pasteLabel}
                className="font-mono text-xs"
              />
            </div>

            {decodeError && (
              <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {decodeError}
              </output>
            )}

            {parsed.dataUri && parsed.mime && (
              <div className="space-y-3">
                <img
                  src={parsed.dataUri}
                  alt={s.decodePreviewAlt}
                  className="max-h-64 rounded border"
                />
                <button
                  type="button"
                  onClick={downloadDecoded}
                  className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  {s.downloadDecoded}
                </button>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
