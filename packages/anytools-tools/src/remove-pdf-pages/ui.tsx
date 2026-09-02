'use client';
import { Card, CardContent, CardHeader, CardTitle, PrivacyNote } from '@anytools/ui';
import { useEffect, useState } from 'react';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { type RemoveResult, readPageCount, removePdfPages } from './logic';

export function RemovePdfPagesUi() {
  const [files, setFiles] = useState<File[]>([]);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [range, setRange] = useState('');
  const [result, setResult] = useState<RemoveResult | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const file = files[0] ?? null;

  useEffect(() => {
    if (!file) {
      setPageCount(null);
      return;
    }
    let cancelled = false;
    readPageCount(file)
      .then((n) => !cancelled && setPageCount(n))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not read PDF'));
    return () => {
      cancelled = true;
    };
  }, [file]);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const r = await removePdfPages(file, range);
      setResult(r);
      setUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(r.blob);
      });
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : 'Removal failed');
    } finally {
      setBusy(false);
    }
  };

  const outName = file ? file.name.replace(/\.pdf$/i, '') : 'document';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Remove PDF Pages</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <MultiFileDropzone
          files={files}
          onChange={(f) => {
            setFiles(f);
            setResult(null);
            setError(null);
            setUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return null;
            });
          }}
          accept="application/pdf,.pdf"
          multiple={false}
          label="PDF to edit"
        />

        {pageCount !== null && (
          <p className="text-sm text-muted-foreground">
            {pageCount} {pageCount === 1 ? 'page' : 'pages'}
          </p>
        )}

        <label className="block text-sm">
          <span className="mb-1 block text-muted-foreground">
            Pages to delete — e.g. <code>1, 4-6, 12</code>
          </span>
          <input
            type="text"
            value={range}
            onChange={(e) => setRange(e.target.value)}
            placeholder={pageCount ? `1-${pageCount}` : '1, 4-6'}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </label>

        <button
          type="button"
          onClick={run}
          disabled={!file || busy || !range.trim()}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Removing…' : 'Remove pages'}
        </button>

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {result && url && (
          <div className="space-y-3">
            <div className="rounded-md border bg-muted p-3 text-sm">
              Removed {result.removed} {result.removed === 1 ? 'page' : 'pages'} — {result.pages}{' '}
              {result.pages === 1 ? 'page' : 'pages'} left.
            </div>
            <a
              href={url}
              download={`${outName}-edited.pdf`}
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Download {outName}-edited.pdf
            </a>
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
