'use client';
import { trackEvent } from '@anytools/analytics';
import { Card, CardContent, CardHeader, CardTitle, CopyButton, PrivacyNote } from '@anytools/ui';
import { useEffect, useState } from 'react';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import {
  OCR_LANGUAGES,
  OCR_LANGUAGE_LABELS,
  OcrCancelledError,
  type OcrLanguage,
  terminateOcr,
} from '../shared/tesseract-loader';
import { useObjectUrls } from '../shared/use-object-urls';
import {
  type ImageOcrItem,
  type ImageOcrProgress,
  combineText,
  meanConfidence,
  ocrImages,
  textFileName,
} from './logic';

/**
 * What `createImageBitmap` can actually decode in a browser. TIFF was listed here and is not one
 * of them — no engine decodes it — so offering it only produced a file picker that accepted a
 * scan the tool then rejected one by one. The FAQ says what to do with a TIFF instead.
 */
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp';

/** Tesseract's status strings are internal jargon; these are the three the user ever waits on. */
const STAGE_LABELS: Record<string, string> = {
  'loading tesseract core': 'Starting the recogniser',
  'loading language traineddata': 'Loading the language',
  'initializing api': 'Starting the recogniser',
  'recognizing text': 'Reading',
};

export function OcrImageToTextUi() {
  const objectUrls = useObjectUrls();
  const [files, setFiles] = useState<File[]>([]);
  const [lang, setLang] = useState<OcrLanguage>('eng');
  const [keepLineBreaks, setKeepLineBreaks] = useState(false);
  const [items, setItems] = useState<ImageOcrItem[] | null>(null);
  const [text, setText] = useState('');
  const [progress, setProgress] = useState<ImageOcrProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);

  // The worker holds a compiled 3.8 MB WASM module and the language data. Leaving the page
  // without terminating it strands both for the life of the tab.
  useEffect(
    () => () => {
      void terminateOcr();
    },
    [],
  );

  const run = async () => {
    if (files.length === 0 || busy) return;
    trackEvent('tool_run', { tool: 'ocr-image-to-text' });
    setBusy(true);
    setStopping(false);
    setError(null);
    setItems(null);
    setText('');
    try {
      const result = await ocrImages(files, lang, setProgress);
      setItems(result);
      setText(combineText(result, keepLineBreaks));
    } catch (e) {
      if (!(e instanceof OcrCancelledError)) {
        setError(e instanceof Error ? e.message : 'The image could not be read.');
      }
    } finally {
      // Only here. Clearing `busy` inside stop() re-enabled the button while the loop was still
      // unwinding, and a second press then ran two loops over the same batch at once.
      setBusy(false);
      setStopping(false);
      setProgress(null);
    }
  };

  const stop = () => {
    setStopping(true);
    void terminateOcr();
  };

  const reset = () => {
    setItems(null);
    setText('');
    setError(null);
  };

  const confidence = items ? meanConfidence(items) : 0;
  const failed = items?.filter((i) => i.error).length ?? 0;
  const read = (items?.length ?? 0) - failed;
  const download = () => {
    const url = objectUrls.create(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = textFileName(items ?? []);
    a.click();
    setTimeout(() => objectUrls.revoke(url), 30_000);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Image to Text (OCR)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <MultiFileDropzone
          files={files}
          onChange={(f) => {
            setFiles(f);
            reset();
          }}
          accept={ACCEPT}
          multiple
          label="Images to read"
        />

        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Language of the text</span>
            <select
              value={lang}
              onChange={(e) => {
                setLang(e.target.value as OcrLanguage);
                reset();
              }}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {OCR_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {OCR_LANGUAGE_LABELS[l]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={keepLineBreaks}
              onChange={(e) => {
                const next = e.target.checked;
                setKeepLineBreaks(next);
                // Re-joins the blocks already recognised — no second OCR pass. Any manual edit
                // in the textarea is replaced, which is why the toggle sits above it.
                if (items) setText(combineText(items, next));
              }}
            />
            Keep line breaks inside each block
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={run}
            disabled={files.length === 0 || busy}
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
          >
            {busy ? 'Reading…' : 'Recognize text'}
          </button>
          {busy && (
            <button
              type="button"
              onClick={stop}
              disabled={stopping}
              className="inline-flex h-10 items-center justify-center rounded-md border px-4 text-sm font-medium hover:bg-muted disabled:opacity-40"
            >
              {stopping ? 'Stopping…' : 'Stop'}
            </button>
          )}
        </div>

        {stopping && (
          <p className="text-sm text-muted-foreground">
            Stopping. The run is abandoned, so no text comes out of it — read the images in smaller
            batches if a full one is too long.
          </p>
        )}

        {progress && !stopping && (
          <p className="text-sm text-muted-foreground">
            {STAGE_LABELS[progress.stage.status] ?? 'Working'} — image {progress.index} of{' '}
            {progress.total} ({Math.round((progress.stage.progress ?? 0) * 100)}%)
          </p>
        )}

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {items && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Average confidence {confidence.toFixed(0)}%{read > 1 && ` across ${read} images`}.{' '}
              {failed > 0 &&
                `${failed} of ${items.length} could not be read at all — see the list below. `}
              {confidence > 0 && confidence < 70
                ? 'Below about 70% the output usually needs correcting — a sharper, straighter, higher-resolution image is the fix.'
                : 'Check the text below before using it; OCR is never exact.'}
            </p>

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              rows={14}
              aria-label="Recognised text"
              className="w-full rounded-md border border-input bg-background p-3 font-mono text-sm"
            />

            <div className="flex flex-wrap gap-2">
              <CopyButton text={text} size="default" />
              <button
                type="button"
                onClick={download}
                className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Download .txt
              </button>
            </div>

            {/* A file that failed is listed even when it is the only one: silently returning an
                empty textarea would look like the image had no text in it. */}
            {(items.length > 1 || failed > 0) && (
              <ul className="space-y-1 text-xs">
                {items.map((i) => (
                  <li
                    key={i.name}
                    className={i.error ? 'text-destructive' : 'text-muted-foreground'}
                  >
                    {i.name} —{' '}
                    {i.error ?? `${i.words} words, ${i.confidence.toFixed(0)}% confidence`}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
