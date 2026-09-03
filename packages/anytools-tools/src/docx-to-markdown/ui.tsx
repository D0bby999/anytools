'use client';
import { trackEvent } from '@anytools/analytics';
import { Card, CardContent, CardHeader, CardTitle, CopyButton, PrivacyNote } from '@anytools/ui';
import { useEffect, useState } from 'react';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { useObjectUrls } from '../shared/use-object-urls';
import {
  type DocxConversion,
  MAX_DOCX_BYTES,
  SLOW_DOCX_BYTES,
  convertDocxFile,
  renderMarkdownPreview,
} from './logic';

const SLUG = 'docx-to-markdown';
type View = 'markdown' | 'preview' | 'html';

/**
 * `sandbox=""` stops the preview frame running script, but it does not stop it *fetching*.
 * A document that contains the text `<img src="https://tracker.example/x.png">` survives into
 * the Markdown as text, comes back as a real `<img>` when the preview renders it, and the
 * frame then asks a third party for it — which tells that third party the visitor opened this
 * document. The header below is what actually blocks the request: nothing may be loaded except
 * the inline stylesheet, and images only from `data:` URIs already inside the file.
 */
const PREVIEW_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'";

const PREVIEW_STYLE =
  'body{font:14px/1.6 system-ui,sans-serif;margin:12px;color:#222}' +
  'table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:4px 8px}img{max-width:100%}';

const VIEWS: { id: View; label: string }[] = [
  { id: 'markdown', label: 'Markdown' },
  { id: 'preview', label: 'Preview' },
  // Spelled out rather than title-cased from the id: CSS `capitalize` renders "Html".
  { id: 'html', label: 'HTML' },
];

export function DocxToMarkdownUi() {
  const objectUrls = useObjectUrls();
  const [files, setFiles] = useState<File[]>([]);
  const [includeImages, setIncludeImages] = useState(false);
  const [result, setResult] = useState<DocxConversion | null>(null);
  const [view, setView] = useState<View>('markdown');
  const [previewHtml, setPreviewHtml] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const file = files[0] ?? null;
  const tooLarge = !!file && file.size > MAX_DOCX_BYTES;

  // The preview needs `marked`, which is only worth loading once the user asks to see it.
  useEffect(() => {
    if (view !== 'preview' || !result) return;
    let cancelled = false;
    renderMarkdownPreview(result.markdown)
      .then((html) => !cancelled && setPreviewHtml(html))
      .catch(() => !cancelled && setPreviewHtml(''));
    return () => {
      cancelled = true;
    };
  }, [view, result]);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    trackEvent('tool_run', { tool: SLUG });
    try {
      setResult(await convertDocxFile(file, { includeImages }));
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : 'Could not read this document');
    } finally {
      setBusy(false);
    }
  };

  const downloadMarkdown = () => {
    if (!result) return;
    const blob = new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = objectUrls.create(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(file?.name ?? 'document').replace(/\.docx$/i, '')}.md`;
    a.click();
    // Revoking in the same tick cancels the download click() just started.
    setTimeout(() => objectUrls.revoke(url), 30_000);
  };

  const text = result ? (view === 'html' ? result.html : result.markdown) : '';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">DOCX to Markdown</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <MultiFileDropzone
          files={files}
          onChange={(f) => {
            setFiles(f);
            setResult(null);
            setError(null);
          }}
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          multiple={false}
          label="Word document (.docx)"
        />

        <p className="text-sm text-muted-foreground">
          <strong>.docx only.</strong> The older binary <code>.doc</code>, along with{' '}
          <code>.rtf</code>, <code>.odt</code> and Apple Pages files, are different formats — open
          one in Word, LibreOffice or Pages and use <em>Save As → .docx</em> first.
        </p>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeImages}
            onChange={(e) => {
              setIncludeImages(e.target.checked);
              setResult(null);
            }}
          />
          Embed images as data URIs (off by default — one photo can add megabytes of base64)
        </label>

        {tooLarge && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            This document is {Math.round(file.size / 1024 / 1024)} MB, over the{' '}
            {MAX_DOCX_BYTES / 1024 / 1024} MB limit. A .docx is compressed, and the unzipped XML,
            the HTML and the Markdown all have to be held in the tab at once. Split the document, or
            save a copy with the images removed, and try again.
          </output>
        )}

        {file && !tooLarge && file.size > SLOW_DOCX_BYTES && (
          <output className="block rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            This document is over 20 MB. Conversion happens on this page's main thread, so the tab
            will stop responding while it runs. It will still be attempted.
          </output>
        )}

        <button
          type="button"
          onClick={run}
          disabled={!file || busy || tooLarge}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Converting…' : 'Convert to Markdown'}
        </button>

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {result && (
          <div className="space-y-3">
            {result.imageCount > 0 && (
              <p className="text-sm text-muted-foreground">
                {result.imageCount} {result.imageCount === 1 ? 'image was' : 'images were'}{' '}
                {includeImages ? 'embedded as data URIs' : 'dropped'}.
              </p>
            )}
            {result.warnings.length > 0 && (
              <details className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <summary className="cursor-pointer">
                  {result.warnings.length} note{result.warnings.length === 1 ? '' : 's'} from the
                  converter
                </summary>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                  {result.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </details>
            )}

            <div className="flex flex-wrap gap-2">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setView(v.id)}
                  className={`h-9 rounded-md border px-3 text-sm ${
                    view === v.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <CopyButton text={view === 'html' ? result.html : result.markdown} />
              <button
                type="button"
                onClick={downloadMarkdown}
                className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Download .md
              </button>
            </div>

            {view === 'preview' ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Rendered with the same converter as the{' '}
                  <a href="/tools/md-html" className="underline">
                    Markdown ↔ HTML tool
                  </a>
                  , inside a sandboxed frame that cannot run script and cannot load anything from
                  the network — so a link or an image address inside your document stays a piece of
                  text and never becomes a request.
                </p>
                <iframe
                  title="Markdown preview"
                  sandbox=""
                  srcDoc={`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><style>${PREVIEW_STYLE}</style>${previewHtml}`}
                  className="h-80 w-full rounded-md border bg-white"
                />
              </>
            ) : (
              <pre className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
                {text}
              </pre>
            )}
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
