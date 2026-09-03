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
import { type OcrPdfProgress, type OcrPdfResult, ocrPdf, outputName } from './logic';

const STAGE_LABELS: Record<string, string> = {
  'loading tesseract core': 'Starting the recogniser',
  'loading language traineddata': 'Loading the language',
  'initializing api': 'Starting the recogniser',
  'recognizing text': 'Reading',
};

export function OcrPdfUi() {
  const objectUrls = useObjectUrls();
  const [files, setFiles] = useState<File[]>([]);
  const [lang, setLang] = useState<OcrLanguage>('eng');
  const [range, setRange] = useState('');
  const [searchable, setSearchable] = useState(false);
  const [result, setResult] = useState<OcrPdfResult | null>(null);
  const [text, setText] = useState('');
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<OcrPdfProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const file = files[0] ?? null;

  useEffect(
    () => () => {
      void terminateOcr();
    },
    [],
  );

  const reset = () => {
    setResult(null);
    setText('');
    setError(null);
    setPdfUrl((prev) => {
      objectUrls.revoke(prev);
      return null;
    });
  };

  const run = async () => {
    if (!file) return;
    trackEvent('tool_run', { tool: 'ocr-pdf' });
    setBusy(true);
    reset();
    try {
      const r = await ocrPdf(file, { lang, range, searchable }, setProgress);
      setResult(r);
      setText(r.text);
      setPdfUrl(r.pdf ? objectUrls.create(r.pdf) : null);
    } catch (e) {
      if (e instanceof OcrCancelledError) return;
      setError(e instanceof Error ? e.message : 'This PDF could not be read.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const stop = async () => {
    await terminateOcr();
    setBusy(false);
    setProgress(null);
  };

  const downloadText = () => {
    if (!file) return;
    const url = objectUrls.create(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = outputName(file.name, 'ocr', 'txt');
    a.click();
    setTimeout(() => objectUrls.revoke(url), 30_000);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">OCR a Scanned PDF</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <MultiFileDropzone
          files={files}
          onChange={(f) => {
            setFiles(f);
            reset();
          }}
          accept="application/pdf,.pdf"
          multiple={false}
          label="Scanned PDF to read"
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

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">
              Pages — e.g. <code>1-3, 7</code>. Blank reads them all.
            </span>
            <input
              type="text"
              value={range}
              onChange={(e) => setRange(e.target.value)}
              placeholder="1-3, 7"
              className="h-10 w-40 rounded-md border border-input bg-background px-3 text-sm"
            />
          </label>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={searchable}
            onChange={(e) => {
              setSearchable(e.target.checked);
              reset();
            }}
            className="mt-1"
          />
          <span>
            Also build a searchable PDF
            <span className="block text-xs text-muted-foreground">
              The same scan, unchanged to look at, with the recognised words written over it
              invisibly so Ctrl+F and text selection work.
            </span>
          </span>
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={run}
            disabled={!file || busy}
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
          >
            {busy ? 'Reading…' : 'Recognize text'}
          </button>
          {busy && (
            <button
              type="button"
              onClick={stop}
              className="inline-flex h-10 items-center justify-center rounded-md border px-4 text-sm font-medium hover:bg-muted"
            >
              Stop
            </button>
          )}
        </div>

        {progress && (
          <p className="text-sm text-muted-foreground">
            {STAGE_LABELS[progress.stage.status] ?? 'Working'} — page {progress.pageNumber} (
            {progress.done} of {progress.total} done,{' '}
            {Math.round((progress.stage.progress ?? 0) * 100)}%)
          </p>
        )}

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {result && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {result.pages.length} {result.pages.length === 1 ? 'page' : 'pages'} read, average
              confidence {result.confidence.toFixed(0)}%.
              {result.skipped > 0 &&
                ` ${result.skipped} words used characters the embedded font could not draw and are missing from the searchable layer.`}
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
                onClick={downloadText}
                className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Download .txt
              </button>
              {pdfUrl && file && (
                <a
                  href={pdfUrl}
                  download={outputName(file.name, 'searchable', 'pdf')}
                  className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  Download searchable PDF
                </a>
              )}
            </div>

            <ul className="space-y-1 text-xs text-muted-foreground">
              {result.pages.map((p) => (
                <li key={p.pageNumber}>
                  Page {p.pageNumber} — {p.words} words, {p.confidence.toFixed(0)}% confidence
                </li>
              ))}
            </ul>
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
