'use client';
import { trackEvent } from '@anytools/analytics';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  PrivacyNote,
  useLocalized,
  useUiStrings,
} from '@anytools/ui';
import { useEffect, useMemo, useState } from 'react';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { SHARED_ERROR_STRINGS } from '../shared/shared-error-strings';
import {
  OCR_LANGUAGES,
  OCR_LANGUAGE_LABELS,
  OcrCancelledError,
  type OcrLanguage,
  terminateOcr,
} from '../shared/tesseract-loader';
import { toolErrorText } from '../shared/tool-error';
import { useObjectUrls } from '../shared/use-object-urls';
import { type OcrPdfProgress, type OcrPdfResult, ocrPdf, outputName } from './logic';
import { STRINGS } from './strings';

export function OcrPdfUi() {
  const s = useLocalized(STRINGS);
  const sharedErrors = useLocalized(SHARED_ERROR_STRINGS);
  // Errors from the shared modules (canvas ceiling, page ranges, pdf.js…) under the tool's own keys.
  const errorStrings = useMemo(() => ({ ...sharedErrors, ...s }), [sharedErrors, s]);
  const ui = useUiStrings();
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
  const [stopping, setStopping] = useState(false);

  const file = files[0] ?? null;

  // Tesseract's status strings are internal jargon; these are the stages the user waits on.
  const stageLabel: Record<string, string> = {
    'loading tesseract core': s.stage_starting,
    'loading language traineddata': s.stage_loadingLang,
    'initializing api': s.stage_starting,
    'recognizing text': s.stage_reading,
  };
  // The shared loader names languages in English; map the ones we ship to the locale.
  const langLabel: Record<OcrLanguage, string> = {
    eng: s.lang_eng,
    vie: s.lang_vie,
    spa: s.lang_spa,
    por: s.lang_por,
  };
  const [pagesBefore, pagesAfter] = s.pagesLabel.split('{code}');

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
    if (!file || busy) return;
    trackEvent('tool_run', { tool: 'ocr-pdf' });
    setBusy(true);
    setStopping(false);
    reset();
    try {
      const r = await ocrPdf(file, { lang, range, searchable }, setProgress);
      setResult(r);
      setText(r.text);
      setPdfUrl(r.pdf ? objectUrls.create(r.pdf) : null);
      if (r.searchableError) {
        // The fixed sentence in the page's language, then the cause the same way.
        const reason = toolErrorText(r.searchableCause, errorStrings, '');
        setError(`${s.error_searchableFailed} ${reason}`.trim());
      }
    } catch (e) {
      if (!(e instanceof OcrCancelledError)) {
        setError(toolErrorText(e, errorStrings, s.failed));
      }
    } finally {
      // Only here. Clearing `busy` inside stop() re-enabled the button while the loop was still
      // unwinding, and a second press then ran two loops over the same document at once.
      setBusy(false);
      setStopping(false);
      setProgress(null);
    }
  };

  const stop = () => {
    setStopping(true);
    void terminateOcr();
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
        <CardTitle className="text-xl">{s.title}</CardTitle>
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
          label={s.dropLabel}
        />

        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{s.language}</span>
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
                  {langLabel[l] ?? OCR_LANGUAGE_LABELS[l]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">
              {pagesBefore}
              <code>1-3, 7</code>
              {pagesAfter}
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
            {s.searchable}
            <span className="block text-xs text-muted-foreground">{s.searchableNote}</span>
          </span>
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={run}
            disabled={!file || busy}
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
          >
            {busy ? s.reading : s.recognize}
          </button>
          {busy && (
            <button
              type="button"
              onClick={stop}
              disabled={stopping}
              className="inline-flex h-10 items-center justify-center rounded-md border px-4 text-sm font-medium hover:bg-muted disabled:opacity-40"
            >
              {stopping ? s.stopping : ui.stop}
            </button>
          )}
        </div>

        {stopping && <p className="text-sm text-muted-foreground">{s.stoppingNote}</p>}

        {progress && !stopping && (
          <p className="text-sm text-muted-foreground">
            {s.progressLine
              .replace('{stage}', stageLabel[progress.stage.status] ?? s.stage_working)
              .replace('{page}', String(progress.pageNumber))
              .replace('{done}', String(progress.done))
              .replace('{total}', String(progress.total))
              .replace('{pct}', String(Math.round((progress.stage.progress ?? 0) * 100)))}
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
              {(result.pages.length === 1 ? s.readSummaryOne : s.readSummaryMany)
                .replace('{n}', String(result.pages.length))
                .replace('{conf}', result.confidence.toFixed(0))}
            </p>

            {result.skipped > 0 && (
              <p className="text-sm text-muted-foreground">
                {(result.skipped === 1 ? s.skippedOne : s.skippedMany).replace(
                  '{n}',
                  String(result.skipped),
                )}
              </p>
            )}

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              rows={14}
              aria-label={s.recognisedText}
              className="w-full rounded-md border border-input bg-background p-3 font-mono text-sm"
            />

            <div className="flex flex-wrap gap-2">
              <CopyButton text={text} size="default" />
              <button
                type="button"
                onClick={downloadText}
                className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                {s.downloadTxt}
              </button>
              {pdfUrl && file && (
                <a
                  href={pdfUrl}
                  download={outputName(file.name, 'searchable', 'pdf')}
                  className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  {s.downloadSearchable}
                </a>
              )}
            </div>

            <ul className="space-y-1 text-xs text-muted-foreground">
              {result.pages.map((p) => (
                <li key={p.pageNumber}>
                  {s.pageLine
                    .replace('{n}', String(p.pageNumber))
                    .replace('{words}', String(p.words))
                    .replace('{conf}', p.confidence.toFixed(0))}
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
